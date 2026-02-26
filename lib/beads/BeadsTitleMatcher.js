/**
 * Title matching and validation utilities for Beads sync
 */

import { validateGitRepoPath } from '../textParsers.js';

export function isValidProjectPath(projectPath) {
  return validateGitRepoPath(projectPath).valid;
}

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export const getOperationDelay = config => config?.beads?.operationDelay ?? 50;
export const getBatchDelay = config => config?.beads?.batchDelay ?? 200;

export function normalizeTitleForComparison(title) {
  if (!title) return '';
  return title
    .trim()
    .toLowerCase()
    .replace(/^\[p[0-4]\]\s*/i, '')
    .replace(/^\[perf[^\]]*\]\s*/i, '')
    .replace(/^\[tier\s*\d+\]\s*/i, '')
    .replace(/^\[action\]\s*/i, '')
    .replace(/^\[bug\]\s*/i, '')
    .replace(/^\[fixed\]\s*/i, '')
    .trim();
}

export function findMatchingIssueByTitle(issues, targetTitle, getTitleFn = i => i.title) {
  const normalizedTarget = normalizeTitleForComparison(targetTitle);

  return issues.find(issue => {
    const normalizedTitle = normalizeTitleForComparison(getTitleFn(issue));
    return normalizedTitle === normalizedTarget;
  });
}
