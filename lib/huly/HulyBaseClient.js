/**
 * Huly Base Client — shared HTTP helpers for all Huly sub-clients
 */

import { fetchWithPool } from '../http.js';

export class HulyBaseClient {
  constructor(baseUrl, options = {}) {
    // Ensure we have the correct REST API URL
    // The REST API runs on port 3458
    this.baseUrl = baseUrl
      .replace(/\/mcp$/, '')   // Remove /mcp suffix if present
      .replace(/\/api$/, '')   // Remove /api suffix if present
      .replace(/:\d+/, ':3458') // Set port to 3458
      + '/api';                 // Add /api suffix
    this.name = options.name || 'Huly REST';
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
        throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Health check result:`, JSON.stringify(result));

      if (result && result.status) {
        console.log(`[${this.name}] Connected successfully - Status: ${result.status}, Connected: ${result.connected}`);
        return true;
      } else {
        throw new Error('Invalid health check response format');
      }
    } catch (error) {
      console.error(`[${this.name}] Failed to connect:`, error.message);
      console.error(`[${this.name}] Error stack:`, error.stack);
      throw error;
    }
  }

  async healthCheck() {
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
  }

  async callTool(toolName, args = {}) {
    const url = `${this.baseUrl}/tools/${toolName}`;
    const startTime = Date.now();

    try {
      const response = await fetchWithPool(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: args }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(`Tool execution failed: ${JSON.stringify(result)}`);
      }

      if (executionTime > 5000) {
        console.log(`[${this.name}] Slow tool execution: ${toolName} took ${executionTime}ms`);
      }

      const toolResult = result.data.result;
      if (toolResult && toolResult.content && Array.isArray(toolResult.content)) {
        const textContent = toolResult.content.find(c => c.type === 'text');
        if (textContent) {
          return textContent.text;
        }
      }

      return toolResult;

    } catch (error) {
      console.error(`[${this.name}] Tool call failed:`, {
        tool: toolName,
        args,
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
    };
  }
}
