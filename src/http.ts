import http from 'node:http';
import https from 'node:https';

export const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  scheduling: 'lifo' as const,
});

export const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  scheduling: 'lifo' as const,
  rejectUnauthorized: true,
});

export function fetchWithPool(url: string, options: RequestInit = {}): Promise<Response> {
  const agent = url.startsWith('https://') ? httpsAgent : httpAgent;
  return fetch(url, { ...options, agent } as RequestInit);
}

export interface PoolStats {
  http: { maxSockets: number; maxFreeSockets: number; sockets: number; freeSockets: number; requests: number };
  https: { maxSockets: number; maxFreeSockets: number; sockets: number; freeSockets: number; requests: number };
}

export function getPoolStats(): PoolStats {
  // Use type assertion since http.Agent.sockets typed as readonly Record, but runtime is mutable.
  const sockets = httpAgent.sockets as Record<string, http.Agent['sockets'][string]>;
  const freeSockets = httpAgent.freeSockets as Record<string, http.Agent['freeSockets'][string]>;
  const requests = httpAgent.requests as Record<string, http.Agent['requests'][string]>;
  const httpsS = httpsAgent.sockets as Record<string, https.Agent['sockets'][string]>;
  const httpsFS = httpsAgent.freeSockets as Record<string, https.Agent['freeSockets'][string]>;
  const httpsR = httpsAgent.requests as Record<string, https.Agent['requests'][string]>;
  const sum = (a: number, b: unknown[] | undefined) => a + (b?.length ?? 0);
  return {
    http: {
      maxSockets: httpAgent.maxSockets,
      maxFreeSockets: httpAgent.maxFreeSockets,
      sockets: Object.values(sockets as unknown as Record<string, unknown[]>).reduce(sum, 0),
      freeSockets: Object.values(freeSockets as unknown as Record<string, unknown[]>).reduce(sum, 0),
      requests: Object.values(requests as unknown as Record<string, unknown[]>).reduce(sum, 0),
    },
    https: {
      maxSockets: httpsAgent.maxSockets,
      maxFreeSockets: httpsAgent.maxFreeSockets,
      sockets: Object.values(httpsS as unknown as Record<string, unknown[]>).reduce(sum, 0),
      freeSockets: Object.values(httpsFS as unknown as Record<string, unknown[]>).reduce(sum, 0),
      requests: Object.values(httpsR as unknown as Record<string, unknown[]>).reduce(sum, 0),
    },
  };
}

export function destroyPool(): void {
  httpAgent.destroy();
  httpsAgent.destroy();
}
