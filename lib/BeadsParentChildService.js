/**
 * Beads Parent-Child Service — Facade
 *
 * Re-exports from domain-specific parent-child modules.
 */

export {
  addParentChildDependency,
  removeParentChildDependency,
  getDependencyTree,
  getIssueWithDependencies,
  getBeadsParentId,
  getBeadsIssuesWithDependencies,
  getParentChildRelationships,
} from './beads/BeadsParentChildOps.js';

export {
  syncParentChildToBeads,
  syncBeadsParentChildToHuly,
  createHulySubIssueFromBeads,
  syncParentChildToHuly,
  syncAllParentChildToHuly,
  syncAllParentChildFromHuly,
} from './beads/BeadsParentChildSync.js';

export {
  getAllParentChildRelationships,
  validateParentChildConsistency,
  batchCreateDependencies,
  batchRemoveDependencies,
} from './beads/BeadsParentChildBatch.js';
