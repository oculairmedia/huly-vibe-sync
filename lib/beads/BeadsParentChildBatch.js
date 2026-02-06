/**
 * Beads Parent-Child Batch - Batch operations and validation
 */

import {
  addParentChildDependency,
  removeParentChildDependency,
  getBeadsParentId,
  isValidProjectPath,
} from './BeadsParentChildOps.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const getOperationDelay = config => config?.beads?.operationDelay ?? 50;

export async function getAllParentChildRelationships(projectPath, beadsIssues) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for relationship scan: ${projectPath}`);
    return [];
  }

  const relationships = [];

  for (const issue of beadsIssues) {
    if (issue.dependency_count > 0) {
      try {
        const parentId = await getBeadsParentId(projectPath, issue.id);
        if (parentId) {
          relationships.push({
            childId: issue.id,
            parentId,
            source: 'beads',
            success: true,
          });
        }
      } catch (error) {
        relationships.push({
          childId: issue.id,
          parentId: null,
          source: 'beads',
          success: false,
          error: error.message,
        });
      }
    }
  }

  return relationships;
}

export function validateParentChildConsistency(db, projectIdentifier) {
  const issues = db.getProjectIssues ? db.getProjectIssues(projectIdentifier) : db.getAllIssues();

  const mismatches = [];
  const orphans = [];

  for (const issue of issues) {
    if (issue.parent_huly_id && !issue.parent_beads_id) {
      mismatches.push({
        identifier: issue.identifier,
        type: 'huly_only_parent',
        parent_huly_id: issue.parent_huly_id,
      });
    }

    if (issue.parent_beads_id && !issue.parent_huly_id) {
      mismatches.push({
        identifier: issue.identifier,
        type: 'beads_only_parent',
        parent_beads_id: issue.parent_beads_id,
      });
    }

    if (issue.parent_huly_id) {
      const parent = issues.find(i => i.identifier === issue.parent_huly_id);
      if (!parent) {
        orphans.push({
          identifier: issue.identifier,
          parent_huly_id: issue.parent_huly_id,
        });
      }
    }
  }

  return {
    valid: mismatches.length === 0 && orphans.length === 0,
    mismatches,
    orphans,
    totalIssues: issues.length,
    issuesWithParent: issues.filter(i => i.parent_huly_id || i.parent_beads_id).length,
  };
}

export async function batchCreateDependencies(projectPath, relationships, db, config = {}) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for dependency batch create: ${projectPath}`);
    return { synced: 0, skipped: 0, errors: ['Invalid project path'] };
  }

  const result = { synced: 0, skipped: 0, errors: [] };
  const opDelay = getOperationDelay(config);

  for (const { childId, parentId } of relationships) {
    try {
      const success = await addParentChildDependency(projectPath, childId, parentId, config);
      if (success) {
        result.synced++;
        if (opDelay > 0) await delay(opDelay);
      } else {
        result.skipped++;
      }
    } catch (error) {
      result.errors.push(`${childId} -> ${parentId}: ${error.message}`);
    }
  }

  return result;
}

export async function batchRemoveDependencies(projectPath, relationships, config = {}) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for dependency batch remove: ${projectPath}`);
    return { synced: 0, skipped: 0, errors: ['Invalid project path'] };
  }

  const result = { synced: 0, skipped: 0, errors: [] };
  const opDelay = getOperationDelay(config);

  for (const { childId, parentId } of relationships) {
    try {
      const success = await removeParentChildDependency(projectPath, childId, parentId, config);
      if (success) {
        result.synced++;
        if (opDelay > 0) await delay(opDelay);
      } else {
        result.skipped++;
      }
    } catch (error) {
      result.errors.push(`${childId} -> ${parentId}: ${error.message}`);
    }
  }

  return result;
}
