export function registerConfigRoutes(app, deps) {
  const { configHandler } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/config' && method === 'GET',
    handle: async ({ req, res }) => {
      configHandler.getConfig(req, res);
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/config' && method === 'PATCH',
    handle: async ({ req, res }) => {
      await configHandler.updateConfig(req, res);
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/config/reset' && method === 'POST',
    handle: async ({ req, res }) => {
      configHandler.resetConfig(req, res);
    },
  });
}
