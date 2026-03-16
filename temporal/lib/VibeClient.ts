import { pooledFetch } from './httpPool';

export interface VibeTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  project_id?: string;
  hulyRef?: string;
}

export interface CreateVibeTaskInput {
  title: string;
  description?: string;
  status: string;
  hulyRef?: string;
}

export interface VibeClientOptions {
  timeout?: number;
  name?: string;
}

const VIBE_MAX_RETRY_ATTEMPTS = Number(process.env.VIBE_MAX_RETRY_ATTEMPTS || 3);
const VIBE_BASE_BACKOFF_MS = Number(process.env.VIBE_BASE_BACKOFF_MS || 250);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeVibeBaseUrl(baseUrl: string): string {
  return (
    baseUrl
      .replace(/\/api$/, '')
      .replace(/\/$/, '')
      .replace(/:\d+/, ':3105') + '/api'
  );
}

export class VibeClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string, options: VibeClientOptions = {}) {
    this.baseUrl = normalizeVibeBaseUrl(baseUrl);
    this.timeout = options.timeout || 30000;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    for (let attempt = 0; attempt < VIBE_MAX_RETRY_ATTEMPTS; attempt++) {
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
          throw new Error(`Vibe API error (${response.status}): ${detail}`);
        }

        if (response.status === 204) {
          return undefined as T;
        }

        return (await response.json()) as T;
      } catch (error) {
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
          if (
            message.includes('fetch') ||
            message.includes('network') ||
            message.includes('econnrefused') ||
            message.includes('timeout')
          ) {
            await sleep(VIBE_BASE_BACKOFF_MS * 2 ** attempt);
            continue;
          }
        }

        throw error;
      }
    }

    throw new Error('Vibe API request failed after retries');
  }

  async createTask(projectId: string, data: CreateVibeTaskInput): Promise<VibeTask> {
    return this.request<VibeTask>(`/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTask(taskId: string, updates: Partial<VibeTask>): Promise<VibeTask> {
    return this.request<VibeTask>(`/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async deleteTask(taskId: string): Promise<boolean> {
    await this.request<void>(`/tasks/${taskId}`, {
      method: 'DELETE',
    });
    return true;
  }
}

const vibeClientCache = new Map<string, VibeClient>();

export function clearVibeClientCache(): void {
  vibeClientCache.clear();
}

export function createVibeClient(url?: string, options?: VibeClientOptions): VibeClient {
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
