/**
 * Huly → Beads sync direction
 */

import {
  createBeadsIssue,
  updateBeadsIssue,
  updateBeadsIssueStatusWithLabel,
} from '../BeadsService.js';

import {
  syncParentChildToBeads,
  addParentChildDependency,
  removeParentChildDependency,
} from '../BeadsService.js';

import { findHulyIdentifier } from '../BeadsDBReader.js';
import { isValidProjectPath, normalizeTitleForComparison, findMatchingIssueByTitle } from './BeadsTitleMatcher.js';

export async function syncHulyIssueToBeads(projectPath, hulyIssue, beadsIssues, db, config = {}) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for sync: ${projectPath}`);
    return null;
  }

  const { mapHulyStatusToBeads, mapHulyPriorityToBeads, mapHulyTypeToBeads, getHulyStatusLabels } =
    await import('../statusMapper.js');

  const dbIssue = db.getIssue(hulyIssue.identifier);
  const beadsIssueId = dbIssue?.beads_issue_id;

  let beadsIssue = null;
  if (beadsIssueId) {
    const lookups = config.lookups;
    beadsIssue = lookups?.byId?.get(beadsIssueId) || beadsIssues.find(issue => issue.id === beadsIssueId);
  }

  const projectIdentifier = hulyIssue.project || hulyIssue.space;

  const lastSeenHulyModifiedAt = dbIssue?.huly_modified_at || 0;
  const lastSeenBeadsModifiedAt = dbIssue?.beads_modified_at || 0;

  const currentHulyModifiedAt =
    typeof hulyIssue.modifiedOn === 'number'
      ? hulyIssue.modifiedOn
      : hulyIssue.modifiedOn
        ? new Date(hulyIssue.modifiedOn).getTime()
        : null;

  const currentBeadsModifiedAt = beadsIssue?.updated_at
    ? new Date(beadsIssue.updated_at).getTime()
    : null;

  const hulyChangedSinceLastSeen =
    currentHulyModifiedAt !== null && currentHulyModifiedAt > lastSeenHulyModifiedAt;
  const beadsChangedSinceLastSeen =
    currentBeadsModifiedAt !== null && currentBeadsModifiedAt > lastSeenBeadsModifiedAt;

  if (!beadsIssue) {
    let matchingBeadsIssue = null;
    const lookups = config.lookups;

    if (lookups) {
      matchingBeadsIssue = lookups.byHulyId.get(hulyIssue.identifier);
      if (matchingBeadsIssue) {
        console.log(
          `[Huly→Beads] Found existing Beads issue ${matchingBeadsIssue.id} linked to Huly ${hulyIssue.identifier}`
        );
      }

      if (!matchingBeadsIssue) {
        const normalizedTitle = normalizeTitleForComparison(hulyIssue.title);
        matchingBeadsIssue = lookups.byTitle.get(normalizedTitle);
        if (matchingBeadsIssue) {
          console.log(
            `[Huly→Beads] Found existing Beads issue ${matchingBeadsIssue.id} matching title "${hulyIssue.title}"`
          );
        }
      }
    } else {
      matchingBeadsIssue = findMatchingIssueByTitle(beadsIssues, hulyIssue.title);

      if (!matchingBeadsIssue) {
        matchingBeadsIssue = beadsIssues.find(issue => {
          const hulyId = findHulyIdentifier(issue);
          return hulyId === hulyIssue.identifier;
        });
        if (matchingBeadsIssue) {
          console.log(
            `[Huly→Beads] Found Beads issue ${matchingBeadsIssue.id} with Huly identifier ${hulyIssue.identifier}`
          );
        }
      }
    }

    if (matchingBeadsIssue) {
      console.log(
        `[Huly→Beads] Found existing Beads issue ${matchingBeadsIssue.id} matching Huly ${hulyIssue.identifier} - linking instead of creating duplicate`
      );

      const { status: beadsStatus } = mapHulyStatusToBeads(hulyIssue.status);

      db.upsertIssue({
        identifier: hulyIssue.identifier,
        project_identifier: projectIdentifier,
        huly_id: hulyIssue.id,
        beads_issue_id: matchingBeadsIssue.id,
        title: hulyIssue.title,
        status: hulyIssue.status,
        priority: hulyIssue.priority,
        beads_status: matchingBeadsIssue.status,
        beads_modified_at: matchingBeadsIssue.updated_at
          ? new Date(matchingBeadsIssue.updated_at).getTime()
          : Date.now(),
        huly_modified_at: currentHulyModifiedAt ?? null,
      });

      console.log(
        `[Huly→Beads] ✓ Linked existing Beads issue ${matchingBeadsIssue.id} to Huly ${hulyIssue.identifier} (avoided duplicate)`
      );
      return matchingBeadsIssue;
    }

    const { status: beadsStatus, label: beadsLabel } = mapHulyStatusToBeads(hulyIssue.status);
    const beadsPriority = mapHulyPriorityToBeads(hulyIssue.priority);
    const beadsType = mapHulyTypeToBeads(hulyIssue.type);

    const description = hulyIssue.description
      ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.identifier}`
      : `Synced from Huly: ${hulyIssue.identifier}`;

    const labels = [];
    if (beadsLabel) {
      labels.push(beadsLabel);
    }

    const createdIssue = await createBeadsIssue(
      projectPath,
      {
        title: hulyIssue.title,
        description: description,
        priority: beadsPriority,
        type: beadsType,
        labels: labels,
      },
      config
    );

    if (createdIssue) {
      if (beadsStatus !== 'open') {
        await updateBeadsIssue(projectPath, createdIssue.id, 'status', beadsStatus, config);
      }

      const createdBeadsModifiedAt = createdIssue.updated_at
        ? new Date(createdIssue.updated_at).getTime()
        : Date.now();

      db.upsertIssue({
        identifier: hulyIssue.identifier,
        project_identifier: projectIdentifier,
        title: hulyIssue.title,
        description: hulyIssue.description,
        status: hulyIssue.status,
        priority: hulyIssue.priority,
        beads_issue_id: createdIssue.id,
        beads_status: beadsStatus,
        huly_modified_at: currentHulyModifiedAt ?? null,
        beads_modified_at: createdBeadsModifiedAt,
        parent_huly_id: hulyIssue.parentIssue?.identifier || null,
        sub_issue_count: hulyIssue.subIssueCount || 0,
      });

      if (hulyIssue.parentIssue?.identifier) {
        const parentDbIssue = db.getIssue(hulyIssue.parentIssue.identifier);
        if (parentDbIssue?.beads_issue_id) {
          await syncParentChildToBeads(
            projectPath,
            createdIssue.id,
            parentDbIssue.beads_issue_id,
            db,
            config
          );
        } else {
          console.log(
            `[Beads] Parent ${hulyIssue.parentIssue.identifier} not yet synced, will sync dependency later`
          );
        }
      }

      return createdIssue;
    }

    return null;
  }

  // Issue exists - check for updates from Huly
  const { status: desiredBeadsStatus, label: desiredBeadsLabel } = mapHulyStatusToBeads(
    hulyIssue.status
  );
  const desiredBeadsPriority = mapHulyPriorityToBeads(hulyIssue.priority);
  const desiredTitle = hulyIssue.title;
  const hulyStatusLabels = getHulyStatusLabels();

  const currentLabels = beadsIssue.labels || [];
  const currentHulyLabel = currentLabels.find(l => hulyStatusLabels.includes(l)) || null;
  const statusMismatch =
    beadsIssue.status !== desiredBeadsStatus || currentHulyLabel !== desiredBeadsLabel;
  const priorityMismatch = beadsIssue.priority !== desiredBeadsPriority;
  const titleMismatch = beadsIssue.title !== desiredTitle;

  if (!statusMismatch && !priorityMismatch && !titleMismatch) {
    return null;
  }

  if (beadsChangedSinceLastSeen && !hulyChangedSinceLastSeen) {
    console.log(
      `[Beads] Detected local Beads changes for ${hulyIssue.identifier}; deferring to Beads→Huly sync`
    );
    return null;
  }

  if (beadsChangedSinceLastSeen && hulyChangedSinceLastSeen) {
    const hulyWins =
      currentBeadsModifiedAt === null ||
      currentHulyModifiedAt === null ||
      currentHulyModifiedAt >= currentBeadsModifiedAt;

    if (!hulyWins) {
      console.log(
        `[Beads] Conflict for ${hulyIssue.identifier}; Beads is newer, deferring to Beads→Huly sync`
      );
      return null;
    }

    console.log(`[Beads] Conflict for ${hulyIssue.identifier}; Huly is newer, applying to Beads`);
  }

  let updated = false;

  if (statusMismatch) {
    console.log(
      `[Beads] Status change detected: ${hulyIssue.identifier} (${beadsIssue.status}/${currentHulyLabel || 'no-label'} → ${desiredBeadsStatus}/${desiredBeadsLabel || 'no-label'})`
    );
    await updateBeadsIssueStatusWithLabel(
      projectPath,
      beadsIssue.id,
      desiredBeadsStatus,
      desiredBeadsLabel,
      currentLabels,
      config
    );
    updated = true;
  }

  if (priorityMismatch) {
    console.log(
      `[Beads] Priority change detected: ${hulyIssue.identifier} (${beadsIssue.priority} → ${desiredBeadsPriority})`
    );
    await updateBeadsIssue(projectPath, beadsIssue.id, 'priority', desiredBeadsPriority, config);
    updated = true;
  }

  if (titleMismatch) {
    console.log(`[Beads] Title change detected: ${hulyIssue.identifier}`);
    await updateBeadsIssue(projectPath, beadsIssue.id, 'title', desiredTitle, config);
    updated = true;
  }

  // Reparenting detection
  const storedParentHulyId = dbIssue?.parent_huly_id || null;
  const currentParentHulyId = hulyIssue.parentIssue?.identifier || null;

  if (storedParentHulyId !== currentParentHulyId) {
    console.log(
      `[Beads] Reparenting detected: ${hulyIssue.identifier} (${storedParentHulyId || 'top-level'} → ${currentParentHulyId || 'top-level'})`
    );

    if (storedParentHulyId) {
      const oldParentDbIssue = db.getIssue(storedParentHulyId);
      if (oldParentDbIssue?.beads_issue_id) {
        await removeParentChildDependency(
          projectPath,
          beadsIssue.id,
          oldParentDbIssue.beads_issue_id,
          config
        );
        console.log(
          `[Beads] ✓ Removed old parent dependency: ${beadsIssue.id} -> ${oldParentDbIssue.beads_issue_id}`
        );
      }
    }

    if (currentParentHulyId) {
      const newParentDbIssue = db.getIssue(currentParentHulyId);
      if (newParentDbIssue?.beads_issue_id) {
        await addParentChildDependency(
          projectPath,
          beadsIssue.id,
          newParentDbIssue.beads_issue_id,
          config
        );
        console.log(
          `[Beads] ✓ Added new parent dependency: ${beadsIssue.id} -> ${newParentDbIssue.beads_issue_id}`
        );

        db.updateParentChild(
          hulyIssue.identifier,
          currentParentHulyId,
          newParentDbIssue.beads_issue_id
        );
      } else {
        console.log(`[Beads] New parent ${currentParentHulyId} not yet synced to Beads`);
        db.updateParentChild(hulyIssue.identifier, currentParentHulyId, null);
      }
    } else {
      db.updateParentChild(hulyIssue.identifier, null, null);
    }

    updated = true;
  }

  if (updated) {
    db.upsertIssue({
      identifier: hulyIssue.identifier,
      project_identifier: projectIdentifier,
      title: hulyIssue.title,
      description: hulyIssue.description,
      status: hulyIssue.status,
      priority: hulyIssue.priority,
      beads_issue_id: beadsIssue.id,
      beads_status: desiredBeadsStatus,
      huly_modified_at: currentHulyModifiedAt ?? null,
      beads_modified_at: currentBeadsModifiedAt ?? Date.now(),
    });

    return beadsIssue;
  }

  return null;
}
