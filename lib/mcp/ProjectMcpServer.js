/**
 * Project MCP Server - MCP Server for project and issue operations
 *
 * Implements MCP server with two tools:
 * - project_query: Query projects, issues, and comments from the database and bd CLI
 * - project_issue_ops: Create, update, delete, and manage issues via bd CLI
 *
 * All operations are scoped to the correct project working directory.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { execBeadsCommand } from '../beads/BeadsCLI.js';
import { logger } from '../logger.js';

/**
 * Shell-quote a value for safe inclusion in bd CLI commands
 * @param {string|number|null|undefined} value - Value to quote
 * @returns {string} Shell-quoted string
 */
function shellQuote(value) {
  const stringValue = String(value ?? '');
  return `'${stringValue.replace(/'/g, "'\"'\"'")}'`;
}

/**
 * Resolve project identifier to filesystem path
 * @param {Object} db - SyncDatabase instance
 * @param {string} projectIdentifier - Project identifier or folder name
 * @returns {string} Filesystem path
 * @throws {Error} If project not found
 */
function resolveProjectPath(db, projectIdentifier) {
  if (!projectIdentifier) {
    throw new Error('project_identifier is required');
  }

  const fsPath = db.getProjectFilesystemPath(projectIdentifier);
  if (!fsPath) {
    // Try resolving by folder name
    const resolved = db.resolveProjectIdentifier(projectIdentifier);
    if (resolved) {
      const resolvedPath = db.getProjectFilesystemPath(resolved);
      if (resolvedPath) {
        return resolvedPath;
      }
    }
    throw new Error(`Project not found: ${projectIdentifier}`);
  }

  return fsPath;
}

/**
 * Create an MCP server for project and issue operations
 * @param {Object} params - Server dependencies
 * @param {Object} params.db - SyncDatabase instance
 * @param {Object} params.logger - Pino logger instance
 * @returns {McpServer} MCP server instance
 */
