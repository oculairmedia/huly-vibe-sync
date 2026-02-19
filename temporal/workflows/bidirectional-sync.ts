/**
 * Bidirectional Sync Workflows
 *
 * Bidirectional sync between Huly and Beads.
 * "Most recent change wins" conflict resolution.
 */

import { proxyActivities, log, ApplicationFailure } from '@temporalio/workflow';
import type * as syncActivities from '../activities/bidirectional';
import type * as syncDatabaseActivities from '../activities/sync-database';

const { syncBeadsToHuly, syncHulyToBeads, getHulyIssue, getBeadsIssue, commitBeadsChanges } =
  proxyActivities<typeof syncActivities>({
    startToCloseTimeout: '120 seconds',
    retry: {
      initialInterval: '2 seconds',
      backoffCoefficient: 2,
      maximumInterval: '60 seconds',
      maximumAttempts: 5,
      nonRetryableErrorTypes: ['ValidationError', 'NotFoundError', 'ConflictError'],
    },
  });

const { persistIssueSyncState, getIssueSyncTimestamps } = proxyActivities<
  typeof syncDatabaseActivities
>({
  startToCloseTimeout: '60 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '20 seconds',
    maximumAttempts: 3,
  },
});

// ============================================================
// TYPES
// ============================================================

export type SourceSystem = 'huly' | 'beads';

export interface SyncContext {
  projectIdentifier: string;
  gitRepoPath?: string;
}

export interface IssueData {
  id: string; // System-specific ID
  title: string;
  description?: string;
  status: string;
  priority?: string;
  modifiedAt: number; // Unix timestamp for conflict resolution
}

export interface BidirectionalSyncInput {
  source: SourceSystem;
  issueData: IssueData;
  context: SyncContext;
  // Links to same issue in other systems (for updates)
  linkedIds?: {
    hulyId?: string;
    beadsId?: string;
  };
}

export interface BidirectionalSyncResult {
  success: boolean;
  source: SourceSystem;
  results: {
    huly?: { success: boolean; id?: string; skipped?: boolean; error?: string };
    beads?: { success: boolean; id?: string; skipped?: boolean; error?: string };
  };
  conflictResolution?: {
    winner: SourceSystem;
    winnerTimestamp: number;
    loserTimestamp?: number;
  };
  error?: string;
}

// ============================================================
// MAIN BIDIRECTIONAL SYNC WORKFLOW
// ============================================================

/**
 * BidirectionalSyncWorkflow
 *
 * Syncs changes from one system to the other two.
 * Uses "most recent wins" for conflict resolution.
 */
export async function BidirectionalSyncWorkflow(
  input: BidirectionalSyncInput
): Promise<BidirectionalSyncResult> {
  const { source, issueData, context, linkedIds } = input;

  log.info(`[BidirectionalSync] Starting: ${source} → others`, {
    issueId: issueData.id,
    title: issueData.title,
    modifiedAt: issueData.modifiedAt,
  });

  const result: BidirectionalSyncResult = {
    success: false,
    source,
    results: {},
  };

  try {
    // Check for conflicts with linked issues
    const conflictCheck = await checkForConflicts(source, issueData, linkedIds, context);

    if (conflictCheck.hasConflict && !conflictCheck.sourceWins) {
      // Another system has a more recent change - skip this sync
      log.info(`[BidirectionalSync] Skipping - ${conflictCheck.winner} has newer data`, {
        sourceTimestamp: issueData.modifiedAt,
        winnerTimestamp: conflictCheck.winnerTimestamp,
      });

      result.success = true;
      result.conflictResolution = {
        winner: conflictCheck.winner!,
        winnerTimestamp: conflictCheck.winnerTimestamp!,
        loserTimestamp: issueData.modifiedAt,
      };
      return result;
    }

    // Sync to other system based on source
    switch (source) {
      case 'huly':
        result.results = await syncFromHuly(issueData, context, linkedIds);
        break;
      case 'beads':
        result.results = await syncFromBeads(issueData, context, linkedIds);
        break;
    }

    // Commit Beads changes if we synced to Beads
    if (result.results.beads?.success && context.gitRepoPath) {
      await commitBeadsChanges({
        gitRepoPath: context.gitRepoPath,
        message: `Sync from ${source}: ${issueData.title}`,
      });
    }

    let persistenceIdentifier: string | null = null;
    if (source === 'huly') {
      persistenceIdentifier = issueData.id;
    } else if (source === 'beads') {
      persistenceIdentifier = linkedIds?.hulyId || result.results.huly?.id || null;
    }

    if (persistenceIdentifier) {
      await persistIssueSyncState({
        identifier: persistenceIdentifier,
        projectIdentifier: context.projectIdentifier,
        title: issueData.title,
        description: issueData.description,
        status: issueData.status,
        hulyId: source === 'huly' ? issueData.id : undefined,
        beadsIssueId:
          source === 'beads' ? issueData.id : result.results.beads?.id || linkedIds?.beadsId,
        hulyModifiedAt: source === 'huly' ? issueData.modifiedAt : undefined,
        beadsModifiedAt: source === 'beads' ? issueData.modifiedAt : undefined,
        beadsStatus: source === 'beads' ? issueData.status : undefined,
      });
    }

    result.success = true;

    log.info(`[BidirectionalSync] Complete: ${source} → others`, {
      huly: result.results.huly?.success,
      beads: result.results.beads?.success,
    });

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    log.error(`[BidirectionalSync] Failed`, { error: result.error });
    throw error;
  }
}

