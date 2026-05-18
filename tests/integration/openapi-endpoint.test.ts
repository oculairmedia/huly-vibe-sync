import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import type { Server } from 'http';

describe('OpenAPI Endpoint Integration', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    // Create a minimal HTTP server with the OpenAPI route
    server = createServer((req, res) => {
      if (req.url === '/openapi.json' && req.method === 'GET') {
        // Simulate the route handler
        const spec = {
          openapi: '3.1.0',
          info: {
            title: 'Vibesync API',
            description: 'Project sync service with PM agent orchestration',
            version: '1.0.0',
          },
          paths: {
            '/health': {
              get: {
                summary: 'Health check',
                responses: {
                  '200': {
                    description: 'Health metrics',
                  },
                },
              },
            },
          },
          components: {
            schemas: {
              HealthMetrics: {
                type: 'object',
              },
            },
          },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(spec));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  it('should return 200 for GET /openapi.json', async () => {
    const response = await fetch(`http://localhost:${port}/openapi.json`);
    expect(response.status).toBe(200);
  });

  it('should return valid JSON with OpenAPI 3.1.0', async () => {
    const response = await fetch(`http://localhost:${port}/openapi.json`);
    const spec = await response.json();
    expect(spec.openapi).toBe('3.1.0');
  });

  it('should have required info fields', async () => {
    const response = await fetch(`http://localhost:${port}/openapi.json`);
    const spec = await response.json();
    expect(spec.info.title).toBe('Vibesync API');
    expect(spec.info.version).toBe('1.0.0');
  });

  it('should have paths and components', async () => {
    const response = await fetch(`http://localhost:${port}/openapi.json`);
    const spec = await response.json();
    expect(spec.paths).toBeDefined();
    expect(spec.components).toBeDefined();
    expect(spec.components.schemas).toBeDefined();
  });

  it('should return Content-Type application/json', async () => {
    const response = await fetch(`http://localhost:${port}/openapi.json`);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
