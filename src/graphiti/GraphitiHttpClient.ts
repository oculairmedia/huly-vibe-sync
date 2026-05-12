import { fetchWithPool } from '../http';
import { logger } from '../logger';

export class RateLimiter {
  private tokensPerSecond: number;
  private tokens: number;
  private lastRefill: number;

  constructor(tokensPerSecond: number) {
    this.tokensPerSecond = tokensPerSecond;
    this.tokens = tokensPerSecond;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }
    const waitMs = Math.ceil((1 - this.tokens) * (1000 / this.tokensPerSecond));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this._refill();
    this.tokens--;
  }

  private _refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = (elapsed / 1000) * this.tokensPerSecond;
    this.tokens = Math.min(this.tokensPerSecond, this.tokens + newTokens);
    this.lastRefill = now;
  }
}

interface Stats {
  entitiesCreated: number;
  entitiesUpdated: number;
  pruneOperations: number;
  edgesCreated?: number;
  edgesFallback?: number;
  errors: number;
  retries: number;
}

interface HttpClientOptions {
  baseUrl: string;
  groupId: string;
  timeout?: number;
  retries?: number;
  retryDelayMs?: number;
}

interface Logger {
  child: (ctx: Record<string, unknown>) => {
    debug: (ctx: Record<string, unknown>, msg: string) => void;
    info: (ctx: Record<string, unknown>, msg: string) => void;
    warn: (ctx: Record<string, unknown>, msg: string) => void;
    error: (ctx: Record<string, unknown>, msg: string) => void;
  };
}

export class GraphitiHttpClient {
  baseUrl: string;
  groupId: string;
  timeout: number;
  retries: number;
  retryDelayMs: number;
  log: ReturnType<Logger['child']>;
  stats: Stats;
  uuidCache?: Map<string, string>;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, '') ?? '';
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

  async getEntityUuid(name: string, groupId: string = this.groupId): Promise<string> {
    const cacheKey = `${groupId}:${name}`;
    if (this.uuidCache?.has(cacheKey)) {
      return this.uuidCache.get(cacheKey)!;
    }

    const url = new URL(`${this.baseUrl}/api/utils/uuid`);
    url.searchParams.set('name', name);
    url.searchParams.set('group_id', groupId);

    const response = (await this._fetch(url.toString(), { method: 'GET' })) as { uuid: string };
    const uuid = response.uuid;

    if (!this.uuidCache) this.uuidCache = new Map();
    this.uuidCache.set(cacheKey, uuid);

    return uuid;
  }

  async getEdgeUuid(
    sourceUuid: string,
    targetUuid: string,
    name: string,
    groupId: string = this.groupId,
  ): Promise<string> {
    const url = new URL(`${this.baseUrl}/api/utils/edge-uuid`);
    url.searchParams.set('source_uuid', sourceUuid);
    url.searchParams.set('target_uuid', targetUuid);
    url.searchParams.set('name', name);
    url.searchParams.set('group_id', groupId);

    const response = (await this._fetch(url.toString(), { method: 'GET' })) as { uuid: string };
    return response.uuid;
  }

  getStats(): Stats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      entitiesCreated: 0,
      entitiesUpdated: 0,
      pruneOperations: 0,
      errors: 0,
      retries: 0,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetchWithPool(`${this.baseUrl}/healthcheck`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch (error) {
      (this.log as unknown as { warn?: (ctx: Record<string, unknown>, msg: string) => void }).warn?.(
        { error: (error as Error).message },
        'Health check failed',
      );
      return false;
    }
  }

  async _fetch(
    url: string,
    options: Record<string, unknown>,
    attempt: number = 1,
  ): Promise<unknown> {
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
      const isRetryable = this._isRetryableError(error as NodeJS.ErrnoException & { name?: string });

      if (isRetryable && attempt < this.retries) {
        this.stats.retries++;
        const delay = this.retryDelayMs * attempt;
        (this.log as unknown as { warn?: (ctx: Record<string, unknown>, msg: string) => void }).warn?.(
          { attempt, delay, error: (error as Error).message },
          'Retrying request',
        );
        await this._delay(delay);
        return this._fetch(url, options, attempt + 1);
      }

      this.stats.errors++;
      (this.log as unknown as { error?: (ctx: Record<string, unknown>, msg: string) => void }).error?.(
        { url, error: (error as Error).message },
        'Request failed',
      );
      throw error;
    }
  }

  _isRetryableError(error: NodeJS.ErrnoException & { name?: string }): boolean {
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

  _delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async _parallelLimit<T>(
    items: T[],
    operation: (item: T) => Promise<unknown>,
    limit: number,
  ): Promise<void> {
    const executing = new Set<Promise<unknown>>();

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
