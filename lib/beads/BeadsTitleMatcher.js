/**
 * Title matching and validation utilities for Beads sync
 */

import fs from 'fs';
import path from 'path';

export function isValidProjectPath(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') {
    return false;
  }

  if (!path.isAbsolute(projectPath)) {
    return false;
  }

  return fs.existsSync(projectPath);
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
    if (normalizedTitle === normalizedTarget) return true;
    if (normalizedTarget.length > 10 && normalizedTitle.length > 10) {
      if (
        normalizedTitle.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedTitle)
      ) {
        return true;
      }
    }
    return false;
  });
}
