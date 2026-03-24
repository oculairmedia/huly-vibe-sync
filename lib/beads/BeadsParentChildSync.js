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

export async function syncAllParentChildFromHuly(projectPath, hulyIssues, db, config = {}) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for parent-child Huly import: ${projectPath}`);
    return { synced: 0, skipped: 0, errors: ['Invalid project path'] };
  }

  const result = { synced: 0, skipped: 0, errors: [] };
  const opDelay = getOperationDelay(config);
  const beadsIssueIndex =
    typeof db.getAllIssues === 'function' ? buildIssueIndexByBeadsId(db.getAllIssues()) : null;

  const issuesWithParent = hulyIssues.filter(i => i.parent);

  for (const issue of issuesWithParent) {
    try {
      const childDbIssue = db.getIssue(issue.identifier);
      const parentDbIssue = db.getIssue(issue.parent);

      if (!childDbIssue?.beads_issue_id || !parentDbIssue?.beads_issue_id) {
        result.skipped++;
        continue;
      }

      const success = await syncParentChildToBeads(
        projectPath,
        childDbIssue.beads_issue_id,
        parentDbIssue.beads_issue_id,
        db,
        config,
        beadsIssueIndex
      );

      if (success) {
        result.synced++;
        if (opDelay > 0) await delay(opDelay);
      } else {
        result.skipped++;
      }
    } catch (error) {
      result.errors.push(`${issue.identifier}: ${error.message}`);
    }
  }

  return result;
}
