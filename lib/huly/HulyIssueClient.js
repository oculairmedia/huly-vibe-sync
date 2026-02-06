/**
 * Huly Issue Client — issue CRUD, search, and bulk operations
 */

import { fetchWithPool } from '../http.js';

export class HulyIssueClient {
  constructor(base) {
    this._base = base;
  }

  get baseUrl() { return this._base.baseUrl; }
  get name() { return this._base.name; }
  get timeout() { return this._base.timeout; }

  async listIssues(projectIdentifier, options = {}) {
    const startTime = Date.now();

    try {
      const params = new URLSearchParams();

      const modifiedSince = options.modifiedSince || options.modifiedAfter;
      if (modifiedSince) {
        params.append('modifiedSince', modifiedSince);
      }
      if (options.createdSince) {
        params.append('createdSince', options.createdSince);
      }
      if (options.limit) {
        params.append('limit', options.limit.toString());
      }

      const queryString = params.toString();
      const url = `${this.baseUrl}/projects/${projectIdentifier}/issues${queryString ? '?' + queryString : ''}`;

      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      const syncInfo = modifiedSince ? ` (incremental since ${modifiedSince})` : '';
      console.log(`[${this.name}] Fetched ${result.count} issues from ${projectIdentifier}${syncInfo} in ${executionTime}ms`);

      if (options.includeSyncMeta) {
        return {
          issues: result.issues,
          syncMeta: result.syncMeta || {
            latestModified: null,
            serverTime: new Date().toISOString(),
          },
          count: result.count,
        };
      }

      return result.issues;

    } catch (error) {
      console.error(`[${this.name}] List issues failed for ${projectIdentifier}:`, error.message);
      throw error;
    }
  }

  async listIssuesBulk(projectIdentifiers, options = {}) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/bulk-by-projects`;
      const body = {
        projects: projectIdentifiers,
      };

      if (options.modifiedSince) {
        body.modifiedSince = options.modifiedSince;
      }
      if (options.limit) {
        body.limit = options.limit;
      }

      const response = await fetchWithPool(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      const syncInfo = options.modifiedSince ? ` (incremental since ${options.modifiedSince})` : '';
      console.log(`[${this.name}] Bulk fetched ${result.totalIssues} issues from ${result.projectCount} projects${syncInfo} in ${executionTime}ms`);

      return result;

    } catch (error) {
      console.error(`[${this.name}] Bulk list issues failed:`, error.message);
      throw error;
    }
  }

  async getIssue(issueIdentifier) {
    const url = `${this.baseUrl}/issues/${issueIdentifier}`;

    try {
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error(`[${this.name}] getIssue failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  async createIssue(projectIdentifier, issueData) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues`;

      const response = await fetchWithPool(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_identifier: projectIdentifier,
          ...issueData,
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Created issue in ${projectIdentifier} in ${executionTime}ms`);

      return result;

    } catch (error) {
      console.error(`[${this.name}] Create issue failed for ${projectIdentifier}:`, error.message);
      throw error;
    }
  }

  async updateIssue(issueIdentifier, field, value) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}`;

      const response = await fetchWithPool(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      if (executionTime > 1000) {
        console.log(`[${this.name}] Updated issue ${issueIdentifier} ${field} in ${executionTime}ms`);
      }

      return result;

    } catch (error) {
      console.error(`[${this.name}] Update issue failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  async patchIssue(issueIdentifier, updates) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}`;

      const response = await fetchWithPool(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Patched issue ${issueIdentifier} in ${executionTime}ms`);

      return result;

    } catch (error) {
      console.error(`[${this.name}] Patch issue failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  async deleteIssue(issueIdentifier, options = {}) {
    const startTime = Date.now();

    try {
      let url = `${this.baseUrl}/issues/${issueIdentifier}`;
      if (options.cascade) {
        url += '?cascade=true';
      }

      const response = await fetchWithPool(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      console.log(`[${this.name}] Deleted issue ${issueIdentifier} in ${executionTime}ms`);
      return true;

    } catch (error) {
      console.error(`[${this.name}] Delete issue failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  async deleteIssuesBulk(identifiers, options = {}) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/bulk`;

      const response = await fetchWithPool(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifiers,
          cascade: options.cascade || false,
          fast: options.fast || false,
          concurrency: options.concurrency || 10,
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Bulk deleted ${result.succeeded}/${identifiers.length} issues in ${executionTime}ms`);

      return result;

    } catch (error) {
      console.error(`[${this.name}] Bulk delete failed:`, error.message);
      throw error;
    }
  }

  async getIssuesBulk(identifiers) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/bulk?ids=${identifiers.join(',')}`;

      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Bulk fetch returned ${result.issues?.length || 0} issues in ${executionTime}ms`);

      return result.issues || [];

    } catch (error) {
      console.error(`[${this.name}] Bulk fetch failed:`, error.message);
      throw error;
    }
  }

  async searchIssues(filters = {}, limit = 100) {
    const queryParams = new URLSearchParams();
    queryParams.set('limit', limit.toString());

    if (filters.query) queryParams.set('query', filters.query);
    if (filters.status) queryParams.set('status', filters.status);
    if (filters.priority) queryParams.set('priority', filters.priority);
    if (filters.assignee) queryParams.set('assignee', filters.assignee);

    const url = `${this.baseUrl}/issues?${queryParams.toString()}`;

    try {
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      return result.issues || [];
    } catch (error) {
      console.error(`[${this.name}] searchIssues failed:`, error.message);
      throw error;
    }
  }

  async searchIssuesGlobal(filters = {}) {
    const startTime = Date.now();

    try {
      const params = new URLSearchParams();
      if (filters.query) params.append('query', filters.query);
      if (filters.status) params.append('status', filters.status);
      if (filters.priority) params.append('priority', filters.priority);
      if (filters.assignee) params.append('assignee', filters.assignee);

      const queryString = params.toString();
      const url = `${this.baseUrl}/issues${queryString ? '?' + queryString : ''}`;

      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Global search returned ${result.count || 0} issues in ${executionTime}ms`);

      return result.issues || [];

    } catch (error) {
      console.error(`[${this.name}] Global search failed:`, error.message);
      throw error;
    }
  }

  async moveIssue(issueIdentifier, parentIdentifier) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}/parent`;

      const response = await fetchWithPool(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentIdentifier }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      const action = parentIdentifier ? `under ${parentIdentifier}` : 'to top-level';
      console.log(`[${this.name}] Moved issue ${issueIdentifier} ${action} in ${executionTime}ms`);

      return result;

    } catch (error) {
      console.error(`[${this.name}] Move issue failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  async updateIssueDueDate(issueIdentifier, dueDate) {
    const dueDateValue = dueDate instanceof Date ? dueDate.toISOString() : dueDate;
    return this.patchIssue(issueIdentifier, { dueDate: dueDateValue });
  }
}
