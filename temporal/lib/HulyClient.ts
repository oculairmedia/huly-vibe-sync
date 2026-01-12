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
    this.timeout = options.timeout || 60000;
    this.name = options.name || 'Huly';
  }

  /**
   * Make an HTTP request with timeout and error handling
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Huly API error (${response.status}): ${errorText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Huly API timeout after ${this.timeout}ms`);
      }
      throw error;
    }
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

  /**
   * Find an existing issue by title (for deduplication)
   * Returns the first matching issue or null
   */
  async findIssueByTitle(projectIdentifier: string, title: string): Promise<HulyIssue | null> {
    try {
      const issues = await this.listIssues(projectIdentifier, { limit: 500 });
      const normalizedTitle = title.toLowerCase().trim();

      return issues.find(issue => issue.title.toLowerCase().trim() === normalizedTitle) || null;
    } catch (error) {
      console.warn(`[HulyClient] findIssueByTitle failed: ${error}`);
      return null;
    }
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
  // SYNC HELPERS
  // ============================================================

  /**
   * Update issue status from Vibe task
   */
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
