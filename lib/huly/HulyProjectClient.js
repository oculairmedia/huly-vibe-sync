/**
 * Huly Project Client — project-related API methods
 */

import { fetchWithPool } from '../http.js';

export class HulyProjectClient {
  constructor(base) {
    this._base = base;
  }

  get baseUrl() { return this._base.baseUrl; }
  get name() { return this._base.name; }
  get timeout() { return this._base.timeout; }

  async listProjects() {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/projects`;
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

      if (executionTime > 5000) {
        console.log(`[${this.name}] Slow API call: list projects took ${executionTime}ms`);
      }

      return result.projects;

    } catch (error) {
      console.error(`[${this.name}] List projects failed:`, error.message);
      throw error;
    }
  }

  async listComponents(projectIdentifier) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/projects/${projectIdentifier}/components`;

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
      console.log(`[${this.name}] Fetched ${result.count || 0} components for ${projectIdentifier} in ${executionTime}ms`);

      return result.components || [];

    } catch (error) {
      console.error(`[${this.name}] List components failed for ${projectIdentifier}:`, error.message);
      throw error;
    }
  }

  async getProjectActivity(projectIdentifier, options = {}) {
    const startTime = Date.now();

    try {
      const params = new URLSearchParams();
      if (options.since) {
        params.append('since', options.since);
      }
      if (options.limit) {
        params.append('limit', options.limit.toString());
      }

      const queryString = params.toString();
      const url = `${this.baseUrl}/projects/${projectIdentifier}/activity${queryString ? '?' + queryString : ''}`;

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
      console.log(`[${this.name}] Fetched ${result.count} activities for ${projectIdentifier} in ${executionTime}ms`);

      return result;

    } catch (error) {
      console.error(`[${this.name}] Get project activity failed for ${projectIdentifier}:`, error.message);
      throw error;
    }
  }
}
