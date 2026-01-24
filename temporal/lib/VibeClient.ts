/**
 * Vibe Kanban REST API Client (TypeScript)
 *
 * Pure TypeScript client for Vibe Kanban platform.
 * Used by Temporal activities for durable workflow execution.
 */

export interface VibeProject {
  id: string;
  name: string;
  git_repo_path?: string;
  created_at?: string;
  updated_at?: string;
}

export interface VibeTask {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  status: 'todo' | 'inprogress' | 'inreview' | 'done' | 'cancelled';
  priority?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
}

export interface VibeClientOptions {
  timeout?: number;
  name?: string;
}

/**
 * TypeScript REST client for Vibe Kanban
 */
export class VibeClient {
  private baseUrl: string;
  private timeout: number;
  private name: string;

  constructor(baseUrl: string, options: VibeClientOptions = {}) {
    // Normalize URL: ensure port 3105 and /api suffix
    this.baseUrl =
      baseUrl
        .replace(/\/mcp$/, '')
        .replace(/\/api$/, '')
        .replace(/:\d+/, ':3105') + '/api';
    this.timeout = options.timeout || 60000;
    this.name = options.name || 'Vibe';
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
        throw new Error(`Vibe API error (${response.status}): ${errorText}`);
      }

      const result = (await response.json()) as {
        success?: boolean;
        data?: T;
        message?: string;
      } & T;

      // Vibe API returns { success, data, message } format
      if (result.success === false) {
        throw new Error(`Vibe API failed: ${result.message || 'Unknown error'}`);
      }

      return (result.data || result) as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Vibe API timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Test API connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      const healthUrl = this.baseUrl.replace('/api', '/health');
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ============================================================
  // PROJECT OPERATIONS
  // ============================================================

  async listProjects(): Promise<VibeProject[]> {
    return this.request<VibeProject[]>('/projects', { method: 'GET' });
  }

  async getProject(projectId: string): Promise<VibeProject> {
    return this.request<VibeProject>(`/projects/${projectId}`, { method: 'GET' });
  }