export function createProjectMcpServer({ db, logger: parentLogger }) {
  const log = (parentLogger || logger).child({ module: 'project-mcp' });

  const server = new McpServer({
    name: 'vibe-sync-project-mcp',
    version: '1.0.0',
  });

  // ============================================================
  // TOOL: project_query
  // ============================================================
  server.registerTool(
    'project_query',
    {
      description: 'Query projects, issues, and comments from database and bd CLI',
      inputSchema: z.object({
        entity: z.enum(['project', 'issue', 'comment']).describe('Entity type to query'),
        mode: z.enum(['list', 'get', 'search']).describe('Query mode'),
        project_identifier: z
          .string()
          .optional()
          .describe('Project identifier (required for issue/comment queries)'),
        issue_id: z.string().optional().describe('Issue ID (required for get mode on issues)'),
        search_term: z.string().optional().describe('Search term (required for search mode)'),
        status_filter: z
          .string()
          .optional()
          .describe('Filter issues by status (open, closed, all)'),
      }),
    },
    async ({ entity, mode, project_identifier, issue_id, search_term, status_filter }) => {
      try {
        let result;

        if (entity === 'project') {
          if (mode === 'list') {
            result = db.getAllProjects();
          } else if (mode === 'get') {
            if (!project_identifier) {
              throw new Error('project_identifier is required for get mode');
            }
            result = db.getProject(project_identifier);
          } else {
            throw new Error(`Unsupported mode for project: ${mode}`);
          }
        } else if (entity === 'issue') {
          if (!project_identifier) {
            throw new Error('project_identifier is required for issue queries');
          }

          const projectPath = resolveProjectPath(db, project_identifier);

          if (mode === 'list') {
            let command = 'list --json';
            if (status_filter === 'open') {
              command += ' --status=open';
            } else if (status_filter === 'closed') {
              command += ' --status=closed';
            }
            const output = await execBeadsCommand(command, projectPath);
            result = output ? JSON.parse(output) : [];
          } else if (mode === 'get') {
            if (!issue_id) {
              throw new Error('issue_id is required for get mode');
            }
            const output = await execBeadsCommand(`show ${issue_id} --json`, projectPath);
            result = output ? JSON.parse(output) : null;
          } else if (mode === 'search') {
            if (!search_term) {
              throw new Error('search_term is required for search mode');
            }
            const output = await execBeadsCommand(
              `search ${shellQuote(search_term)} --json`,
              projectPath,
            );
            result = output ? JSON.parse(output) : [];
          } else {
            throw new Error(`Unsupported mode for issue: ${mode}`);
          }
        } else if (entity === 'comment') {
          if (!project_identifier) {
            throw new Error('project_identifier is required for comment queries');
          }
          if (!issue_id) {
            throw new Error('issue_id is required for comment queries');
          }

          const projectPath = resolveProjectPath(db, project_identifier);

          if (mode === 'list') {
            const output = await execBeadsCommand(`comments list ${issue_id} --json`, projectPath);
            result = output ? JSON.parse(output) : [];
          } else {
            throw new Error(`Unsupported mode for comment: ${mode}`);
          }
        } else {
          throw new Error(`Unsupported entity type: ${entity}`);
        }

        log.debug({ entity, mode, project_identifier, issue_id }, 'Query executed successfully');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        log.error({ err: error, entity, mode, project_identifier }, 'Query failed');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error.message,
                  entity,
                  mode,
                  project_identifier,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ============================================================
  // TOOL: project_issue_ops
  // ============================================================
  server.registerTool(
    'project_issue_ops',
    {
      description: 'Create, update, delete, and manage issues via bd CLI',
      inputSchema: z.object({
        operation: z
          .enum([
            'create',
            'update',
            'delete',
            'create_subissue',
            'close',
            'reopen',
            'label',
            'comment',
          ])
          .describe('Operation to perform'),
        project_identifier: z.string().describe('Project identifier'),
        issue_id: z
          .string()
          .optional()
          .describe('Issue ID (required for update/delete/close/reopen/label/comment)'),
        title: z.string().optional().describe('Issue title (required for create)'),
        description: z.string().optional().describe('Issue description'),
        priority: z.string().optional().describe('Priority (0-4 or P0-P4)'),
        status: z.string().optional().describe('Issue status'),
        field: z.string().optional().describe('Field to update'),
        value: z.string().optional().describe('New value for the field'),
        label_action: z.enum(['add', 'remove']).optional().describe('Label action'),
        label: z.string().optional().describe('Label name'),
        comment_text: z.string().optional().describe('Comment text'),
        parent_id: z.string().optional().describe('Parent issue ID for sub-issues'),
      }),
    },
    async ({
      operation,
      project_identifier,
      issue_id,
      title,
      description,
      priority,
      field,
      value,
      label_action,
      label,
      comment_text,
      parent_id,
    }) => {
      try {
        const projectPath = resolveProjectPath(db, project_identifier);
        let output;

        if (operation === 'create') {
          if (!title) {
            throw new Error('title is required for create operation');
          }

          let command = `create ${shellQuote(title)} --json`;
          if (priority) {
            command += ` --priority=${priority}`;
          }

          output = await execBeadsCommand(command, projectPath);
          const createdIssue = JSON.parse(output);

          // Add description as a comment if provided
          if (description) {
            try {
              await execBeadsCommand(
                `comment ${createdIssue.id} ${shellQuote(description)}`,
                projectPath,
              );
            } catch (commentError) {
              log.warn(
                { err: commentError, issue_id: createdIssue.id },
                'Failed to add description as comment',
              );
            }
          }

          log.info({ project_identifier, issue_id: createdIssue.id, title }, 'Issue created');

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(createdIssue, null, 2),
              },
            ],
          };
        } else if (operation === 'update') {
          if (!issue_id) {
            throw new Error('issue_id is required for update operation');
          }
          if (!field || !value) {
            throw new Error('field and value are required for update operation');
          }

          const command = `update ${issue_id} --${field}=${shellQuote(value)}`;
          await execBeadsCommand(command, projectPath);

          log.info({ project_identifier, issue_id, field, value }, 'Issue updated');

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    issue_id,
                    field,
                    value,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } else if (operation === 'delete') {
          if (!issue_id) {
            throw new Error('issue_id is required for delete operation');
          }

          await execBeadsCommand(`delete ${issue_id}`, projectPath);

          log.info({ project_identifier, issue_id }, 'Issue deleted');

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    issue_id,
                    operation: 'deleted',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } else if (operation === 'create_subissue') {
          if (!title) {
            throw new Error('title is required for create_subissue operation');
          }
          if (!parent_id) {
            throw new Error('parent_id is required for create_subissue operation');
          }

          let command = `create ${shellQuote(title)} --parent ${parent_id} --json`;
          if (priority) {
            command += ` --priority=${priority}`;
          }

          output = await execBeadsCommand(command, projectPath);
          const createdIssue = JSON.parse(output);

          log.info(
            { project_identifier, issue_id: createdIssue.id, parent_id, title },
            'Sub-issue created',
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(createdIssue, null, 2),
              },
            ],
          };
        } else if (operation === 'close') {
          if (!issue_id) {
            throw new Error('issue_id is required for close operation');
          }

          await execBeadsCommand(`close ${issue_id}`, projectPath);

          log.info({ project_identifier, issue_id }, 'Issue closed');

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    issue_id,
                    operation: 'closed',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } else if (operation === 'reopen') {
          if (!issue_id) {
            throw new Error('issue_id is required for reopen operation');
          }

          await execBeadsCommand(`reopen ${issue_id}`, projectPath);

          log.info({ project_identifier, issue_id }, 'Issue reopened');

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    issue_id,
                    operation: 'reopened',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } else if (operation === 'label') {
          if (!issue_id) {
            throw new Error('issue_id is required for label operation');
          }
          if (!label_action || !label) {
            throw new Error('label_action and label are required for label operation');
          }

          const command = `label ${label_action} ${issue_id} ${shellQuote(label)}`;
          await execBeadsCommand(command, projectPath);

          log.info(
            { project_identifier, issue_id, label_action, label },
            'Label operation completed',
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    issue_id,
                    label_action,
                    label,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } else if (operation === 'comment') {
          if (!issue_id) {
            throw new Error('issue_id is required for comment operation');
          }
          if (!comment_text) {
            throw new Error('comment_text is required for comment operation');
          }

          await execBeadsCommand(`comment ${issue_id} ${shellQuote(comment_text)}`, projectPath);

          log.info({ project_identifier, issue_id }, 'Comment added');

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    issue_id,
                    operation: 'comment_added',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } else {
          throw new Error(`Unsupported operation: ${operation}`);
        }
      } catch (error) {
        log.error({ err: error, operation, project_identifier }, 'Issue operation failed');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error.message,
                  operation,
                  project_identifier,
                  issue_id,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );

  log.info('Project MCP server created with tools: project_query, project_issue_ops');

  return server;
}
