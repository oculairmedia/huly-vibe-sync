import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../logger.js';

export function createProjectMcpServer({ db, logger: parentLogger, registry = null }) {
  const log = (parentLogger || logger).child({ module: 'project-mcp' });

  const server = new McpServer({
    name: 'vibe-sync-project-mcp',
    version: '1.0.0',
  });

  server.registerTool(
    'project_query',
    {
      description: 'Query registered projects from the database or project registry',
      inputSchema: z.object({
        entity: z.literal('project').describe('Entity type to query'),
        mode: z.enum(['list', 'get', 'search']).describe('Query mode'),
        project_identifier: z.string().optional().describe('Project identifier for get mode'),
        search_term: z.string().optional().describe('Search term for search mode'),
        status_filter: z.string().optional().describe('Optional project status filter'),
      }),
    },
    async ({ mode, project_identifier, search_term, status_filter }) => {
      try {
        let result;

        if (mode === 'list') {
          result = registry
            ? registry.getProjects(status_filter ? { status: status_filter } : {})
            : db.getAllProjects();
        } else if (mode === 'get') {
          if (!project_identifier) {
            throw new Error('project_identifier is required for get mode');
          }

          result = registry
            ? registry.getProject(project_identifier)
            : db.getProject(project_identifier);
        } else if (mode === 'search') {
          const term = (search_term || '').toLowerCase();
          const all = registry ? registry.getProjects({}) : db.getAllProjects();
          result = all.filter(
            project =>
              project.name?.toLowerCase().includes(term) ||
              project.identifier?.toLowerCase().includes(term) ||
              project.filesystem_path?.toLowerCase().includes(term) ||
              project.tech_stack?.toLowerCase().includes(term)
          );
        } else {
          throw new Error(`Unsupported mode for project: ${mode}`);
        }

        log.debug({ mode, project_identifier }, 'Project query executed successfully');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        log.error({ err: error, mode, project_identifier }, 'Project query failed');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error.message,
                  entity: 'project',
                  mode,
                  project_identifier,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );

  log.info('Project MCP server created with tool: project_query');

  return server;
}
