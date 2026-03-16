import { Pool } from 'undici';

const HTTP_POOL_CONNECTIONS = Number(process.env.TEMPORAL_HTTP_POOL_CONNECTIONS || 10);
const HTTP_POOL_PIPELINING = Number(process.env.TEMPORAL_HTTP_POOL_PIPELINING || 1);
const HTTP_POOL_KEEP_ALIVE_TIMEOUT_MS = Number(
  process.env.TEMPORAL_HTTP_POOL_KEEP_ALIVE_TIMEOUT_MS || 300_000
);
const HTTP_POOL_KEEP_ALIVE_MAX_TIMEOUT_MS = Number(
  process.env.TEMPORAL_HTTP_POOL_KEEP_ALIVE_MAX_TIMEOUT_MS || 600_000
);

type NativeDispatcher = RequestInit extends { dispatcher?: infer T } ? T : unknown;

type FetchWithDispatcherOptions = RequestInit & {
  dispatcher?: NativeDispatcher;
};

const poolCache = new Map<string, Pool>();

function normalizeOrigin(url: string): string {
  return new URL(url).origin;
}

export function getPooledDispatcher(url: string): NativeDispatcher {
  const origin = normalizeOrigin(url);
  let pool = poolCache.get(origin);

  if (!pool) {
    pool = new Pool(origin, {
      connections: HTTP_POOL_CONNECTIONS,
      pipelining: HTTP_POOL_PIPELINING,
      keepAliveTimeout: HTTP_POOL_KEEP_ALIVE_TIMEOUT_MS,
      keepAliveMaxTimeout: HTTP_POOL_KEEP_ALIVE_MAX_TIMEOUT_MS,
    });
    poolCache.set(origin, pool);
  }

  return pool as unknown as NativeDispatcher;
}

export function pooledFetch(url: string, options: FetchWithDispatcherOptions = {}) {
  const dispatcher = options.dispatcher ?? getPooledDispatcher(url);
  return fetch(url, {
    ...options,
    dispatcher,
  } as RequestInit & { dispatcher: NativeDispatcher });
}

export function clearPooledDispatchers(): void {
  for (const pool of poolCache.values()) {
    pool.close().catch(() => {});
  }
  poolCache.clear();
}
