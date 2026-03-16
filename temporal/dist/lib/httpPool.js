"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPooledDispatcher = getPooledDispatcher;
exports.pooledFetch = pooledFetch;
exports.clearPooledDispatchers = clearPooledDispatchers;
const undici_1 = require("undici");
const HTTP_POOL_CONNECTIONS = Number(process.env.TEMPORAL_HTTP_POOL_CONNECTIONS || 10);
const HTTP_POOL_PIPELINING = Number(process.env.TEMPORAL_HTTP_POOL_PIPELINING || 1);
const HTTP_POOL_KEEP_ALIVE_TIMEOUT_MS = Number(process.env.TEMPORAL_HTTP_POOL_KEEP_ALIVE_TIMEOUT_MS || 300_000);
const HTTP_POOL_KEEP_ALIVE_MAX_TIMEOUT_MS = Number(process.env.TEMPORAL_HTTP_POOL_KEEP_ALIVE_MAX_TIMEOUT_MS || 600_000);
const poolCache = new Map();
function normalizeOrigin(url) {
    return new URL(url).origin;
}
function getPooledDispatcher(url) {
    const origin = normalizeOrigin(url);
    let pool = poolCache.get(origin);
    if (!pool) {
        pool = new undici_1.Pool(origin, {
            connections: HTTP_POOL_CONNECTIONS,
            pipelining: HTTP_POOL_PIPELINING,
            keepAliveTimeout: HTTP_POOL_KEEP_ALIVE_TIMEOUT_MS,
            keepAliveMaxTimeout: HTTP_POOL_KEEP_ALIVE_MAX_TIMEOUT_MS,
        });
        poolCache.set(origin, pool);
    }
    return pool;
}
function pooledFetch(url, options = {}) {
    const dispatcher = options.dispatcher ?? getPooledDispatcher(url);
    return fetch(url, {
        ...options,
        dispatcher,
    });
}
function clearPooledDispatchers() {
    for (const pool of poolCache.values()) {
        pool.close().catch(() => { });
    }
    poolCache.clear();
}
//# sourceMappingURL=httpPool.js.map