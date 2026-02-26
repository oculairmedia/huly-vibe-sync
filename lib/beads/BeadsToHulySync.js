/**
 * Beads → Huly sync direction
 */

import { getBeadsParentId } from '../BeadsService.js';
import { getParentIdFromLookup } from '../BeadsDBReader.js';
import { isValidProjectPath, findMatchingIssueByTitle } from './BeadsTitleMatcher.js';

export async function syncBeadsIssueToHuly(
  hulyClient,
  projectPath,
  beadsIssue,
  hulyIssues,
  projectIdentifier,
  db,
  config = {},
  phase3UpdatedIssues = new Set()
) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for sync: ${projectPath}`);
    return;
  }

  const hulyIssueMap = config.lookupMaps?.hulyIssueMap || null;
  const beadsIdToDbIssue = config.lookupMaps?.beadsIdToDbIssue || null;

  const { updateHulyIssueStatus, updateHulyIssueTitle, updateHulyIssuePriority, createHulyIssue } =
    await import('../HulyService.js');
  const { getEffectiveHulyStatus, mapBeadsPriorityToHuly, mapBeadsTypeToHuly } = await import(
    '../statusMapper.js'
  );

  if (phase3UpdatedIssues.has(beadsIssue.id)) {
    console.log(`[Skip Beads→Huly] Issue ${beadsIssue.id} was just updated in Phase 3a`);
    return;
  }

  let dbIssues = null;
  let dbIssue;
  if (beadsIdToDbIssue) {
    dbIssue = beadsIdToDbIssue.get(beadsIssue.id) || null;
  } else {
    dbIssues =
      typeof db.getProjectIssues === 'function'
        ? db.getProjectIssues(projectIdentifier)
        : db.getAllIssues();
    dbIssue = dbIssues.find(issue => issue.beads_issue_id === beadsIssue.id);
  }

  if (dbIssue?.deleted_from_huly) {
    return;
  }

  if (!dbIssue) {
    console.log(`[Beads→Huly] New issue detected in Beads: ${beadsIssue.id} - ${beadsIssue.title}`);

    let matchingHulyIssue = findMatchingIssueByTitle(hulyIssues, beadsIssue.title);

    if (!matchingHulyIssue) {
      matchingHulyIssue = hulyIssues.find(issue => {
        const desc = issue.description || '';
        return desc.includes(`Synced from Beads: ${beadsIssue.id}`);
      });
      if (matchingHulyIssue) {
        console.log(
          `[Beads→Huly] Found Huly issue ${matchingHulyIssue.identifier} with Beads ID ${beadsIssue.id} in description`
        );
      }
    }

    if (matchingHulyIssue) {
      console.log(
        `[Beads→Huly] Found existing Huly issue ${matchingHulyIssue.identifier} matching Beads ${beadsIssue.id} - linking instead of creating duplicate`
      );

      const beadsStatus = getEffectiveHulyStatus(beadsIssue);

      db.upsertIssue({
        identifier: matchingHulyIssue.identifier,
        project_identifier: projectIdentifier,
        huly_id: matchingHulyIssue.id,
        beads_issue_id: beadsIssue.id,
        title: matchingHulyIssue.title,
        status: matchingHulyIssue.status,
        priority: matchingHulyIssue.priority,
        beads_status: beadsIssue.status,
        beads_modified_at: beadsIssue.updated_at
          ? new Date(beadsIssue.updated_at).getTime()
          : Date.now(),
        huly_modified_at: matchingHulyIssue.modifiedOn
          ? typeof matchingHulyIssue.modifiedOn === 'number'
            ? matchingHulyIssue.modifiedOn
            : new Date(matchingHulyIssue.modifiedOn).getTime()
          : null,
      });

      console.log(
        `[Beads→Huly] ✓ Linked existing Huly issue ${matchingHulyIssue.identifier} to Beads ${beadsIssue.id} (avoided duplicate)`
      );
      return;
    }

    const beadsStatus = getEffectiveHulyStatus(beadsIssue);
    const beadsPriority = mapBeadsPriorityToHuly(beadsIssue.priority);
    const beadsType = mapBeadsTypeToHuly(beadsIssue.issue_type);

    const createdIssue = await createHulyIssue(
      hulyClient,
      projectIdentifier,
      {
        title: beadsIssue.title,
        description: `Synced from Beads: ${beadsIssue.id}\n\n${beadsIssue.description || ''}`,
        status: beadsStatus,
        priority: beadsPriority,
        type: beadsType,
      },
      config
    );

    if (createdIssue) {
      db.upsertIssue({
        identifier: createdIssue.identifier,
        project_identifier: projectIdentifier,
        huly_id: createdIssue.id,
        beads_issue_id: beadsIssue.id,
        title: beadsIssue.title,
        status: beadsStatus,
        priority: beadsPriority,
        beads_status: beadsIssue.status,
        beads_modified_at: beadsIssue.updated_at
          ? new Date(beadsIssue.updated_at).getTime()
          : Date.now(),
      });

      console.log(
        `[Beads→Huly] ✓ Created Huly issue ${createdIssue.identifier} from Beads ${beadsIssue.id}`
      );
    }

    return;
  }

  // Issue exists in both systems - check for updates
  const hulyIdentifier = dbIssue.identifier;

  let hulyIssue = hulyIssueMap
    ? hulyIssueMap.get(hulyIdentifier) || null
    : hulyIssues.find(issue => issue.identifier === hulyIdentifier);

  if (!hulyIssue) {
    console.log(`[Beads→Huly] Issue ${hulyIdentifier} not in cache, fetching from Huly API...`);
    try {
      hulyIssue = await hulyClient.getIssue(hulyIdentifier);
      if (!hulyIssue) {
        console.warn(
          `[Beads→Huly] Huly issue ${hulyIdentifier} deleted - marking to skip future syncs`
        );
        db.markDeletedFromHuly(hulyIdentifier);
        return;
      }
    } catch (error) {
      console.warn(
        `[Beads→Huly] Huly issue ${hulyIdentifier} not found - marking to skip future syncs`
      );
      db.markDeletedFromHuly(hulyIdentifier);
      return;
    }
  }

  let updated = false;

  const currentHulyModifiedAt =
    typeof hulyIssue.modifiedOn === 'number'
      ? hulyIssue.modifiedOn
      : hulyIssue.modifiedOn
        ? new Date(hulyIssue.modifiedOn).getTime()
        : null;

  let nextHulyModifiedAt = currentHulyModifiedAt;

  const beadsLabels = beadsIssue.labels || [];
  const beadsStatusMapped = getEffectiveHulyStatus(beadsIssue);
  const hulyStatusNormalized = hulyIssue.status || 'Backlog';

  if (beadsStatusMapped !== hulyStatusNormalized) {
    console.log(
      `[Beads→Huly] Status update: ${hulyIdentifier} ` +
        `(${hulyStatusNormalized} → ${beadsStatusMapped}) [beads: ${beadsIssue.status}, labels: ${beadsLabels.join(', ') || 'none'}]`
    );

    const success = await updateHulyIssueStatus(
      hulyClient,
      hulyIdentifier,
      beadsStatusMapped,
      config
    );

    if (success) {
      updated = true;
      nextHulyModifiedAt = Date.now();
    }
  }

  if (beadsIssue.title !== hulyIssue.title) {
    console.log(`[Beads→Huly] Title update: ${hulyIdentifier}`);

    const success = await updateHulyIssueTitle(
      hulyClient,
      hulyIdentifier,
      beadsIssue.title,
      config
    );

    if (success) {
      updated = true;
      nextHulyModifiedAt = Date.now();
    }
  }

  const beadsPriorityMapped = mapBeadsPriorityToHuly(beadsIssue.priority);
  const hulyPriorityNormalized = hulyIssue.priority || 'None';

  if (beadsPriorityMapped !== hulyPriorityNormalized) {
    console.log(
      `[Beads→Huly] Priority update: ${hulyIdentifier} ` +
        `(${hulyPriorityNormalized} → ${beadsPriorityMapped})`
    );

    const success = await updateHulyIssuePriority(
      hulyClient,
      hulyIdentifier,
      beadsPriorityMapped,
      config
    );

    if (success) {
      updated = true;
      nextHulyModifiedAt = Date.now();
    }
  }

  // Reparenting detection
  const storedParentBeadsId = dbIssue?.parent_beads_id || null;
  const currentParentBeadsId = config.parentMap
    ? getParentIdFromLookup(config.parentMap, beadsIssue.id)
    : await getBeadsParentId(projectPath, beadsIssue.id);

  if (storedParentBeadsId !== currentParentBeadsId) {
    console.log(
      `[Beads→Huly] Reparenting detected: ${hulyIdentifier} (beads parent: ${storedParentBeadsId || 'none'} → ${currentParentBeadsId || 'none'})`
    );

    let newParentHulyId = null;
    if (currentParentBeadsId) {
      const parentDbIssue = beadsIdToDbIssue
        ? beadsIdToDbIssue.get(currentParentBeadsId) || null
        : (dbIssues || []).find(i => i.beads_issue_id === currentParentBeadsId);
      if (parentDbIssue) {
        newParentHulyId = parentDbIssue.identifier;
      } else {
        console.log(`[Beads→Huly] New parent ${currentParentBeadsId} not yet synced to Huly`);
      }
    }

    const storedParentHulyId = dbIssue?.parent_huly_id || null;

    if (newParentHulyId !== storedParentHulyId) {
      console.log(
        `[Beads→Huly] Tracking reparent: ${hulyIdentifier} parent ${storedParentHulyId || 'none'} → ${newParentHulyId || 'none'}`
      );

      db.updateParentChild(hulyIdentifier, newParentHulyId, currentParentBeadsId);

      updated = true;
    }
  }

  if (updated) {
    db.upsertIssue({
      identifier: hulyIdentifier,
      project_identifier: projectIdentifier,
      status: beadsStatusMapped,
      priority: beadsPriorityMapped,
      title: beadsIssue.title,
      beads_issue_id: beadsIssue.id,
      beads_status: beadsIssue.status,
      huly_modified_at: nextHulyModifiedAt ?? null,
      beads_modified_at: beadsIssue.updated_at
        ? new Date(beadsIssue.updated_at).getTime()
        : Date.now(),
    });
  }
}
