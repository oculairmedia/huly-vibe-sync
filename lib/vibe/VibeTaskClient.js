/**
 * Vibe Task Client - Task CRUD and bulk operations
 */

export class VibeTaskClient {
  constructor(base) {
    this._base = base;
  }

  async listTasks(projectId, options = {}) {
    const params = new URLSearchParams({ project_id: projectId });
    if (options.status) {
      params.append('status', options.status);
    }
    if (options.limit) {
      params.append('limit', options.limit.toString());
    }
    return await this._base.makeRequest(`/tasks?${params}`, { method: 'GET' });
  }

  async getTask(taskId) {
    return await this._base.makeRequest(`/tasks/${taskId}`, { method: 'GET' });
  }

  async createTask(projectId, taskData) {
    return await this._base.makeRequest('/tasks', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, ...taskData }),
    });
  }

  async updateTask(taskId, field, value) {
    return await this._base.makeRequest(`/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ [field]: value }),
    });
  }

  async deleteTask(taskId) {
    return await this._base.makeRequest(`/tasks/${taskId}`, { method: 'DELETE' });
  }

  async bulkUpdateTasks(updates) {
    return await this._base.makeRequest('/tasks/bulk', {
      method: 'PUT',
      body: JSON.stringify({ updates }),
    });
  }
}
