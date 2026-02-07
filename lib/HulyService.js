/**
 * Huly Service — Facade
 *
 * Re-exports from domain-specific Huly service modules.
 */

import {
  fetchHulyProjects,
  fetchHulyIssues,
  fetchHulyIssuesSimple,
  fetchHulyIssuesBulk,
} from './huly/HulyFetchService.js';

import {
  updateHulyIssueStatus,
  updateHulyIssueDescription,
  updateHulyIssuePriority,
  updateHulyIssueTitle,
  updateHulyIssueParent,
  createHulyIssue,
} from './huly/HulyUpdateService.js';

import { syncVibeTaskToHuly } from './huly/HulyVibeSync.js';

export {
  fetchHulyProjects,
  fetchHulyIssues,
  fetchHulyIssuesSimple,
  fetchHulyIssuesBulk,
  updateHulyIssueStatus,
  updateHulyIssueDescription,
  updateHulyIssuePriority,
  updateHulyIssueTitle,
  updateHulyIssueParent,
  createHulyIssue,
  syncVibeTaskToHuly,
};

export function createHulyService(config) {
  return {
    fetchProjects: (hulyClient) => fetchHulyProjects(hulyClient, config),
    fetchIssues: (hulyClient, projectIdentifier, db = null) =>
      fetchHulyIssues(hulyClient, projectIdentifier, config, db),
    updateIssueStatus: (hulyClient, issueIdentifier, status) =>
      updateHulyIssueStatus(hulyClient, issueIdentifier, status, config),
    updateIssueDescription: (hulyClient, issueIdentifier, description) =>
      updateHulyIssueDescription(hulyClient, issueIdentifier, description, config),
    updateIssueParent: (hulyClient, issueIdentifier, parentIdentifier) =>
      updateHulyIssueParent(hulyClient, issueIdentifier, parentIdentifier, config),
    syncVibeTaskToHuly: (hulyClient, vibeTask, hulyIssues, projectIdentifier, phase1UpdatedTasks) =>
      syncVibeTaskToHuly(hulyClient, vibeTask, hulyIssues, projectIdentifier, config, phase1UpdatedTasks),
  };
}
