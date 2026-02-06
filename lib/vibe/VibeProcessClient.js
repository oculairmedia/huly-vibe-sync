/**
 * Vibe Process Client - Execution process operations
 */

export class VibeProcessClient {
  constructor(base) {
    this._base = base;
  }

  async getExecutionProcess(processId) {
    return await this._base.makeRequest(`/processes/${processId}`, { method: 'GET' });
  }

  async stopExecutionProcess(processId) {
    return await this._base.makeRequest(`/processes/${processId}/stop`, { method: 'POST' });
  }

  async getProcessLogs(processId, normalized = false) {
    const endpoint = normalized
      ? `/processes/${processId}/logs/normalized`
      : `/processes/${processId}/logs/raw`;
    return await this._base.makeRequest(endpoint, { method: 'GET' });
  }

  async listExecutionProcesses(taskAttemptId, showSoftDeleted = false) {
    const params = new URLSearchParams({ task_attempt_id: taskAttemptId });
    if (showSoftDeleted) {
      params.append('show_soft_deleted', 'true');
    }
    return await this._base.makeRequest(`/processes?${params}`, { method: 'GET' });
  }
}
