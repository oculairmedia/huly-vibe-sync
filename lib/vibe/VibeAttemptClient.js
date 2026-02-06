/**
 * Vibe Attempt Client - Task attempt operations
 */

export class VibeAttemptClient {
  constructor(base) {
    this._base = base;
  }

  async startTaskAttempt(taskId, executor, baseBranch, options = {}) {
    return await this._base.makeRequest('/attempts/start', {
      method: 'POST',
      body: JSON.stringify({
        task_id: taskId,
        executor,
        base_branch: baseBranch,
        ...options,
      }),
    });
  }

  async listTaskAttempts(taskId) {
    return await this._base.makeRequest(`/attempts?task_id=${taskId}`, { method: 'GET' });
  }

  async getTaskAttempt(attemptId) {
    return await this._base.makeRequest(`/attempts/${attemptId}`, { method: 'GET' });
  }

  async mergeTaskAttempt(attemptId) {
    return await this._base.makeRequest(`/attempts/${attemptId}/merge`, { method: 'POST' });
  }

  async createFollowupAttempt(previousAttemptId, options = {}) {
    return await this._base.makeRequest('/attempts/followup', {
      method: 'POST',
      body: JSON.stringify({
        previous_attempt_id: previousAttemptId,
        ...options,
      }),
    });
  }
}
