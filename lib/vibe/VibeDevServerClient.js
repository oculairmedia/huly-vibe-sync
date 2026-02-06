/**
 * Vibe Dev Server Client - Development server operations
 */

export class VibeDevServerClient {
  constructor(base) {
    this._base = base;
  }

  async startDevServer(attemptId) {
    return await this._base.makeRequest(`/attempts/${attemptId}/dev-server/start`, {
      method: 'POST',
    });
  }

  async stopDevServer(attemptId) {
    return await this._base.makeRequest(`/attempts/${attemptId}/dev-server/stop`, {
      method: 'POST',
    });
  }
}
