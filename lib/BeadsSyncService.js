/**
 * Beads Sync Service — Facade
 *
 * Re-exports all sync functions from split modules for backward compatibility.
 */

export { acquireProjectMutex } from './beads/BeadsMutexService.js';
export {
  isValidProjectPath,
  normalizeTitleForComparison,
  findMatchingIssueByTitle,
  delay,
  getOperationDelay,
  getBatchDelay,
} from './beads/BeadsTitleMatcher.js';
export { syncBeadsToGit } from './beads/BeadsGitSync.js';
