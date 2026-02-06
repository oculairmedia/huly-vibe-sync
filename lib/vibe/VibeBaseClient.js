/**
 * Vibe Base Client - Shared HTTP helper for Vibe REST API
 *
 * Provides makeRequest, URL normalization, and stats for all Vibe sub-clients.
 */

import { fetchWithPool } from '../http.js';

export class VibeBaseClient {
  constructor(baseUrl, options = {}) {
    this.baseUrl =
      baseUrl
        .replace(/\/mcp$/, '')
        .replace(/\/api$/, '')
        .replace(/:\d+/, ':3105') +
      '/api';
    this.name = options.name || 'Vibe REST';
    this.timeout = options.timeout || 60000;
  }

  async initialize() {
    console.log(`[${this.name}] Initializing REST API client...`);
    console.log(`[${this.name}] API URL: ${this.baseUrl}`);

    try {
      const healthUrl = this.baseUrl.replace('/api', '/health');
      console.log(`[${this.name}] Testing health endpoint: ${healthUrl}`);

      const response = await fetchWithPool(healthUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      console.log(`[${this.name}] Response status: ${response?.status}`);

      if (!response.ok) {
        console.log(`[${this.name}] Health endpoint not available, testing with list projects...`);
        await this.makeRequest('/projects', { method: 'GET' });
        console.log(`[${this.name}] Connected successfully via projects endpoint`);
        return true;
      }

      try {
        const result = await response.json();
        console.log(`[${this.name}] Health check result:`, JSON.stringify(result));
        console.log(`[${this.name}] Connected successfully`);
        return true;
      } catch (jsonError) {
        console.log(
          `[${this.name}] Health endpoint returned non-JSON response, testing with list projects...`,
        );
        await this.makeRequest('/projects', { method: 'GET' });
        console.log(`[${this.name}] Connected successfully via projects endpoint`);
        return true;
      }
    } catch (error) {
      console.error(`[${this.name}] Failed to connect:`, error.message);
      throw error;
    }
  }

  async healthCheck() {
    try {
      const healthUrl = this.baseUrl.replace('/api', '/health');
      const response = await fetchWithPool(healthUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      return { status: 'unknown', message: error.message };
    }
  }

  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const startTime = Date.now();

    try {
      const response = await fetchWithPool(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      if (result.success === false) {
        throw new Error(`API call failed: ${result.message || 'Unknown error'}`);
      }

      if (executionTime > 5000) {
        console.log(`[${this.name}] Slow API call: ${endpoint} took ${executionTime}ms`);
      }

      return result.data || result;
    } catch (error) {
      console.error(`[${this.name}] API call failed:`, {
        endpoint,
        method: options.method || 'GET',
        error: error.message,
      });
      throw error;
    }
  }

  getStats() {
    return {
      type: 'rest',
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      name: this.name,
    };
  }
}
