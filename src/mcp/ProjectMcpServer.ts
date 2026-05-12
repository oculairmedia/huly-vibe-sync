import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../logger';

const ProjectQuerySchema = z.object({
  entity: z.literal('project'),
  mode: z.enum(['list', 'get', 'search']),
  project_identifier: z.string().optional(),
  search_term: z.string().optional(),
  status_filter: z.string().optional(),
});

type ProjectQueryInput = z.infer<typeof ProjectQuerySchema>;

interface ProjectRecord {
  identifier?: string;
  name?: string;
  filesystem_path?: string;
  tech_stack?: string;
  [key: string]: unknown;
}

interface ProjectDb {
  getAllProjects: () => ProjectRecord[];
  getProject: (id: string) => ProjectRecord | null;
}

interface ProjectRegistry {
  getProjects: (filter?: { status?: string }) => ProjectRecord[];
  getProject: (id: string) => ProjectRecord | null;
}

interface McpLogger {
  child: (ctx: Record<string, unknown>) => { debug?: (ctx: Record<string, unknown>, msg: string) => void; error?: (ctx: Record<string, unknown>, msg: string) => void };
  info?: (msg: string) => void;
}

interface McpServerOptions {
  db: ProjectDb;
  logger?: McpLogger;
  registry?: ProjectRegistry | null;
}

export function createProjectMcpServer({ db, logger: parentLogger, registry = null }: McpServerOptions): McpServer {
  const log = (parentLogger || logger).child({ module: 'project-mcp' });

  const server = new McpServer({
    name: 'vibesync-project-mcp',
    version: '1.0.0',
  });

  server.registerTool(
    'project_query',
    {
      description: 'Query registered projects from the database or project registry',
      inputSchema: ProjectQuerySchema,
    },
    async ({ mode, project_identifier, search_term, status_filter }: ProjectQueryInput) => {
      try {
        let result: ProjectRecord[] | ProjectRecord | null;

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
          const all: ProjectRecord[] = registry
            ? registry.getProjects({})
            : db.getAllProjects();
          result = all.filter(
            (p) =>
              p.name?.toLowerCase().includes(term) ||
              p.identifier?.toLowerCase().includes(term) ||
              p.filesystem_path?.toLowerCase().includes(term) ||
              p.tech_stack?.toLowerCase().includes(term),
          );
        } else {
          throw new Error(`Unsupported mode for project: ${mode}`);
        }

        (log as { debug?: (ctx: Record<string, unknown>, msg: string) => void })?.debug?.(
          { mode, project_identifier },
          'Project query executed successfully',
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        (log as { error?: (ctx: Record<string, unknown>, msg: string) => void })?.error?.(
          { err: error, mode, project_identifier },
          'Project query failed',
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: (error as Error).message,
                  entity: 'project',
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

  (log as { info?: (msg: string) => void })?.info?.('Project MCP server created with tool: project_query');

  return server;
}