// ============================================================
// SYNC FROM EACH SOURCE
// ============================================================

async function syncFromHuly(
  issueData: IssueData,
  context: SyncContext,
  linkedIds?: BidirectionalSyncInput['linkedIds']
) {
  const results: BidirectionalSyncResult['results'] = {};

  if (context.gitRepoPath) {
    results.beads = await syncHulyToBeads({
      hulyIssue: issueData,
      existingBeadsId: linkedIds?.beadsId,
      context,
    });
  }

  return results;
}

async function syncFromBeads(
  issueData: IssueData,
  context: SyncContext,
  linkedIds?: BidirectionalSyncInput['linkedIds']
) {
  const results: BidirectionalSyncResult['results'] = {};

  if (linkedIds?.hulyId) {
    results.huly = await syncBeadsToHuly({
      beadsIssue: issueData,
      hulyIdentifier: linkedIds.hulyId,
      context,
    });
  }

  return results;
}

// ============================================================
// CONFLICT RESOLUTION
// ============================================================

interface ConflictCheckResult {
  hasConflict: boolean;
  sourceWins: boolean;
  winner?: SourceSystem;
  winnerTimestamp?: number;
}

async function checkForConflicts(
  source: SourceSystem,
  issueData: IssueData,
  linkedIds: BidirectionalSyncInput['linkedIds'] | undefined,
  context: SyncContext
): Promise<ConflictCheckResult> {
  if (!linkedIds) {
    return { hasConflict: false, sourceWins: true };
  }

  const hasComparableTargets =
    (source !== 'huly' && !!linkedIds.hulyId) ||
    (source !== 'beads' && !!linkedIds.beadsId && !!context.gitRepoPath);

  // Fast-path: if no comparable linked target exists, avoid extra reads.
  if (!hasComparableTargets) {
    return { hasConflict: false, sourceWins: true };
  }

  // DB fast-path: use stored timestamps to avoid API calls when source clearly wins.
  // Stored timestamps are refreshed every sync cycle (~10s), so staleness risk is low.
  const issueId = linkedIds.hulyId || issueData.id;
  try {
    const dbTimestamps = await getIssueSyncTimestamps({ identifier: issueId });
    if (dbTimestamps) {
      const otherTimestamps: { system: SourceSystem; timestamp: number }[] = [];
      if (source !== 'huly' && dbTimestamps.huly_modified_at) {
        otherTimestamps.push({ system: 'huly', timestamp: dbTimestamps.huly_modified_at });
      }
      if (source !== 'beads' && dbTimestamps.beads_modified_at) {
        otherTimestamps.push({ system: 'beads', timestamp: dbTimestamps.beads_modified_at });
      }

      if (otherTimestamps.length > 0) {
        otherTimestamps.sort((a, b) => b.timestamp - a.timestamp);
        const newest = otherTimestamps[0];

        if (issueData.modifiedAt - newest.timestamp > 1000) {
          log.info(
            `[ConflictCheck] DB fast-path: source wins (${source} ahead by ${issueData.modifiedAt - newest.timestamp}ms)`
          );
          return { hasConflict: false, sourceWins: true };
        }
      }
    }
  } catch {
    // DB read failed, fall through to API check
  }

  const timestamps: { system: SourceSystem; timestamp: number }[] = [
    { system: source, timestamp: issueData.modifiedAt },
  ];

  try {
    if (source !== 'huly' && linkedIds.hulyId) {
      const hulyIssue = await getHulyIssue({ identifier: linkedIds.hulyId });
      if (hulyIssue?.modifiedOn) {
        timestamps.push({ system: 'huly', timestamp: hulyIssue.modifiedOn });
      }
    }

    if (source !== 'beads' && linkedIds.beadsId && context.gitRepoPath) {
      const beadsIssue = await getBeadsIssue({
        issueId: linkedIds.beadsId,
        gitRepoPath: context.gitRepoPath,
      });
      if (beadsIssue?.updated_at) {
        timestamps.push({
          system: 'beads',
          timestamp: new Date(beadsIssue.updated_at).getTime(),
        });
      }
    }
  } catch (error) {
    log.warn(`[ConflictCheck] Error getting timestamps, proceeding with sync`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return { hasConflict: false, sourceWins: true };
  }

  // Find the most recent change
  timestamps.sort((a, b) => b.timestamp - a.timestamp);
  const winner = timestamps[0];

  if (winner.system === source) {
    return { hasConflict: false, sourceWins: true };
  }

  // Check if difference is significant (> 1 second to avoid race conditions)
  const timeDiff = winner.timestamp - issueData.modifiedAt;
  if (timeDiff > 1000) {
    return {
      hasConflict: true,
      sourceWins: false,
      winner: winner.system,
      winnerTimestamp: winner.timestamp,
    };
  }

  // Close timestamps - source wins (first come, first served)
  return { hasConflict: false, sourceWins: true };
}

// ============================================================
// CONVENIENCE WORKFLOWS
// ============================================================

export async function SyncFromHulyWorkflow(input: {
  hulyIdentifier: string;
  context: SyncContext;
  linkedIds?: { beadsId?: string };
}): Promise<BidirectionalSyncResult> {
  const hulyIssue = await getHulyIssue({ identifier: input.hulyIdentifier });

  if (!hulyIssue) {
    throw ApplicationFailure.nonRetryable(
      `Huly issue not found: ${input.hulyIdentifier}`,
      'NotFoundError'
    );
  }

  return BidirectionalSyncWorkflow({
    source: 'huly',
    issueData: {
      id: hulyIssue.identifier,
      title: hulyIssue.title,
      description: hulyIssue.description,
      status: hulyIssue.status,
      priority: hulyIssue.priority,
      modifiedAt: hulyIssue.modifiedOn || Date.now(),
    },
    context: input.context,
    linkedIds: {
      hulyId: hulyIssue.identifier,
      ...input.linkedIds,
    },
  });
}

/**
 * SyncFromBeadsWorkflow - Triggered when Beads issue changes
 */
export async function SyncFromBeadsWorkflow(input: {
  beadsIssueId: string;
  context: SyncContext;
  linkedIds?: { hulyId?: string };
}): Promise<BidirectionalSyncResult> {
  if (!input.context.gitRepoPath) {
    throw ApplicationFailure.nonRetryable('gitRepoPath required for Beads sync', 'ValidationError');
  }

  const beadsIssue = await getBeadsIssue({
    issueId: input.beadsIssueId,
    gitRepoPath: input.context.gitRepoPath,
  });

  if (!beadsIssue) {
    throw ApplicationFailure.nonRetryable(
      `Beads issue not found: ${input.beadsIssueId}`,
      'NotFoundError'
    );
  }

  return BidirectionalSyncWorkflow({
    source: 'beads',
    issueData: {
      id: beadsIssue.id,
      title: beadsIssue.title,
      description: beadsIssue.description,
      status: beadsIssue.status,
      priority: beadsIssue.priority?.toString(),
      modifiedAt: beadsIssue.updated_at ? new Date(beadsIssue.updated_at).getTime() : Date.now(),
    },
    context: input.context,
    linkedIds: {
      beadsId: beadsIssue.id,
      ...input.linkedIds,
    },
  });
}

// ============================================================
// RE-EXPORTS FROM EVENT-SYNC MODULE
// ============================================================

export { BeadsFileChangeWorkflow, HulyWebhookChangeWorkflow } from './event-sync';

export type {
  BeadsFileChangeInput,
  BeadsFileChangeResult,
  HulyWebhookChangeInput,
  HulyWebhookChangeResult,
} from './event-sync';
