import type { SSEManager } from '../SSEManager.js';
import type { SyncHistoryStore } from '../SyncHistoryStore.js';

interface SyncDeps {
  db: { resolveProjectIdentifier?: (id: string) => string | null } | null;
  onSyncTrigger: ((projectId: string | null) => Promise<void>) | null;
  syncHistory: SyncHistoryStore;
  sseManager: SSEManager;
  parseJsonBody: (req: unknown) => Promise<Record<string, unknown>>;
  sendJson: (res: unknown, code: number, data: unknown) => void;
  sendError: (res: unknown, code: number, message: string, details?: Record<string, unknown>) => void;
  logger: { info: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void };
}

interface App {
  registerRoute(opts: { match: (ctx: { pathname: string; method: string }) => boolean; handle: (ctx: { req: unknown; res: unknown; url: URL; pathname: string }) => Promise<void> }): void;
}

export function registerSyncRoutes(app: App, deps: SyncDeps): void {
  const { db, onSyncTrigger, syncHistory, sseManager, parseJsonBody, sendJson, sendError, logger } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/sync/trigger' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await parseJsonBody(req);
        let projectId: string | null = (body.projectId as string) || null;
        if (projectId && db?.resolveProjectIdentifier) {
          const resolved = db.resolveProjectIdentifier(projectId);
          if (resolved) {
            logger.info({ original: projectId, resolved }, 'Resolved folder name to project ID');
            projectId = resolved;
          } else {
            logger.warn({ projectId }, 'Could not resolve project identifier');
          }
        }
        if (onSyncTrigger) {
          const eventId = syncHistory.addEvent({ type: 'manual_trigger', projectId, source: 'api' });
          sseManager.broadcast('sync:triggered', { eventId, projectId, triggeredBy: 'api' });
          onSyncTrigger(projectId).then(() => {
            sseManager.broadcast('sync:completed', { eventId, projectId, status: 'success' });
          }).catch((error: Error) => {
            sseManager.broadcast('sync:error', { eventId, projectId, error: error.message });
          });
          sendJson(res, 202, { message: projectId ? `Sync triggered for project ${projectId}` : 'Full sync triggered', eventId, status: 'accepted' });
        } else {
          sendError(res, 503, 'Sync trigger not available');
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to trigger sync');
        sendError(res, 500, 'Failed to trigger sync', { error: (error as Error).message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/sync/history' && method === 'GET',
    handle: async ({ res, url }) => {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      sendJson(res, 200, syncHistory.getHistory(limit, offset));
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/sync/history/') && method === 'GET',
    handle: async ({ res, pathname }) => {
      const eventId = pathname.split('/').pop();
      const event = syncHistory.getEvent(eventId || '');
      if (event) sendJson(res, 200, event);
      else sendError(res, 404, 'Sync event not found');
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/sync/mappings' && method === 'GET',
    handle: async ({ res }) => {
      const mappings = syncHistory.getMappings();
      sendJson(res, 200, { total: mappings.length, mappings });
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/sync/mappings/') && method === 'GET',
    handle: async ({ res, pathname }) => {
      const identifier = pathname.split('/').pop();
      const mapping = syncHistory.getMapping(identifier || '');
      if (mapping) sendJson(res, 200, mapping);
      else sendError(res, 404, 'Mapping not found');
    },
  });
}
