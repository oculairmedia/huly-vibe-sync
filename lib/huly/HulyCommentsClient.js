/**
 * Huly Comments Client — comment read/create operations
 */

import { fetchWithPool } from '../http.js';

export class HulyCommentsClient {
  constructor(base) {
    this._base = base;
  }

  get baseUrl() { return this._base.baseUrl; }
  get name() { return this._base.name; }
  get timeout() { return this._base.timeout; }

  async getComments(issueIdentifier) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}/comments`;

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
      console.log(`[${this.name}] Fetched comments for ${issueIdentifier} in ${executionTime}ms`);

      return result.comments || [];

    } catch (error) {
      console.error(`[${this.name}] Get comments failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  async createComment(issueIdentifier, text) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}/comments`;

      const response = await fetchWithPool(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Created comment on ${issueIdentifier} in ${executionTime}ms`);

      return result;

    } catch (error) {
      console.error(`[${this.name}] Create comment failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }
}
