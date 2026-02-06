/**
 * Graphiti HTTP Client - Low-level HTTP operations, retry logic, rate limiting
 */

import { fetchWithPool } from '../http.js';
import { logger } from '../logger.js';

/**
 * Simple token bucket rate limiter
 */
export class RateLimiter {
  constructor(tokensPerSecond) {
    this.tokensPerSecond = tokensPerSecond;
    this.tokens = tokensPerSecond;
    this.lastRefill = Date.now();
  }

  async acquire() {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }
    const waitMs = Math.ceil((1 - this.tokens) * (1000 / this.tokensPerSecond));
    await new Promise(resolve => setTimeout(resolve, waitMs));
    this._refill();
    this.tokens--;
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = (elapsed / 1000) * this.tokensPerSecond;
    this.tokens = Math.min(this.tokensPerSecond, this.tokens + newTokens);
    this.lastRefill = now;
  }
}

export class GraphitiHttpClient {
  constructor(options) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, '');
    this.groupId = options.groupId;
    this.timeout = options.timeout || 30000;
    this.retries = options.retries ?? 3;
    this.retryDelayMs = options.retryDelayMs || 1000;

    this.log = logger.child({ service: 'GraphitiClient', groupId: this.groupId });

    this.stats = {
      entitiesCreated: 0,
      entitiesUpdated: 0,
      pruneOperations: 0,
      errors: 0,
      retries: 0,
    };
  }

  async getEntityUuid(name, groupId = this.groupId) {
    const cacheKey = `${groupId}:${name}`;
    if (this.uuidCache?.has(cacheKey)) {
      return this.uuidCache.get(cacheKey);
    }

    const url = new URL(`${this.baseUrl}/api/utils/uuid`);
    url.searchParams.set('name', name);
    url.searchParams.set('group_id', groupId);

    const response = await this._fetch(url.toString(), { method: 'GET' });
    const uuid = response.uuid;

    if (!this.uuidCache) this.uuidCache = new Map();
    this.uuidCache.set(cacheKey, uuid);

    return uuid;
  }

  async getEdgeUuid(sourceUuid, targetUuid, name, groupId = this.groupId) {
    const url = new URL(`${this.baseUrl}/api/utils/edge-uuid`);
    url.searchParams.set('source_uuid', sourceUuid);
    url.searchParams.set('target_uuid', targetUuid);
    url.searchParams.set('name', name);
    url.searchParams.set('group_id', groupId);

    const response = await this._fetch(url.toString(), { method: 'GET' });
    return response.uuid;
  }

  getStats() {
    return { ...this.stats };
  }

  resetStats() {
    this.stats = {
      entitiesCreated: 0,
      entitiesUpdated: 0,
      pruneOperations: 0,
      errors: 0,
      retries: 0,
    };
  }

  async healthCheck() {
    try {
      const response = await fetchWithPool(`${this.baseUrl}/healthcheck`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch (error) {
      this.log.warn({ error: error.message }, 'Health check failed');
      return false;
    }
  }

  async _fetch(url, options, attempt = 1) {
    try {
      const response = await fetchWithPool(url, {
        ...options,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      return response.json();
    } catch (error) {
      const isRetryable = this._isRetryableError(error);

      if (isRetryable && attempt < this.retries) {
        this.stats.retries++;
        const delay = this.retryDelayMs * attempt;
        this.log.warn({ attempt, delay, error: error.message }, 'Retrying request');
        await this._delay(delay);
        return this._fetch(url, options, attempt + 1);
      }

      this.stats.errors++;
      this.log.error({ url, error: error.message }, 'Request failed');
      throw error;
    }
  }

  _isRetryableError(error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      return true;
    }
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return true;
    }
    if (error.message?.includes('HTTP 5')) {
      return true;
    }
    if (error.message?.includes('HTTP 429')) {
      return true;
    }
    return false;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _parallelLimit(items, operation, limit) {
    const executing = new Set();

    for (const item of items) {
      const promise = operation(item).finally(() => executing.delete(promise));
      executing.add(promise);

      if (executing.size >= limit) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
  }
}
