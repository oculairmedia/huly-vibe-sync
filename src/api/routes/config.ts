import type { ConfigurationHandler } from '../ConfigurationHandler.js';

interface ConfigDeps { configHandler: ConfigurationHandler }
interface App { registerRoute(opts: { match: (ctx: { pathname: string; method: string }) => boolean; handle: (ctx: { req: unknown; res: unknown }) => Promise<void> }): void }

export function registerConfigRoutes(app: App, deps: ConfigDeps): void {
  const { configHandler } = deps;
  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/config' && method === 'GET',
    handle: async ({ req, res }) => { configHandler.getConfig(req, res); },
  });
  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/config' && method === 'PATCH',
    handle: async ({ req, res }) => { await configHandler.updateConfig(req, res); },
  });
  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/config/reset' && method === 'POST',
    handle: async ({ req, res }) => { configHandler.resetConfig(req, res); },
  });
}
