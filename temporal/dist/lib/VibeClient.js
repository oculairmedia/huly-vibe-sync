"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VibeClient = void 0;
exports.clearVibeClientCache = clearVibeClientCache;
exports.createVibeClient = createVibeClient;
const httpPool_1 = require("./httpPool");
const VIBE_MAX_RETRY_ATTEMPTS = Number(process.env.VIBE_MAX_RETRY_ATTEMPTS || 3);
const VIBE_BASE_BACKOFF_MS = Number(process.env.VIBE_BASE_BACKOFF_MS || 250);
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function normalizeVibeBaseUrl(baseUrl) {
    return (baseUrl
        .replace(/\/api$/, '')
        .replace(/\/$/, '')
        .replace(/:\d+/, ':3105') + '/api');
}
class VibeClient {
    baseUrl;
    timeout;
    constructor(baseUrl, options = {}) {
        this.baseUrl = normalizeVibeBaseUrl(baseUrl);
        this.timeout = options.timeout || 30000;
    }
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };
        for (let attempt = 0; attempt < VIBE_MAX_RETRY_ATTEMPTS; attempt++) {
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
                    throw new Error(`Vibe API error (${response.status}): ${detail}`);
                }
                if (response.status === 204) {
                    return undefined;
                }
                return (await response.json());
            }
            catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof Error && error.name === 'AbortError') {
                    if (attempt < VIBE_MAX_RETRY_ATTEMPTS - 1) {
                        await sleep(VIBE_BASE_BACKOFF_MS * 2 ** attempt);
                        continue;
                    }
                    throw new Error(`Vibe API timeout after ${this.timeout}ms`);
                }
                if (attempt < VIBE_MAX_RETRY_ATTEMPTS - 1) {
                    const message = error instanceof Error ? error.message.toLowerCase() : '';
                    if (message.includes('fetch') ||
                        message.includes('network') ||
                        message.includes('econnrefused') ||
                        message.includes('timeout')) {
                        await sleep(VIBE_BASE_BACKOFF_MS * 2 ** attempt);
                        continue;
                    }
                }
                throw error;
            }
        }
        throw new Error('Vibe API request failed after retries');
    }
    async createTask(projectId, data) {
        return this.request(`/projects/${projectId}/tasks`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    async updateTask(taskId, updates) {
        return this.request(`/tasks/${taskId}`, {
            method: 'PATCH',
            body: JSON.stringify(updates),
        });
    }
    async deleteTask(taskId) {
        await this.request(`/tasks/${taskId}`, {
            method: 'DELETE',
        });
        return true;
    }
}
exports.VibeClient = VibeClient;
const vibeClientCache = new Map();
function clearVibeClientCache() {
    vibeClientCache.clear();
}
function createVibeClient(url, options) {
    const baseUrl = url || process.env.VIBE_API_URL || 'http://localhost:3105/api';
    const normalizedBaseUrl = normalizeVibeBaseUrl(baseUrl);
    const cacheKey = JSON.stringify({
        baseUrl: normalizedBaseUrl,
        timeout: options?.timeout || 30000,
        name: options?.name || 'Vibe',
    });
    let client = vibeClientCache.get(cacheKey);
    if (!client) {
        client = new VibeClient(normalizedBaseUrl, options);
        vibeClientCache.set(cacheKey, client);
    }
    return client;
}
//# sourceMappingURL=VibeClient.js.map