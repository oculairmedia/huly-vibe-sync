/**
 * Huly Hierarchy Client — sub-issues and issue tree operations
 */

import { fetchWithPool } from '../http.js';

export class HulyHierarchyClient {
  constructor(base) {
    this._base = base;
  }

  get baseUrl() { return this._base.baseUrl; }
  get name() { return this._base.name; }
  get timeout() { return this._base.timeout; }

  async getSubIssues(issueIdentifier) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}/subissues`;

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
      console.log(`[${this.name}] Fetched ${result.count} sub-issues for ${issueIdentifier} in ${executionTime}ms`);

      return result;

    } catch (error) {
      console.error(`[${this.name}] Get sub-issues failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  async createSubIssue(parentIdentifier, issueData) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${parentIdentifier}/subissues`;

      const response = await fetchWithPool(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(issueData),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Created sub-issue under ${parentIdentifier} in ${executionTime}ms`);

      return result;

    } catch (error) {
      console.error(`[${this.name}] Create sub-issue failed for ${parentIdentifier}:`, error.message);
      throw error;
    }
  }

  async getIssueTree(projectIdentifier) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/projects/${projectIdentifier}/tree`;

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
      console.log(`[${this.name}] Fetched issue tree for ${projectIdentifier} in ${executionTime}ms`);

      return result;

    } catch (error) {
      console.error(`[${this.name}] Get issue tree failed for ${projectIdentifier}:`, error.message);
      throw error;
    }
  }
}
