/**
 * Beads Parent-Child Sync - Bidirectional sync of parent-child relationships
 */

import {
  addParentChildDependency,
  getBeadsIssuesWithDependencies,
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
  projectPath, childBeadsId, parentBeadsId, db, config = {}, beadsIssueIndex = null
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
      (typeof db.getAllIssues === 'function'
        ? buildIssueIndexByBeadsId(db.getAllIssues())
        : null);
    const childIssue = issueIndex?.get(childBeadsId);
    if (childIssue) {
      db.updateParentChild(childIssue.identifier, childIssue.parent_huly_id, parentBeadsId);
    }
  }

  return success;
}

export async function syncBeadsParentChildToHuly(
  hulyClient, projectPath, projectIdentifier, db, config = {}
) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for Beads parent-child sync: ${projectPath}`);
    return { synced: 0, skipped: 0, errors: ['Invalid project path'] };
  }

  const results = { synced: 0, skipped: 0, errors: [] };

  try {
    const beadsIssues = await getBeadsIssuesWithDependencies(projectPath);
    const issuesWithDeps = beadsIssues.filter(i => i.dependency_count > 0);

    if (issuesWithDeps.length === 0) {
      console.log(`[Beads\u2192Huly] No parent-child relationships to sync`);
      return results;
    }

    console.log(`[Beads\u2192Huly] Found ${issuesWithDeps.length} issues with dependencies`);
    const beadsIssueIndex =
      typeof db.getAllIssues === 'function'
        ? buildIssueIndexByBeadsId(db.getAllIssues())
        : new Map();

    for (const beadsIssue of issuesWithDeps) {
      try {
        const relationships = await getParentChildRelationships(projectPath, beadsIssue.id);

        for (const rel of relationships) {
          const childDbIssue = beadsIssueIndex.get(rel.childId);
          const parentDbIssue = beadsIssueIndex.get(rel.parentId);

          if (!childDbIssue || !parentDbIssue) {
            console.log(
              `[Beads\u2192Huly] Skipping relationship - issues not synced yet (child: ${rel.childId}, parent: ${rel.parentId})`
            );
            results.skipped++;
            continue;
          }

          if (childDbIssue.parent_huly_id === parentDbIssue.identifier) {
            results.skipped++;
            continue;
          }

          console.log(
            `[Beads\u2192Huly] Tracking parent-child: ${childDbIssue.identifier} -> ${parentDbIssue.identifier}`
          );

          db.updateParentChild(childDbIssue.identifier, parentDbIssue.identifier, rel.parentId);

          const currentCount = parentDbIssue.sub_issue_count || 0;
          const updatedCount = currentCount + 1;
          db.updateSubIssueCount(parentDbIssue.identifier, updatedCount);
          parentDbIssue.sub_issue_count = updatedCount;

          results.synced++;
        }
      } catch (error) {
        console.error(
          `[Beads\u2192Huly] Error syncing relationships for ${beadsIssue.id}:`,
          error.message
        );
        results.errors.push({ issueId: beadsIssue.id, error: error.message });
      }
    }

    console.log(
      `[Beads\u2192Huly] Parent-child sync complete: ${results.synced} synced, ${results.skipped} skipped, ${results.errors.length} errors`
    );
    return results;
  } catch (error) {
    console.error(`[Beads\u2192Huly] Error in parent-child sync:`, error.message);
    results.errors.push({ error: error.message });
    return results;
  }
}

export async function createHulySubIssueFromBeads(
  hulyClient, beadsIssue, parentHulyIdentifier, db, config = {}
) {
  const { mapBeadsStatusToHuly, mapBeadsPriorityToHuly } = await import('../statusMapper.js');

  if (config.sync?.dryRun) {
    console.log(
      `[Beads\u2192Huly] [DRY RUN] Would create sub-issue under ${parentHulyIdentifier}: ${beadsIssue.title}`
    );
    return null;
  }

  try {
    const beadsLabels = beadsIssue.labels || [];
    const hulyStatus = mapBeadsStatusToHuly(beadsIssue.status, beadsLabels);
    const hulyPriority = mapBeadsPriorityToHuly(beadsIssue.priority);

    const subIssue = await hulyClient.createSubIssue(parentHulyIdentifier, {
      title: beadsIssue.title,
      description: beadsIssue.description || `Synced from Beads: ${beadsIssue.id}`,
      priority: hulyPriority,
    });

    if (subIssue) {
      if (hulyStatus && hulyStatus !== 'Backlog' && hulyStatus !== 'Todo') {
        await hulyClient.patchIssue(subIssue.identifier, { status: hulyStatus });
      }

      db.upsertIssue({
        identifier: subIssue.identifier,
        project_identifier: subIssue.project || subIssue.space,
        huly_id: subIssue._id,
        beads_issue_id: beadsIssue.id,
        title: beadsIssue.title,
        status: hulyStatus,
        priority: hulyPriority,
        beads_status: beadsIssue.status,
        parent_huly_id: parentHulyIdentifier,
        parent_beads_id: null,
        beads_modified_at: beadsIssue.updated_at
          ? new Date(beadsIssue.updated_at).getTime()
          : Date.now(),
      });

      console.log(
        `[Beads\u2192Huly] \u2713 Created sub-issue ${subIssue.identifier} under ${parentHulyIdentifier}`
      );
      return subIssue;
    }

    return null;
  } catch (error) {
    console.error(
      `[Beads\u2192Huly] Error creating sub-issue under ${parentHulyIdentifier}:`,
      error.message
    );
    return null;
  }
}

export async function syncParentChildToHuly(
  hulyClient, projectPath, childBeadsIssue, parentBeadsIssue, db, config = {}
) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for parent-child Huly sync: ${projectPath}`);
    return false;
  }

  if (!childBeadsIssue || !parentBeadsIssue) {
    console.log(`[Beads\u2192Huly] Cannot sync parent-child: missing issue data`);
    return false;
  }

  const dbIssues = db.getAllIssues();
  const childDbIssue = dbIssues.find(i => i.beads_issue_id === childBeadsIssue.id);
  const parentDbIssue = dbIssues.find(i => i.beads_issue_id === parentBeadsIssue.id);

  if (!childDbIssue || !parentDbIssue) {
    console.log(`[Beads\u2192Huly] Cannot sync parent-child: issues not synced to Huly yet`);
    return false;
  }

  if (childDbIssue.parent_huly_id === parentDbIssue.identifier) {
    return true;
  }

  if (config.sync?.dryRun) {
    console.log(
      `[Beads\u2192Huly] [DRY RUN] Would set ${childDbIssue.identifier} as sub-issue of ${parentDbIssue.identifier}`
    );
    return true;
  }

  try {
    console.log(
      `[Beads\u2192Huly] Setting ${childDbIssue.identifier} as sub-issue of ${parentDbIssue.identifier}`
    );

    db.updateParentChild(childDbIssue.identifier, parentDbIssue.identifier, parentBeadsIssue.id);

    console.log(`[Beads\u2192Huly] \u2713 Updated parent-child relationship in sync database`);
    return true;
  } catch (error) {
    console.error(`[Beads\u2192Huly] Error syncing parent-child:`, error.message);
    return false;
  }
}

