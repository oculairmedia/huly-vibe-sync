/**
 * Batch sync operations for Beads
 */

import { buildIssueLookups } from '../BeadsDBReader.js';
import { syncHulyIssueToBeads } from './HulyToBeadsSync.js';
import { syncBeadsIssueToHuly } from './BeadsToHulySync.js';
import { syncBeadsToGit } from './BeadsGitSync.js';
import { delay, getOperationDelay } from './BeadsTitleMatcher.js';

export async function batchSyncHulyToBeads(projectPath, hulyIssues, beadsIssues, db, config = {}) {
  const result = {
    synced: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  const lookups = buildIssueLookups(beadsIssues);
  const configWithLookups = { ...config, lookups };

  const opDelay = getOperationDelay(config);

  for (const hulyIssue of hulyIssues) {
    try {
      const synced = await syncHulyIssueToBeads(
        projectPath,
        hulyIssue,
        beadsIssues,
        db,
        configWithLookups
      );
      if (synced) {
        result.synced++;
        if (opDelay > 0) await delay(opDelay);
      } else {
        result.skipped++;
      }
    } catch (error) {
      result.errors++;
      result.errorMessages.push(`${hulyIssue.identifier}: ${error.message}`);
    }
  }

  return result;
}

export async function batchSyncBeadsToHuly(
  hulyClient,
  projectPath,
  beadsIssues,
  hulyIssues,
  projectIdentifier,
  db,
  config = {},
  phase3UpdatedIssues = new Set()
) {
  const result = {
    synced: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  const lookups = buildIssueLookups(beadsIssues);
  const configWithParentMap = { ...config, parentMap: lookups.parentMap };

  const opDelay = getOperationDelay(config);

  // PRE-FETCH: Identify and bulk-fetch issues that would cause cache misses
  const hulyIssueMap = new Map(hulyIssues.map(i => [i.identifier, i]));
  const dbIssues = db.getAllIssues();
  const beadsIdToDbIssue = new Map(
    dbIssues.filter(i => i.beads_issue_id).map(i => [i.beads_issue_id, i])
  );
  const missingIdentifiers = [];

  for (const beadsIssue of beadsIssues) {
    const dbIssue = beadsIdToDbIssue.get(beadsIssue.id);
    if (dbIssue && dbIssue.identifier && !hulyIssueMap.has(dbIssue.identifier)) {
      missingIdentifiers.push(dbIssue.identifier);
    }
  }

  console.log(
    `[Beads→Huly] Pre-fetch analysis: ${beadsIssues.length} beads issues, ${hulyIssues.length} cached huly issues, ${dbIssues.length} db issues, ${missingIdentifiers.length} missing`
  );

  if (missingIdentifiers.length > 0) {
    console.log(`[Beads→Huly] Pre-fetching ${missingIdentifiers.length} missing issues in bulk...`);
    try {
      const BATCH_SIZE = 50;
      for (let i = 0; i < missingIdentifiers.length; i += BATCH_SIZE) {
        const batch = missingIdentifiers.slice(i, i + BATCH_SIZE);
        const fetched = await hulyClient.getIssuesBulk(batch);
        for (const issue of fetched) {
          hulyIssueMap.set(issue.identifier, issue);
          hulyIssues.push(issue);
        }
        console.log(
          `[Beads→Huly] Bulk fetched ${fetched.length}/${batch.length} issues (batch ${Math.floor(i / BATCH_SIZE) + 1})`
        );
      }
    } catch (error) {
      console.warn(
        `[Beads→Huly] Bulk pre-fetch failed, falling back to individual fetches: ${error.message}`
      );
    }
  }

  for (const beadsIssue of beadsIssues) {
    try {
      await syncBeadsIssueToHuly(
        hulyClient,
        projectPath,
        beadsIssue,
        hulyIssues,
        projectIdentifier,
        db,
        configWithParentMap,
        phase3UpdatedIssues
      );
      result.synced++;
      if (opDelay > 0) await delay(opDelay);
    } catch (error) {
      result.errors++;
      result.errorMessages.push(`${beadsIssue.id}: ${error.message}`);
    }
  }

  return result;
}

export async function fullBidirectionalSync(
  hulyClient,
  projectPath,
  hulyIssues,
  beadsIssues,
  projectIdentifier,
  db,
  config = {}
) {
  const results = {
    hulyToBeads: null,
    beadsToHuly: null,
    gitSync: false,
    timestamp: new Date().toISOString(),
  };

  console.log(`[Sync] Starting Huly → Beads sync for ${projectIdentifier}`);
  results.hulyToBeads = await batchSyncHulyToBeads(
    projectPath,
    hulyIssues,
    beadsIssues,
    db,
    config
  );

  console.log(`[Sync] Starting Beads → Huly sync for ${projectIdentifier}`);
  results.beadsToHuly = await batchSyncBeadsToHuly(
    hulyClient,
    projectPath,
    beadsIssues,
    hulyIssues,
    projectIdentifier,
    db,
    config
  );

  if (!config.sync?.dryRun) {
    console.log(`[Sync] Syncing ${projectIdentifier} to Git`);
    results.gitSync = await syncBeadsToGit(projectPath, { projectIdentifier });
  }

  return results;
}
