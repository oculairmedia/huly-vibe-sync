"use strict";
/**
 * Vibe Kanban REST API Client (TypeScript)
 *
 * Pure TypeScript client for Vibe Kanban platform.
 * Used by Temporal activities for durable workflow execution.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VibeClient = void 0;
exports.createVibeClient = createVibeClient;
/**
 * TypeScript REST client for Vibe Kanban
 */
class VibeClient {
    baseUrl;
    timeout;
    name;
    constructor(baseUrl, options = {}) {
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
    async request(endpoint, options = {}) {
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
            const result = (await response.json());
            // Vibe API returns { success, data, message } format
            if (result.success === false) {
                throw new Error(`Vibe API failed: ${result.message || 'Unknown error'}`);
            }
            return (result.data || result);
        }
        catch (error) {
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
    async healthCheck() {
        try {
            const healthUrl = this.baseUrl.replace('/api', '/health');
            const response = await fetch(healthUrl, {
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    // ============================================================
    // PROJECT OPERATIONS
    // ============================================================
    async listProjects() {
        return this.request('/projects', { method: 'GET' });
    }
    async getProject(projectId) {
        return this.request(`/projects/${projectId}`, { method: 'GET' });
    }
    async createProject(data) {
        return this.request('/projects', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    // ============================================================
    // TASK OPERATIONS
    // ============================================================
    async listTasks(projectId, options = {}) {
        const params = new URLSearchParams({ project_id: projectId });
        if (options.status)
            params.append('status', options.status);
        if (options.limit)
            params.append('limit', options.limit.toString());
        return this.request(`/tasks?${params}`, { method: 'GET' });
    }
    async getTask(taskId) {
        return this.request(`/tasks/${taskId}`, { method: 'GET' });
    }
    async createTask(projectId, data) {
        return this.request('/tasks', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                ...data,
            }),
        });
    }
    async updateTask(taskId, field, value) {
        return this.request(`/tasks/${taskId}`, {
            method: 'PUT',
            body: JSON.stringify({ [field]: value }),
        });
    }
    async deleteTask(taskId) {
        await this.request(`/tasks/${taskId}`, { method: 'DELETE' });
    }
    // ============================================================
    // HELPER METHODS
    // ============================================================
    /**
     * Find a task by Huly identifier in description
     */
    async findTaskByHulyId(projectId, hulyIdentifier) {
        try {
            const tasks = await this.listTasks(projectId);
            // Look for Huly identifier in description
            const match = tasks.find(task => {
                if (!task.description)
                    return false;
                const idMatch = task.description.match(/(?:Huly Issue|Synced from Huly):\s*([A-Z]+-\d+)/i);
                return idMatch && idMatch[1] === hulyIdentifier;
            });
            return match || null;
        }
        catch {
            return null;
        }
    }
    /**
     * Create or update a task from a Huly issue
     */
    async syncFromHuly(projectId, issue, vibeStatus, existingTaskId) {
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
    async findTaskByBeadsId(projectId, beadsId) {
        try {
            const tasks = await this.listTasks(projectId);
            const match = tasks.find(task => {
                if (!task.description)
                    return false;
                return task.description.includes(`Beads Issue: ${beadsId}`);
            });
            return match || null;
        }
        catch {
            return null;
        }
    }
    async findTaskByTitle(projectId, title) {
        try {
            const tasks = await this.listTasks(projectId);
            const normalizedTitle = title.toLowerCase().trim();
            return tasks.find(t => t.title.toLowerCase().trim() === normalizedTitle) || null;
        }
        catch {
            return null;
        }
    }
    async syncFromBeads(projectId, beadsIssue, vibeStatus) {
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
}
exports.VibeClient = VibeClient;
function createVibeClient(url, options) {
    const baseUrl = url || process.env.VIBE_API_URL || 'http://localhost:3105';
    return new VibeClient(baseUrl, options);
}
//# sourceMappingURL=VibeClient.js.map