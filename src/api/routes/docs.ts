interface App {
  registerRoute(opts: { match: (ctx: { pathname: string; method: string }) => boolean; handle: (ctx: { res: unknown }) => Promise<void> }): void;
}

export function registerDocsRoutes(app: App): void {
  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/' && method === 'GET',
    handle: async ({ res }) => {
      (res as { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }).writeHead(200, { 'Content-Type': 'text/plain' });
      (res as { end: (body: string) => void }).end(`Vibesync Service API

Available Endpoints:

Health & Metrics:
  GET  /health                       - Service health check
  GET  /metrics                      - Prometheus metrics
  GET  /api/stats                    - Human-readable statistics (includes database stats)

Projects & Issues:
  GET  /api/projects                 - Get all projects with issue counts
  GET  /api/projects/:id/issues      - Get issues for a specific project

Configuration:
  GET  /api/config                   - Get current configuration
  PATCH /api/config                  - Update configuration
  POST /api/config/reset             - Reset to defaults

Sync Control:
  POST /api/sync/trigger             - Trigger manual sync
  POST /api/sync/trigger (projectId) - Trigger sync for specific project

Sync History:
  GET  /api/sync/history             - Get sync history (paginated)
  GET  /api/sync/history/:id         - Get specific sync event

Issue Mappings:
  GET  /api/sync/mappings            - Get all issue mappings
  GET  /api/sync/mappings/:id        - Get specific mapping

Real-time Events:
  GET  /api/events/stream            - Server-Sent Events stream

File Operations (Remote Agent File Mounting):
   POST /api/files/read               - Read file content (for remote agents)
   POST /api/files/edit               - Edit file content (for remote agents)
   POST /api/files/info               - Get file metadata

Temporal Schedule Management:
  GET  /api/temporal/schedule        - Get scheduled sync status
  POST /api/temporal/schedule/start  - Start scheduled sync workflow
  POST /api/temporal/schedule/stop   - Stop scheduled sync workflow
  PATCH /api/temporal/schedule       - Update schedule interval
  GET  /api/temporal/workflows       - List sync workflows

Event Types (SSE):
    - connected                  - Client connected
    - sync:triggered             - Sync manually triggered
    - sync:started               - Sync cycle started
    - sync:completed             - Sync cycle completed
    - sync:error                 - Error during sync
    - config:updated             - Configuration changed
    - health:updated             - Health metrics updated
    - temporal:schedule-started  - Temporal schedule started
    - temporal:schedule-stopped  - Temporal schedule stopped
    - temporal:schedule-updated  - Temporal schedule interval updated
`);
    },
  });
}
