import {
  addParentChildDependency,
  getParentChildRelationships,
  getDependencyTreeSafe,
  isValidProjectPath,
} from './BeadsParentChildOps.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const getOperationDelay = config => config?.beads?.operationDelay ?? 50;
const buildIssueIndexByBeadsId = issues => {
  const beadsIssueIndex = new Map();

  for (const issue of issues) {
    if (issue.beads_issue_id) {
      beadsIssueIndex.set(issue.beads_issue_id, issue);
    }
  }

  return beadsIssueIndex;
};

export async function syncParentChildToBeads(
  projectPath,
  childBeadsId,
  parentBeadsId,
  db,
  config = {},
  beadsIssueIndex = null
) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for parent-child sync: ${projectPath}`);
    return false;
  }

  if (!childBeadsId || !parentBeadsId) {
    console.log(
      `[Beads] Cannot sync parent-child: missing IDs (child: ${childBeadsId}, parent: ${parentBeadsId})`
    );
    return false;
  }

  const success = await addParentChildDependency(projectPath, childBeadsId, parentBeadsId, config);

  if (success) {
    const issueIndex =
      beadsIssueIndex ??
      (typeof db.getAllIssues === 'function' ? buildIssueIndexByBeadsId(db.getAllIssues()) : null);
    const childIssue = issueIndex?.get(childBeadsId);
    if (childIssue) {
      db.updateParentChild(childIssue.identifier, childIssue.parent_huly_id, parentBeadsId);
    }
  }

  return success;
}

// syncAllParentChildFromHuly removed — dead Huly-specific code
