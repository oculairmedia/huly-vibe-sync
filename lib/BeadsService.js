/**
 * Beads Service — Facade
 *
 * Re-exports from domain-specific Beads modules.
 */

// Git operations
export {
  execGitCommand,
  isGitRepository,
  commitBeadsSyncFiles,
  beadsWorkingTreeDirty,
} from './beads/BeadsGitOps.js';

// CLI operations
export {
  execBeadsCommand,
  listBeadsIssues,
  getBeadsIssue,
  createBeadsIssue,
  updateBeadsIssue,
  updateBeadsIssueStatusWithLabel,
  closeBeadsIssue,
  reopenBeadsIssue,
} from './beads/BeadsCLI.js';

// Initializer
export {
  isBeadsInitialized,
  initializeBeads,
  ensureBeadsInitialized,
} from './beads/BeadsInitializer.js';

// Parent-child dependency operations (from BeadsParentChildService)
export {
  addParentChildDependency,
  removeParentChildDependency,
  getDependencyTree,
  getIssueWithDependencies,
  syncParentChildToBeads,
  getParentChildRelationships,
  getBeadsParentId,
  getBeadsIssuesWithDependencies,
  syncBeadsParentChildToHuly,
  createHulySubIssueFromBeads,
  syncParentChildToHuly,
  syncAllParentChildToHuly,
} from './BeadsParentChildService.js';

// Sync functions (from BeadsSyncService)
export { syncHulyIssueToBeads, syncBeadsIssueToHuly, syncBeadsToGit } from './BeadsSyncService.js';

// DB reader utilities
export {
  readIssuesFromDB as readIssuesFromJSONL,
  findHulyIdentifier,
  buildIssueLookups,
  getBeadsIssuesWithLookups,
  normalizeTitleForComparison,
  getParentIdFromLookup,
} from './BeadsDBReader.js';

// Factory
import { listBeadsIssues, getBeadsIssue, createBeadsIssue, updateBeadsIssue, closeBeadsIssue, reopenBeadsIssue } from './beads/BeadsCLI.js';

export function createBeadsService(config) {
  return {
    listIssues: projectPath => listBeadsIssues(projectPath),
    getIssue: (projectPath, issueId) => getBeadsIssue(projectPath, issueId),
    createIssue: (projectPath, issueData) => createBeadsIssue(projectPath, issueData, config),
    updateIssue: (projectPath, issueId, field, value) =>
      updateBeadsIssue(projectPath, issueId, field, value, config),
    closeIssue: (projectPath, issueId) => closeBeadsIssue(projectPath, issueId, config),
    reopenIssue: (projectPath, issueId) => reopenBeadsIssue(projectPath, issueId, config),
    syncHulyIssueToBeads: async (projectPath, hulyIssue, beadsIssues, db) => {
      const { syncHulyIssueToBeads } = await import('./BeadsSyncService.js');
      return syncHulyIssueToBeads(projectPath, hulyIssue, beadsIssues, db, config);
    },
    syncBeadsIssueToHuly: async (
      hulyClient, projectPath, beadsIssue, hulyIssues, projectIdentifier, db, phase3UpdatedIssues
    ) =>
      (await import('./BeadsSyncService.js')).syncBeadsIssueToHuly(
        hulyClient, projectPath, beadsIssue, hulyIssues, projectIdentifier, db, config, phase3UpdatedIssues
      ),
  };
}