export async function syncAllParentChildToHuly(
  hulyClient, projectPath, beadsIssues, db, config = {}
) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for parent-child full sync: ${projectPath}`);
    return 0;
  }

  let syncedCount = 0;
  const opDelay = getOperationDelay(config);

  const issuesWithDeps = beadsIssues.filter(i => i.dependency_count > 0);

  for (const childIssue of issuesWithDeps) {
    try {
      const tree = await getDependencyTreeSafe(projectPath, childIssue.id);

      if (!tree || tree.length <= 1) continue;

      if (opDelay > 0) await delay(opDelay);

      for (const node of tree) {
        if (node.depth === 1) {
          const parentIssue = beadsIssues.find(i => i.id === node.id);
          if (parentIssue) {
            const success = await syncParentChildToHuly(
              hulyClient, projectPath, childIssue, parentIssue, db, config
            );
            if (success) syncedCount++;
          }
        }
      }
    } catch (error) {
      console.error(
        `[Beads\u2192Huly] Error processing dependencies for ${childIssue.id}:`,
        error.message
      );
    }
  }

  console.log(`[Beads\u2192Huly] Synced ${syncedCount} parent-child relationships`);
  return syncedCount;
}

export async function syncAllParentChildFromHuly(projectPath, hulyIssues, db, config = {}) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for parent-child Huly import: ${projectPath}`);
    return { synced: 0, skipped: 0, errors: ['Invalid project path'] };
  }

  const result = { synced: 0, skipped: 0, errors: [] };
  const opDelay = getOperationDelay(config);
  const beadsIssueIndex =
    typeof db.getAllIssues === 'function'
      ? buildIssueIndexByBeadsId(db.getAllIssues())
      : null;

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
