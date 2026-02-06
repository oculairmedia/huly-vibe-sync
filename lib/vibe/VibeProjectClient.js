/**
 * Vibe Project Client - Project CRUD operations
 */

export class VibeProjectClient {
  constructor(base) {
    this._base = base;
  }

  async listProjects() {
    return await this._base.makeRequest('/projects', { method: 'GET' });
  }

  async getProject(projectId) {
    return await this._base.makeRequest(`/projects/${projectId}`, { method: 'GET' });
  }

  async createProject(projectData) {
    return await this._base.makeRequest('/projects', {
      method: 'POST',
      body: JSON.stringify(projectData),
    });
  }

  async updateProject(projectId, updates) {
    return await this._base.makeRequest(`/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteProject(projectId) {
    return await this._base.makeRequest(`/projects/${projectId}`, { method: 'DELETE' });
  }
}
