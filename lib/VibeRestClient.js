/**
 * Vibe Kanban REST API Client — Facade
 *
 * Delegates to domain-specific sub-clients while preserving the original API surface.
 */

import { VibeBaseClient } from './vibe/VibeBaseClient.js';
import { VibeProjectClient } from './vibe/VibeProjectClient.js';
import { VibeTaskClient } from './vibe/VibeTaskClient.js';
import { VibeAttemptClient } from './vibe/VibeAttemptClient.js';
import { VibeProcessClient } from './vibe/VibeProcessClient.js';
import { VibeBranchClient } from './vibe/VibeBranchClient.js';
import { VibeDevServerClient } from './vibe/VibeDevServerClient.js';

export class VibeRestClient {
  constructor(baseUrl, options = {}) {
    this._base = new VibeBaseClient(baseUrl, options);
    this._projects = new VibeProjectClient(this._base);
    this._tasks = new VibeTaskClient(this._base);
    this._attempts = new VibeAttemptClient(this._base);
    this._processes = new VibeProcessClient(this._base);
    this._branches = new VibeBranchClient(this._base);
    this._devServer = new VibeDevServerClient(this._base);
  }

  // Expose base properties
  get baseUrl() { return this._base.baseUrl; }
  get name() { return this._base.name; }
  get timeout() { return this._base.timeout; }

  // Base client methods
  initialize(...args) { return this._base.initialize(...args); }
  healthCheck(...args) { return this._base.healthCheck(...args); }
  makeRequest(...args) { return this._base.makeRequest(...args); }
  getStats(...args) { return this._base.getStats(...args); }

  // Project operations
  listProjects(...args) { return this._projects.listProjects(...args); }
  getProject(...args) { return this._projects.getProject(...args); }
  createProject(...args) { return this._projects.createProject(...args); }
  updateProject(...args) { return this._projects.updateProject(...args); }
  deleteProject(...args) { return this._projects.deleteProject(...args); }

  // Task operations
  listTasks(...args) { return this._tasks.listTasks(...args); }
  getTask(...args) { return this._tasks.getTask(...args); }
  createTask(...args) { return this._tasks.createTask(...args); }
  updateTask(...args) { return this._tasks.updateTask(...args); }
  deleteTask(...args) { return this._tasks.deleteTask(...args); }
  bulkUpdateTasks(...args) { return this._tasks.bulkUpdateTasks(...args); }

  // Attempt operations
  startTaskAttempt(...args) { return this._attempts.startTaskAttempt(...args); }
  listTaskAttempts(...args) { return this._attempts.listTaskAttempts(...args); }
  getTaskAttempt(...args) { return this._attempts.getTaskAttempt(...args); }
  mergeTaskAttempt(...args) { return this._attempts.mergeTaskAttempt(...args); }
  createFollowupAttempt(...args) { return this._attempts.createFollowupAttempt(...args); }

  // Process operations
  getExecutionProcess(...args) { return this._processes.getExecutionProcess(...args); }
  stopExecutionProcess(...args) { return this._processes.stopExecutionProcess(...args); }
  getProcessLogs(...args) { return this._processes.getProcessLogs(...args); }
  listExecutionProcesses(...args) { return this._processes.listExecutionProcesses(...args); }

  // Branch operations
  getBranchStatus(...args) { return this._branches.getBranchStatus(...args); }
  getAttemptCommits(...args) { return this._branches.getAttemptCommits(...args); }
  compareCommitToHead(...args) { return this._branches.compareCommitToHead(...args); }
  abortConflicts(...args) { return this._branches.abortConflicts(...args); }

  // Dev server operations
  startDevServer(...args) { return this._devServer.startDevServer(...args); }
  stopDevServer(...args) { return this._devServer.stopDevServer(...args); }
}

export function createVibeRestClient(url, options = {}) {
  return new VibeRestClient(url, options);
}
