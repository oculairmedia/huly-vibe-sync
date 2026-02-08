/**
 * Huly REST API Client (TypeScript)
 *
 * Pure TypeScript client for Huly platform.
 * Used by Temporal activities for durable workflow execution.
 */

export interface HulyProject {
  identifier: string;
  name: string;
  description?: string;
  archived?: boolean;
}

export interface HulyIssue {
  identifier: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  assignee?: string;
  component?: string;
  milestone?: string;
  dueDate?: string;
  modifiedOn?: number;
  createdOn?: number;
  parentIssue?: string;
  subIssues?: string[];
}

export interface CreateIssueInput {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  component?: string;
}

export interface HulyClientOptions {
  timeout?: number;
  name?: string;
}

const HULY_MIN_REQUEST_INTERVAL_MS = Number(process.env.HULY_MIN_REQUEST_INTERVAL_MS || 75);
const HULY_MAX_RETRY_ATTEMPTS = Number(process.env.HULY_MAX_RETRY_ATTEMPTS || 4);
const HULY_BASE_BACKOFF_MS = Number(process.env.HULY_BASE_BACKOFF_MS || 400);

let nextHulyRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function throttleHulyRequestStart(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, nextHulyRequestAt - now);
  nextHulyRequestAt = Math.max(nextHulyRequestAt, now) + HULY_MIN_REQUEST_INTERVAL_MS;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

function parseRetryAfterMs(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, numeric * 1000);
  }

  const retryDate = Date.parse(value);
  if (Number.isNaN(retryDate)) return null;
  return Math.max(0, retryDate - Date.now());
}

/**
 * Options for bulk fetching issues from multiple projects
 * @see POST /api/issues/bulk-by-projects
 */
export interface BulkByProjectsOptions {
  /** Array of project identifiers (max 100) */
  projects: string[];
  /** Only return issues modified after this ISO 8601 timestamp */
  modifiedSince?: string;
  /** Only return issues created after this ISO 8601 timestamp */
  createdSince?: string;
  /** Max issues per project (default: 1000) */
  limit?: number;
  /** Include issue descriptions (default: true, set false for 5x speed) */
  includeDescriptions?: boolean;
  /** Specific fields to return (default: all) */
  fields?: string[];
}

/**
 * Response from bulk-by-projects endpoint
 */
export interface BulkByProjectsResponse {
  projects: Record<
    string,
    {
      issues: HulyIssue[];
      count: number;
      syncMeta?: {
        latestModified: string;
        fetchedAt: string;
      };
      error?: string;
    }
  >;
  totalIssues: number;
  projectCount: number;
  syncMeta: {
    modifiedSince: string | null;
    createdSince: string | null;
    latestModified: string;
    serverTime: string;
  };
  notFound?: string[];
}

/**
 * A single issue update entry for bulk operations.
 * Each entry specifies an issue identifier and the changes to apply.
 */
export interface BulkUpdateEntry {
  /** Issue identifier (e.g., "HVSYN-925") */
  identifier: string;
  /** Fields to update on this issue */
  changes: Partial<HulyIssue>;
}

/**
 * Options for bulk update operations on issues.
 * The Huly API expects: { updates: [{ identifier, changes }, ...] }
 */
export interface BulkUpdateOptions {
  /** Array of per-issue update entries */
  updates: BulkUpdateEntry[];
}

export interface BulkDeleteOptions {
  /** Issue identifiers to delete (max 100 per request) */
  identifiers: string[];
  /** Whether to cascade delete sub-issues (default: false) */
  cascade?: boolean;
}

export interface BulkDeleteResult {
  succeeded: string[];
  failed: Array<{ identifier: string; error: string }>;
  total: number;
}

/**
 * TypeScript REST client for Huly
 */
export class HulyClient {
  private baseUrl: string;
  private timeout: number;
  private name: string;

  constructor(baseUrl: string, options: HulyClientOptions = {}) {
    // Normalize URL: ensure port 3458 and /api suffix
    this.baseUrl =
      baseUrl
        .replace(/\/mcp$/, '')
        .replace(/\/api$/, '')
        .replace(/:\d+/, ':3458') + '/api';
    this.timeout = options.timeout || 120000;
    this.name = options.name || 'Huly';
  }

