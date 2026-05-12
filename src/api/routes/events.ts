import type { SSEManager } from '../SSEManager.js';

interface EventsDeps { sseManager: SSEManager }
interface App { registerRoute(opts: { match: (ctx: { pathname: string; method: string }) => boolean; handle: (ctx: { res: unknown }) => Promise<void> }): void }

export function registerEventsRoutes(app: App, deps: EventsDeps): void {
  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/events/stream' && method === 'GET',
    handle: async ({ res }) => { deps.sseManager.addClient(res); },
  });
}
