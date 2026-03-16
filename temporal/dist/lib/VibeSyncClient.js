"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VibeSyncClient = void 0;
exports.clearVibeSyncClientCache = clearVibeSyncClientCache;
exports.createVibeSyncClient = createVibeSyncClient;
const httpPool_1 = require("./httpPool");
const VIBESYNC_MAX_RETRY_ATTEMPTS = Number(process.env.VIBESYNC_MAX_RETRY_ATTEMPTS || 3);
const VIBESYNC_BASE_BACKOFF_MS = Number(process.env.VIBESYNC_BASE_BACKOFF_MS || 250);
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function normalizeVibeSyncBaseUrl(baseUrl) {
    return baseUrl.replace(/\/$/, '');
}
class VibeSyncClient {
    baseUrl;
    timeout;
    constructor(baseUrl, options = {}) {
        this.baseUrl = normalizeVibeSyncBaseUrl(baseUrl);
        this.timeout = options.timeout || 30000;
    }
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };
        for (let attempt = 0; attempt < VIBESYNC_MAX_RETRY_ATTEMPTS; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            try {
                const response = await (0, httpPool_1.pooledFetch)(url, {
                    ...options,
                    headers,
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    const detail = await response.text().catch(() => response.statusText);
                    throw new Error(`VibeSync API error (${response.status}): ${detail}`);
                }
                if (response.status === 204) {
                    return undefined;
                }
                return (await response.json());
            }
            catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof Error && error.name === 'AbortError') {
                    if (attempt < VIBESYNC_MAX_RETRY_ATTEMPTS - 1) {
                        await sleep(VIBESYNC_BASE_BACKOFF_MS * 2 ** attempt);
                        continue;
                    }
                    throw new Error(`VibeSync API timeout after ${this.timeout}ms`);
                }
                if (attempt < VIBESYNC_MAX_RETRY_ATTEMPTS - 1) {
                    const message = error instanceof Error ? error.message.toLowerCase() : '';
                    if (message.includes('fetch') ||
                        message.includes('network') ||
                        message.includes('econnrefused') ||
                        message.includes('timeout')) {
                        await sleep(VIBESYNC_BASE_BACKOFF_MS * 2 ** attempt);
                        continue;
                    }
                }
                throw error;
            }
        }
        throw new Error('VibeSync API request failed after retries');
    }
    async syncBeads(payload) {
        return this.request('/api/beads/sync', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }
    async deleteBeads(payload) {
        return this.request('/api/beads/delete', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }
}
exports.VibeSyncClient = VibeSyncClient;
const vibeSyncClientCache = new Map();
function clearVibeSyncClientCache() {
    vibeSyncClientCache.clear();
}
function createVibeSyncClient(url, options) {
    const baseUrl = url || process.env.VIBESYNC_API_URL || 'http://localhost:3456';
    const normalizedBaseUrl = normalizeVibeSyncBaseUrl(baseUrl);
    const cacheKey = JSON.stringify({
        baseUrl: normalizedBaseUrl,
        timeout: options?.timeout || 30000,
    });
    let client = vibeSyncClientCache.get(cacheKey);
    if (!client) {
        client = new VibeSyncClient(normalizedBaseUrl, options);
        vibeSyncClientCache.set(cacheKey, client);
    }
    return client;
}
//# sourceMappingURL=VibeSyncClient.js.map