  /**
   * Make an HTTP request with timeout and error handling
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    for (let attempt = 0; attempt < HULY_MAX_RETRY_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        await throttleHulyRequestStart();

        const response = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (
            (response.status === 429 || response.status === 503) &&
            attempt < HULY_MAX_RETRY_ATTEMPTS - 1
          ) {
            const retryAfterMs = parseRetryAfterMs(response);
            const jitter = Math.floor(Math.random() * 200);
            const fallbackBackoff = HULY_BASE_BACKOFF_MS * 2 ** attempt;
            await sleep((retryAfterMs ?? fallbackBackoff) + jitter);
            continue;
          }

          const errorText = await response.text();
          throw new Error(`Huly API error (${response.status}): ${errorText}`);
        }

        return (await response.json()) as T;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          if (attempt < HULY_MAX_RETRY_ATTEMPTS - 1) {
            await sleep(HULY_BASE_BACKOFF_MS * 2 ** attempt);
            continue;
          }
          throw new Error(`Huly API timeout after ${this.timeout}ms`);
        }

        if (attempt < HULY_MAX_RETRY_ATTEMPTS - 1) {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (
            message.includes('fetch') ||
            message.includes('network') ||
            message.includes('econnrefused')
          ) {
            await sleep(HULY_BASE_BACKOFF_MS * 2 ** attempt);
            continue;
          }
        }

        throw error;
      }
    }

    throw new Error('Huly API request failed after retries');
  }

  /**
   * Test API connectivity
   */
  async healthCheck(): Promise<{ status: string; connected: boolean }> {
    const healthUrl = this.baseUrl.replace('/api', '/health');
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Huly health check failed: ${response.status}`);
    }

    return (await response.json()) as { status: string; connected: boolean };
  }

  // ============================================================
  // PROJECT OPERATIONS
  // ============================================================

  async listProjects(): Promise<HulyProject[]> {
    const result = await this.request<{ projects: HulyProject[] }>('/projects', { method: 'GET' });
    return result.projects;
  }

  // ============================================================
  // ISSUE OPERATIONS
  // ============================================================

  async listIssues(
    projectIdentifier: string,
    options: { modifiedSince?: string; limit?: number } = {}
  ): Promise<HulyIssue[]> {
    const params = new URLSearchParams();
    if (options.modifiedSince) params.append('modifiedSince', options.modifiedSince);
    if (options.limit) params.append('limit', options.limit.toString());

    const queryString = params.toString();
    const url = `/projects/${projectIdentifier}/issues${queryString ? '?' + queryString : ''}`;

    const result = await this.request<{ issues: HulyIssue[]; count: number }>(url, {
      method: 'GET',
    });
    return result.issues;
  }

  async getIssue(issueIdentifier: string): Promise<HulyIssue | null> {
    try {
      return await this.request<HulyIssue>(`/issues/${issueIdentifier}`, { method: 'GET' });
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async createIssue(projectIdentifier: string, data: CreateIssueInput): Promise<HulyIssue> {
    return this.request<HulyIssue>('/issues', {
      method: 'POST',
      body: JSON.stringify({
        project_identifier: projectIdentifier,
        ...data,
      }),
    });
  }

  async updateIssue(issueIdentifier: string, field: string, value: string): Promise<HulyIssue> {
    return this.request<HulyIssue>(`/issues/${issueIdentifier}`, {
      method: 'PUT',
      body: JSON.stringify({ field, value }),
    });
  }

  async patchIssue(issueIdentifier: string, updates: Partial<HulyIssue>): Promise<HulyIssue> {
    return this.request<HulyIssue>(`/issues/${issueIdentifier}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async deleteIssue(issueIdentifier: string, cascade = false): Promise<boolean> {
    const url = cascade ? `/issues/${issueIdentifier}?cascade=true` : `/issues/${issueIdentifier}`;

    await this.request<void>(url, { method: 'DELETE' });
    return true;
  }

  // ============================================================
  // SUB-ISSUE OPERATIONS
  // ============================================================

  async getSubIssues(issueIdentifier: string): Promise<{ subIssues: HulyIssue[]; count: number }> {
    return this.request<{ subIssues: HulyIssue[]; count: number }>(
      `/issues/${issueIdentifier}/subissues`,
      { method: 'GET' }
    );
  }

  async createSubIssue(parentIdentifier: string, data: CreateIssueInput): Promise<HulyIssue> {
    return this.request<HulyIssue>(`/issues/${parentIdentifier}/subissues`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============================================================
  // COMMENT OPERATIONS
  // ============================================================

  async getComments(
    issueIdentifier: string
  ): Promise<Array<{ id: string; text: string; createdAt: string }>> {
    const result = await this.request<{
      comments: Array<{ id: string; text: string; createdAt: string }>;
    }>(`/issues/${issueIdentifier}/comments`, { method: 'GET' });
    return result.comments;
  }

  async createComment(
    issueIdentifier: string,
    text: string
  ): Promise<{ id: string; text: string }> {
    return this.request<{ id: string; text: string }>(`/issues/${issueIdentifier}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  // ============================================================
  // BULK OPERATIONS (High-performance endpoints)
  // ============================================================

  async listIssuesBulk(options: BulkByProjectsOptions): Promise<BulkByProjectsResponse> {
    return this.request<BulkByProjectsResponse>('/issues/bulk-by-projects', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async getIssuesByIds(
    identifiers: string[]
  ): Promise<{ issues: HulyIssue[]; notFound: string[] }> {
    const params = new URLSearchParams();
    params.append('ids', identifiers.join(','));

    return this.request<{ issues: HulyIssue[]; notFound: string[] }>(
      `/issues/bulk?${params.toString()}`,
      { method: 'GET' }
    );
  }

  async bulkUpdateIssues(options: BulkUpdateOptions): Promise<{
    succeeded: string[];
    failed: Array<{ identifier: string; error: string }>;
  }> {
    const response = await this.request<{
      results: Array<{ identifier: string; updated: boolean; error?: string }>;
      succeeded: number;
      failed: number;
    }>('/issues/bulk', {
      method: 'PATCH',
      body: JSON.stringify(options),
    });

    const succeeded: string[] = [];
    const failed: Array<{ identifier: string; error: string }> = [];
    for (const r of response.results) {
      if (r.updated) {
        succeeded.push(r.identifier);
      } else {
        failed.push({ identifier: r.identifier, error: r.error || 'unknown error' });
      }
    }
    return { succeeded, failed };
  }

  async bulkDeleteIssues(options: BulkDeleteOptions): Promise<BulkDeleteResult> {
    return this.request<BulkDeleteResult>('/issues/bulk', {
      method: 'DELETE',
      body: JSON.stringify(options),
    });
  }

  // ============================================================
  // PROJECT METADATA
  // ============================================================

  async getProjectTree(projectIdentifier: string): Promise<{
    project: HulyProject;
    issues: HulyIssue[];
    tree: Array<{ identifier: string; children: string[] }>;
  }> {
    return this.request<{
      project: HulyProject;
      issues: HulyIssue[];
      tree: Array<{ identifier: string; children: string[] }>;
    }>(`/projects/${projectIdentifier}/tree`, { method: 'GET' });
  }

  async getProjectComponents(
    projectIdentifier: string
  ): Promise<{ components: Array<{ label: string; description?: string }> }> {
    return this.request<{ components: Array<{ label: string; description?: string }> }>(
      `/projects/${projectIdentifier}/components`,
      { method: 'GET' }
    );
  }

  async updateProject(
    projectIdentifier: string,
    updates: Partial<HulyProject>
  ): Promise<HulyProject> {
    return this.request<HulyProject>(`/projects/${projectIdentifier}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  // ============================================================
  // ISSUE QUERIES
  // ============================================================

  async listAllIssues(
    options: {
      status?: string;
      limit?: number;
      modifiedSince?: string;
      includeDescriptions?: boolean;
      fields?: string[];
    } = {}
  ): Promise<{ issues: HulyIssue[]; count: number }> {
    const params = new URLSearchParams();
    if (options.status) params.append('status', options.status);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.modifiedSince) params.append('modifiedSince', options.modifiedSince);
    if (options.includeDescriptions !== undefined) {
      params.append('includeDescriptions', String(options.includeDescriptions));
    }
    if (options.fields) params.append('fields', options.fields.join(','));

    const queryString = params.toString();
    return this.request<{ issues: HulyIssue[]; count: number }>(
      `/issues/all${queryString ? '?' + queryString : ''}`,
      { method: 'GET' }
    );
  }

  async listIssuesByStatus(status: string, limit = 100): Promise<HulyIssue[]> {
    const params = new URLSearchParams();
    params.append('status', status);
    params.append('limit', limit.toString());

    const result = await this.request<{ issues: HulyIssue[]; count: number }>(
      `/issues?${params.toString()}`,
      { method: 'GET' }
    );
    return result.issues;
  }

  // ============================================================
  // PARENT/CHILD OPERATIONS
  // ============================================================

  async setParentIssue(
    issueIdentifier: string,
    parentIdentifier: string | null
  ): Promise<HulyIssue> {
    return this.request<HulyIssue>(`/issues/${issueIdentifier}/parent`, {
      method: 'PATCH',
      body: JSON.stringify({ parentIdentifier }),
    });
  }

  // ============================================================
  // SYNC HELPERS
  // ============================================================

  async syncStatusFromVibe(
    issueIdentifier: string,
    hulyStatus: string
  ): Promise<{ success: boolean; issue?: HulyIssue; error?: string }> {
    try {
      const issue = await this.updateIssue(issueIdentifier, 'status', hulyStatus);
      return { success: true, issue };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Factory function to create Huly client
 */
export function createHulyClient(url?: string, options?: HulyClientOptions): HulyClient {
  const baseUrl = url || process.env.HULY_API_URL || 'http://localhost:3458';
  return new HulyClient(baseUrl, options);
}
