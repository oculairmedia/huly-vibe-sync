"use strict";
/**
 * Huly REST API Client (TypeScript)
 *
 * Pure TypeScript client for Huly platform.
 * Used by Temporal activities for durable workflow execution.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HulyClient = void 0;
exports.createHulyClient = createHulyClient;
/**
 * TypeScript REST client for Huly
 */
class HulyClient {
    baseUrl;
    timeout;
    name;
    constructor(baseUrl, options = {}) {
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
                throw new Error(`Huly API error (${response.status}): ${errorText}`);
            }
            return (await response.json());
        }
        catch (error) {
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
    async healthCheck() {
        const healthUrl = this.baseUrl.replace('/api', '/health');
        const response = await fetch(healthUrl, {
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
            throw new Error(`Huly health check failed: ${response.status}`);
        }
        return (await response.json());
    }
    // ============================================================
    // PROJECT OPERATIONS
    // ============================================================
    async listProjects() {
        const result = await this.request('/projects', { method: 'GET' });
        return result.projects;
    }
    // ============================================================
    // ISSUE OPERATIONS
    // ============================================================
    async listIssues(projectIdentifier, options = {}) {
        const params = new URLSearchParams();
        if (options.modifiedSince)
            params.append('modifiedSince', options.modifiedSince);
        if (options.limit)
            params.append('limit', options.limit.toString());
        const queryString = params.toString();
        const url = `/projects/${projectIdentifier}/issues${queryString ? '?' + queryString : ''}`;
        const result = await this.request(url, {
            method: 'GET',
        });
        return result.issues;
    }
    async getIssue(issueIdentifier) {
        try {
            return await this.request(`/issues/${issueIdentifier}`, { method: 'GET' });
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('404')) {
                return null;
            }
            throw error;
        }
    }
    async createIssue(projectIdentifier, data) {
        return this.request('/issues', {
            method: 'POST',
            body: JSON.stringify({
                project_identifier: projectIdentifier,
                ...data,
            }),
        });
    }
    async updateIssue(issueIdentifier, field, value) {
        return this.request(`/issues/${issueIdentifier}`, {
            method: 'PUT',
            body: JSON.stringify({ field, value }),
        });
    }
    async patchIssue(issueIdentifier, updates) {
        return this.request(`/issues/${issueIdentifier}`, {
            method: 'PATCH',
            body: JSON.stringify(updates),
        });
    }
    async deleteIssue(issueIdentifier, cascade = false) {
        const url = cascade ? `/issues/${issueIdentifier}?cascade=true` : `/issues/${issueIdentifier}`;
        await this.request(url, { method: 'DELETE' });
        return true;
    }
    /**
     * Find an existing issue by title (for deduplication)
     * Returns the first matching issue or null
     */
    async findIssueByTitle(projectIdentifier, title) {
        try {
            const issues = await this.listIssues(projectIdentifier, { limit: 500 });
            const normalizedTitle = title.toLowerCase().trim();
            return issues.find(issue => issue.title.toLowerCase().trim() === normalizedTitle) || null;
        }
        catch (error) {
            console.warn(`[HulyClient] findIssueByTitle failed: ${error}`);
            return null;
        }
    }
    // ============================================================
    // SUB-ISSUE OPERATIONS
    // ============================================================
    async getSubIssues(issueIdentifier) {
        return this.request(`/issues/${issueIdentifier}/subissues`, { method: 'GET' });
    }
    async createSubIssue(parentIdentifier, data) {
        return this.request(`/issues/${parentIdentifier}/subissues`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    // ============================================================
    // COMMENT OPERATIONS
    // ============================================================
    async getComments(issueIdentifier) {
        const result = await this.request(`/issues/${issueIdentifier}/comments`, { method: 'GET' });
        return result.comments;
    }
    async createComment(issueIdentifier, text) {
        return this.request(`/issues/${issueIdentifier}/comments`, {
            method: 'POST',
            body: JSON.stringify({ text }),
        });
    }
    // ============================================================
    // BULK OPERATIONS (High-performance endpoints)
    // ============================================================
    async listIssuesBulk(options) {
        return this.request('/issues/bulk-by-projects', {
            method: 'POST',
            body: JSON.stringify(options),
        });
    }
    async getIssuesByIds(identifiers) {
        const params = new URLSearchParams();
        params.append('ids', identifiers.join(','));
        return this.request(`/issues/bulk?${params.toString()}`, { method: 'GET' });
    }
    async bulkUpdateIssues(options) {
        return this.request('/issues/bulk', {
            method: 'PATCH',
            body: JSON.stringify(options),
        });
    }
    async bulkDeleteIssues(options) {
        return this.request('/issues/bulk', {
            method: 'DELETE',
            body: JSON.stringify(options),
        });
    }
    // ============================================================
    // PROJECT METADATA
    // ============================================================
    async getProjectTree(projectIdentifier) {
        return this.request(`/projects/${projectIdentifier}/tree`, { method: 'GET' });
    }
    async getProjectComponents(projectIdentifier) {
        return this.request(`/projects/${projectIdentifier}/components`, { method: 'GET' });
    }
    async updateProject(projectIdentifier, updates) {
        return this.request(`/projects/${projectIdentifier}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        });
    }
    // ============================================================
    // ISSUE QUERIES
    // ============================================================
    async listAllIssues(options = {}) {
        const params = new URLSearchParams();
        if (options.status)
            params.append('status', options.status);
        if (options.limit)
            params.append('limit', options.limit.toString());
        if (options.modifiedSince)
            params.append('modifiedSince', options.modifiedSince);
        if (options.includeDescriptions !== undefined) {
            params.append('includeDescriptions', String(options.includeDescriptions));
        }
        if (options.fields)
            params.append('fields', options.fields.join(','));
        const queryString = params.toString();
        return this.request(`/issues/all${queryString ? '?' + queryString : ''}`, { method: 'GET' });
    }
    async listIssuesByStatus(status, limit = 100) {
        const params = new URLSearchParams();
        params.append('status', status);
        params.append('limit', limit.toString());
        const result = await this.request(`/issues?${params.toString()}`, { method: 'GET' });
        return result.issues;
    }
    // ============================================================
    // PARENT/CHILD OPERATIONS
    // ============================================================
    async setParentIssue(issueIdentifier, parentIdentifier) {
        return this.request(`/issues/${issueIdentifier}/parent`, {
            method: 'PATCH',
            body: JSON.stringify({ parentIdentifier }),
        });
    }
    // ============================================================
    // SYNC HELPERS
    // ============================================================
    async syncStatusFromVibe(issueIdentifier, hulyStatus) {
        try {
            const issue = await this.updateIssue(issueIdentifier, 'status', hulyStatus);
            return { success: true, issue };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
exports.HulyClient = HulyClient;
/**
 * Factory function to create Huly client
 */
function createHulyClient(url, options) {
    const baseUrl = url || process.env.HULY_API_URL || 'http://localhost:3458';
    return new HulyClient(baseUrl, options);
}
//# sourceMappingURL=HulyClient.js.map