/**
 * Huly REST API Client — Facade
 *
 * Delegates to domain-specific sub-clients while preserving the original API surface.
 */

import { HulyBaseClient } from './huly/HulyBaseClient.js';
import { HulyProjectClient } from './huly/HulyProjectClient.js';
import { HulyIssueClient } from './huly/HulyIssueClient.js';
import { HulyHierarchyClient } from './huly/HulyHierarchyClient.js';
import { HulyCommentsClient } from './huly/HulyCommentsClient.js';

export class HulyRestClient {
  constructor(baseUrl, options = {}) {
    this._base = new HulyBaseClient(baseUrl, options);
    this._projects = new HulyProjectClient(this._base);
    this._issues = new HulyIssueClient(this._base);
    this._hierarchy = new HulyHierarchyClient(this._base);
    this._comments = new HulyCommentsClient(this._base);
  }

  // Expose base properties for backward compatibility
  get baseUrl() { return this._base.baseUrl; }
  get name() { return this._base.name; }
  get timeout() { return this._base.timeout; }

  // Base client methods
  initialize(...args) { return this._base.initialize(...args); }
  healthCheck(...args) { return this._base.healthCheck(...args); }
  callTool(...args) { return this._base.callTool(...args); }
  getStats(...args) { return this._base.getStats(...args); }

  // Project methods
  listProjects(...args) { return this._projects.listProjects(...args); }
  listComponents(...args) { return this._projects.listComponents(...args); }
  getProjectActivity(...args) { return this._projects.getProjectActivity(...args); }

  // Issue methods
  listIssues(...args) { return this._issues.listIssues(...args); }
  listIssuesBulk(...args) { return this._issues.listIssuesBulk(...args); }
  getIssue(...args) { return this._issues.getIssue(...args); }
  createIssue(...args) { return this._issues.createIssue(...args); }
  updateIssue(...args) { return this._issues.updateIssue(...args); }
  patchIssue(...args) { return this._issues.patchIssue(...args); }
  deleteIssue(...args) { return this._issues.deleteIssue(...args); }
  deleteIssuesBulk(...args) { return this._issues.deleteIssuesBulk(...args); }
  getIssuesBulk(...args) { return this._issues.getIssuesBulk(...args); }
  searchIssues(...args) { return this._issues.searchIssues(...args); }
  searchIssuesGlobal(...args) { return this._issues.searchIssuesGlobal(...args); }
  moveIssue(...args) { return this._issues.moveIssue(...args); }
  updateIssueDueDate(...args) { return this._issues.updateIssueDueDate(...args); }

  // Hierarchy methods
  getSubIssues(...args) { return this._hierarchy.getSubIssues(...args); }
  createSubIssue(...args) { return this._hierarchy.createSubIssue(...args); }
  getIssueTree(...args) { return this._hierarchy.getIssueTree(...args); }

  // Comment methods
  getComments(...args) { return this._comments.getComments(...args); }
  createComment(...args) { return this._comments.createComment(...args); }
}

export function createHulyRestClient(url, options = {}) {
  return new HulyRestClient(url, options);
}
