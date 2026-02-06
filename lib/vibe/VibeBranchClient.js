/**
 * Vibe Branch Client - Branch and commit operations
 */

export class VibeBranchClient {
  constructor(base) {
    this._base = base;
  }

  async getBranchStatus(attemptId) {
    return await this._base.makeRequest(`/attempts/${attemptId}/branch-status`, { method: 'GET' });
  }

  async getAttemptCommits(attemptId) {
    return await this._base.makeRequest(`/attempts/${attemptId}/commits`, { method: 'GET' });
  }

  async compareCommitToHead(attemptId, commitSha) {
    return await this._base.makeRequest(`/attempts/${attemptId}/compare/${commitSha}`, {
      method: 'GET',
    });
  }

  async abortConflicts(attemptId) {
    return await this._base.makeRequest(`/attempts/${attemptId}/abort-conflicts`, {
      method: 'POST',
    });
  }
}
