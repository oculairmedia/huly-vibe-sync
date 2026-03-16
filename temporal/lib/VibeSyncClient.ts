import { pooledFetch } from './httpPool';

export interface VibeSyncClientOptions {
  timeout?: number;
}

const VIBESYNC_MAX_RETRY_ATTEMPTS = Number(process.env.VIBESYNC_MAX_RETRY_ATTEMPTS || 3);
const VIBESYNC_BASE_BACKOFF_MS = Number(process.env.VIBESYNC_BASE_BACKOFF_MS || 250);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeVibeSyncBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

export class VibeSyncClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string, options: VibeSyncClientOptions = {}) {
    this.baseUrl = normalizeVibeSyncBaseUrl(baseUrl);
    this.timeout = options.timeout || 30000;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    for (let attempt = 0; attempt < VIBESYNC_MAX_RETRY_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await pooledFetch(url, {
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
          return undefined as T;
        }

        return (await response.json()) as T;
      } catch (error) {
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
          if (
            message.includes('fetch') ||
            message.includes('network') ||
            message.includes('econnrefused') ||
            message.includes('timeout')
          ) {
            await sleep(VIBESYNC_BASE_BACKOFF_MS * 2 ** attempt);
            continue;
          }
        }

        throw error;
      }
    }

    throw new Error('VibeSync API request failed after retries');
  }

  async syncBeads(payload: {
    projectId: string;
  }): Promise<{ message?: string; results?: Array<{ project: string; workflowId?: string; error?: string }> }> {
    return this.request('/api/beads/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteBeads(payload: { beadsId: string }): Promise<{ success?: boolean }> {
    return this.request('/api/beads/delete', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

const vibeSyncClientCache = new Map<string, VibeSyncClient>();

export function clearVibeSyncClientCache(): void {
  vibeSyncClientCache.clear();
}

export function createVibeSyncClient(
  url?: string,
  options?: VibeSyncClientOptions
): VibeSyncClient {
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