  async createProject(data: {
    name: string;
    repositories?: Array<{ display_name: string; git_repo_path: string }>;
  }): Promise<VibeProject> {
    return this.request<VibeProject>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============================================================
  // TASK OPERATIONS
  // ============================================================

  async listTasks(
    projectId: string,
    options: { status?: string; limit?: number } = {}
  ): Promise<VibeTask[]> {
    const params = new URLSearchParams({ project_id: projectId });
    if (options.status) params.append('status', options.status);
    if (options.limit) params.append('limit', options.limit.toString());

    return this.request<VibeTask[]>(`/tasks?${params}`, { method: 'GET' });
  }

  async getTask(taskId: string): Promise<VibeTask> {
    return this.request<VibeTask>(`/tasks/${taskId}`, { method: 'GET' });
  }

  async createTask(projectId: string, data: CreateTaskInput): Promise<VibeTask> {
    return this.request<VibeTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        ...data,
      }),
    });
  }

  async updateTask(taskId: string, field: string, value: string): Promise<VibeTask> {
    return this.request<VibeTask>(`/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ [field]: value }),
    });
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request<void>(`/tasks/${taskId}`, { method: 'DELETE' });
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  /**
   * Find a task by Huly identifier in description
   */
  async findTaskByHulyId(projectId: string, hulyIdentifier: string): Promise<VibeTask | null> {
    try {
      const tasks = await this.listTasks(projectId);

      // Look for Huly identifier in description
      const match = tasks.find(task => {
        if (!task.description) return false;
        const idMatch = task.description.match(/(?:Huly Issue|Synced from Huly):\s*([A-Z]+-\d+)/i);
        return idMatch && idMatch[1] === hulyIdentifier;
      });

      return match || null;
    } catch {
      return null;
    }
  }

  /**
   * Create or update a task from a Huly issue
   */
  async syncFromHuly(
    projectId: string,
    issue: {
      identifier: string;
      title: string;
      description?: string;
      status: string;
    },
    vibeStatus: string,
    existingTaskId?: string
  ): Promise<{ task: VibeTask | null; created: boolean; updated: boolean; skipped: boolean }> {
    // Check for existing task
    if (!existingTaskId) {
      const existing = await this.findTaskByHulyId(projectId, issue.identifier);
      if (existing) {
        return { task: existing, created: false, updated: false, skipped: true };
      }
    }

    // Create description with Huly reference
    const description = issue.description
      ? `${issue.description}\n\n---\nHuly Issue: ${issue.identifier}`
      : `Synced from Huly: ${issue.identifier}`;

    if (existingTaskId) {
      // Update existing task
      await this.updateTask(existingTaskId, 'status', vibeStatus);
      const updated = await this.getTask(existingTaskId);
      return { task: updated, created: false, updated: true, skipped: false };
    }

    // Create new task
    const task = await this.createTask(projectId, {
      title: issue.title,
      description,
      status: vibeStatus,
    });

    return { task, created: true, updated: false, skipped: false };
  }

  async findTaskByBeadsId(projectId: string, beadsId: string): Promise<VibeTask | null> {
    try {
      const tasks = await this.listTasks(projectId);
      const match = tasks.find(task => {
        if (!task.description) return false;
        return task.description.includes(`Beads Issue: ${beadsId}`);
      });
      return match || null;
    } catch {
      return null;
    }
  }

  async findTaskByTitle(projectId: string, title: string): Promise<VibeTask | null> {
    try {
      const tasks = await this.listTasks(projectId);
      const normalizedTitle = title.toLowerCase().trim();
      return tasks.find(t => t.title.toLowerCase().trim() === normalizedTitle) || null;
    } catch {
      return null;
    }
  }

  async syncFromBeads(
    projectId: string,
    beadsIssue: {
      id: string;
      title: string;
      description?: string;
      status: string;
    },
    vibeStatus: string
  ): Promise<{ task: VibeTask | null; created: boolean; updated: boolean; skipped: boolean }> {
    const existing = await this.findTaskByBeadsId(projectId, beadsIssue.id);
    if (existing) {
      if (existing.status !== vibeStatus) {
        await this.updateTask(existing.id, 'status', vibeStatus);
        const updated = await this.getTask(existing.id);
        return { task: updated, created: false, updated: true, skipped: false };
      }
      return { task: existing, created: false, updated: false, skipped: true };
    }

    const existingByTitle = await this.findTaskByTitle(projectId, beadsIssue.title);
    if (existingByTitle) {
      return { task: existingByTitle, created: false, updated: false, skipped: true };
    }

    const description = beadsIssue.description
      ? `${beadsIssue.description}\n\n---\nBeads Issue: ${beadsIssue.id}`
      : `Synced from Beads: ${beadsIssue.id}`;

    const task = await this.createTask(projectId, {
      title: beadsIssue.title,
      description,
      status: vibeStatus,
    });

    return { task, created: true, updated: false, skipped: false };
  }

  // ============================================================
  // BATCH SYNC METHODS (Optimized - O(1) lookups after initial fetch)
  // ============================================================

  /**
   * Build lookup indexes from a list of tasks for O(1) access
   */
  buildTaskIndexes(tasks: VibeTask[]): {
    byBeadsId: Map<string, VibeTask>;
    byTitle: Map<string, VibeTask>;
  } {
    const byBeadsId = new Map<string, VibeTask>();
    const byTitle = new Map<string, VibeTask>();

    for (const task of tasks) {
      if (task.description) {
        const match = task.description.match(/Beads Issue:\s*(\S+)/);
        if (match) {
          byBeadsId.set(match[1], task);
        }
      }
      byTitle.set(task.title.toLowerCase().trim(), task);
    }

    return { byBeadsId, byTitle };
  }

  /**
   * Prefetch all tasks for a project and return with indexes.
   * Call once per project, then use syncFromBeadsWithCache for each issue.
   */
  async prefetchTasksForProject(projectId: string): Promise<{
    tasks: VibeTask[];
    byBeadsId: Map<string, VibeTask>;
    byTitle: Map<string, VibeTask>;
  }> {
    const tasks = await this.listTasks(projectId);
    const indexes = this.buildTaskIndexes(tasks);
    console.log(`[VibeClient] Prefetched ${tasks.length} tasks for project ${projectId}`);
    return { tasks, ...indexes };
  }

  /**
   * Sync a beads issue using pre-fetched task indexes (O(1) lookup).
   * Use this after calling prefetchTasksForProject().
   */
  async syncFromBeadsWithCache(
    projectId: string,
    beadsIssue: {
      id: string;
      title: string;
      description?: string;
      status: string;
    },
    vibeStatus: string,
    cache: {
      byBeadsId: Map<string, VibeTask>;
      byTitle: Map<string, VibeTask>;
    }
  ): Promise<{ task: VibeTask | null; created: boolean; updated: boolean; skipped: boolean }> {
    const existing = cache.byBeadsId.get(beadsIssue.id);
    if (existing) {
      if (existing.status !== vibeStatus) {
        await this.updateTask(existing.id, 'status', vibeStatus);
        const updated = await this.getTask(existing.id);
        cache.byBeadsId.set(beadsIssue.id, updated);
        return { task: updated, created: false, updated: true, skipped: false };
      }
      return { task: existing, created: false, updated: false, skipped: true };
    }

    const normalizedTitle = beadsIssue.title.toLowerCase().trim();
    const existingByTitle = cache.byTitle.get(normalizedTitle);
    if (existingByTitle) {
      return { task: existingByTitle, created: false, updated: false, skipped: true };
    }

    const description = beadsIssue.description
      ? `${beadsIssue.description}\n\n---\nBeads Issue: ${beadsIssue.id}`
      : `Synced from Beads: ${beadsIssue.id}`;

    const task = await this.createTask(projectId, {
      title: beadsIssue.title,
      description,
      status: vibeStatus,
    });

    cache.byBeadsId.set(beadsIssue.id, task);
    cache.byTitle.set(normalizedTitle, task);

    return { task, created: true, updated: false, skipped: false };
  }

  /**
   * Batch sync multiple beads issues efficiently.
   * Fetches all tasks ONCE, then processes each issue with O(1) lookups.
   * Reduces API calls from O(2n) to O(1 + creates + updates).
   */
  async syncFromBeadsBatch(
    projectId: string,
    beadsIssues: Array<{
      id: string;
      title: string;
      description?: string;
      status: string;
      vibeStatus: string;
    }>
  ): Promise<{
    results: Array<{
      beadsId: string;
      task: VibeTask | null;
      created: boolean;
      updated: boolean;
      skipped: boolean;
    }>;
    stats: { total: number; created: number; updated: number; skipped: number };
  }> {
    const cache = await this.prefetchTasksForProject(projectId);

    const results: Array<{
      beadsId: string;
      task: VibeTask | null;
      created: boolean;
      updated: boolean;
      skipped: boolean;
    }> = [];
    const stats = { total: beadsIssues.length, created: 0, updated: 0, skipped: 0 };

    for (const issue of beadsIssues) {
      const result = await this.syncFromBeadsWithCache(
        projectId,
        { id: issue.id, title: issue.title, description: issue.description, status: issue.status },
        issue.vibeStatus,
        cache
      );

      results.push({ beadsId: issue.id, ...result });

      if (result.created) stats.created++;
      else if (result.updated) stats.updated++;
      else if (result.skipped) stats.skipped++;
    }

    console.log(
      `[VibeClient] Batch sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped`
    );
    return { results, stats };
  }
}

export function createVibeClient(url?: string, options?: VibeClientOptions): VibeClient {
  const baseUrl = url || process.env.VIBE_API_URL || 'http://localhost:3105';
  return new VibeClient(baseUrl, options);
}
