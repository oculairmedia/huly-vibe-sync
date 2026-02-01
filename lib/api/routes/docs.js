export function registerDocsRoutes(app) {
  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/' && method === 'GET',
    handle: async ({ res }) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`Huly-Vibe Sync Service API

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
  GET  /api/sync/mappings            - Get all Huly ↔ Vibe mappings
  GET  /api/sync/mappings/:id        - Get specific mapping

Real-time Events:
  GET  /api/events/stream            - Server-Sent Events stream

File Operations (Remote Agent File Mounting):
  POST /api/files/read               - Read file content (for remote agents)
  POST /api/files/edit               - Edit file content (for remote agents)
  POST /api/files/info               - Get file metadata

Letta Code (Filesystem Agent Mode):
  GET  /api/letta-code/status        - Check Letta Code CLI availability
  GET  /api/letta-code/sessions      - List all active Letta Code sessions
  GET  /api/letta-code/sessions/:id  - Get session for specific agent
  POST /api/letta-code/link          - Link agent to project directory
  POST /api/letta-code/task          - Run headless task for agent
  POST /api/letta-code/configure-project - Configure agent for Huly project
  DELETE /api/letta-code/sessions/:id - Remove agent session

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
  - letta-code:linked          - Agent linked to project
  - letta-code:task-started    - Task execution started
  - letta-code:task-completed  - Task execution completed
  - letta-code:task-failed     - Task execution failed
  - letta-code:session-removed - Session removed
  - temporal:schedule-started  - Temporal schedule started
  - temporal:schedule-stopped  - Temporal schedule stopped
  - temporal:schedule-updated  - Temporal schedule interval updated
`);
    },
  });
}
