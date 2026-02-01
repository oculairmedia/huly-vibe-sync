export function registerEventsRoutes(app, deps) {
  const { sseManager } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/events/stream' && method === 'GET',
    handle: async ({ res }) => {
      sseManager.addClient(res);
    },
  });
}
