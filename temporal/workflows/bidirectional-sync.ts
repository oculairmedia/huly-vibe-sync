/**
 * Bidirectional Sync Workflows
 *
 * Full bidirectional sync between Huly, Vibe, and Beads.
 * "Most recent change wins" conflict resolution.
 *
 * When any system updates:
 * - Vibe updates → sync to Huly + Beads
 * - Beads updates → sync to Huly + Vibe
 * - Huly updates → sync to Vibe + Beads
 */

import { proxyActivities, log } from '@temporalio/workflow';
import type * as syncActivities from '../activities/bidirectional';

const {
  syncVibeToHuly,
  syncVibeToBeads,
  syncBeadsToHuly,
  syncBeadsToVibe,
  syncHulyToVibe,
  syncHulyToBeads,
  getVibeTask,
  getHulyIssue,
  getBeadsIssue,
  commitBeadsChanges,
} = proxyActivities<typeof syncActivities>({
  startToCloseTimeout: '60 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 5,
    nonRetryableErrorTypes: [
      'ValidationError',
      'NotFoundError',
      'ConflictError',
    ],
  },
});

// ============================================================
// TYPES
// ============================================================

export type SourceSystem = 'vibe' | 'huly' | 'beads';

export interface SyncContext {
  projectIdentifier: string;      // Huly project ID (e.g., "VIBESYNC")
  vibeProjectId: string;          // Vibe UUID
  gitRepoPath?: string;           // Git repo for Beads (optional)
}

export interface IssueData {
  id: string;                     // System-specific ID
  title: string;
  description?: string;
  status: string;
  priority?: string;
  modifiedAt: number;             // Unix timestamp for conflict resolution
}

export interface BidirectionalSyncInput {
  source: SourceSystem;
  issueData: IssueData;
  context: SyncContext;
  // Links to same issue in other systems (for updates)
  linkedIds?: {
    hulyId?: string;              // e.g., "VIBESYNC-123"
    vibeId?: string;              // UUID
    beadsId?: string;             // Beads issue ID
  };
}

export interface BidirectionalSyncResult {
  success: boolean;
  source: SourceSystem;
  results: {
    huly?: { success: boolean; id?: string; skipped?: boolean; error?: string };
    vibe?: { success: boolean; id?: string; skipped?: boolean; error?: string };
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

    // Sync to other systems based on source
    switch (source) {
      case 'vibe':
        result.results = await syncFromVibe(issueData, context, linkedIds);
        break;
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

    result.success = true;

    log.info(`[BidirectionalSync] Complete: ${source} → others`, {
      huly: result.results.huly?.success,
      vibe: result.results.vibe?.success,
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

async function syncFromVibe(
  issueData: IssueData,
  context: SyncContext,
  linkedIds?: BidirectionalSyncInput['linkedIds']
) {
  const results: BidirectionalSyncResult['results'] = {};

  // Vibe → Huly
  if (linkedIds?.hulyId) {
    results.huly = await syncVibeToHuly({
      vibeTask: issueData,
      hulyIdentifier: linkedIds.hulyId,
      context,
    });
  }

  // Vibe → Beads
  if (context.gitRepoPath) {
    results.beads = await syncVibeToBeads({
      vibeTask: issueData,
      existingBeadsId: linkedIds?.beadsId,
      context,
    });
  }

  return results;
}

async function syncFromHuly(
  issueData: IssueData,
  context: SyncContext,
  linkedIds?: BidirectionalSyncInput['linkedIds']
) {
  const results: BidirectionalSyncResult['results'] = {};

  // Huly → Vibe
  results.vibe = await syncHulyToVibe({
    hulyIssue: issueData,
    existingVibeId: linkedIds?.vibeId,
    context,
  });

  // Huly → Beads
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

  // Beads → Huly
  if (linkedIds?.hulyId) {
    results.huly = await syncBeadsToHuly({
      beadsIssue: issueData,
      hulyIdentifier: linkedIds.hulyId,
      context,
    });
  }

  // Beads → Vibe
  if (linkedIds?.vibeId) {
    results.vibe = await syncBeadsToVibe({
      beadsIssue: issueData,
      vibeTaskId: linkedIds.vibeId,
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

  const timestamps: { system: SourceSystem; timestamp: number }[] = [
    { system: source, timestamp: issueData.modifiedAt },
  ];

  // Get timestamps from other systems
  try {
    if (source !== 'huly' && linkedIds.hulyId) {
      const hulyIssue = await getHulyIssue({ identifier: linkedIds.hulyId });
      if (hulyIssue?.modifiedOn) {
        timestamps.push({ system: 'huly', timestamp: hulyIssue.modifiedOn });
      }
    }

    if (source !== 'vibe' && linkedIds.vibeId) {
      const vibeTask = await getVibeTask({ taskId: linkedIds.vibeId });
      if (vibeTask?.updated_at) {
        timestamps.push({
          system: 'vibe',
          timestamp: new Date(vibeTask.updated_at).getTime(),
        });
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
    // If we can't get timestamps, proceed with sync (source wins)
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

/**
 * SyncFromVibeWorkflow - Triggered when Vibe task changes
 */
export async function SyncFromVibeWorkflow(input: {
  vibeTaskId: string;
  context: SyncContext;
  linkedIds?: { hulyId?: string; beadsId?: string };
}): Promise<BidirectionalSyncResult> {
  const vibeTask = await getVibeTask({ taskId: input.vibeTaskId });

  if (!vibeTask) {
    throw new Error(`Vibe task not found: ${input.vibeTaskId}`);
  }

  return BidirectionalSyncWorkflow({
    source: 'vibe',
    issueData: {
      id: vibeTask.id,
      title: vibeTask.title,
      description: vibeTask.description,
      status: vibeTask.status,
      modifiedAt: vibeTask.updated_at
        ? new Date(vibeTask.updated_at).getTime()
        : Date.now(),
    },
    context: input.context,
    linkedIds: {
      vibeId: vibeTask.id,
      ...input.linkedIds,
    },
  });
}

/**
 * SyncFromHulyWorkflow - Triggered when Huly issue changes
 */
export async function SyncFromHulyWorkflow(input: {
  hulyIdentifier: string;
  context: SyncContext;
  linkedIds?: { vibeId?: string; beadsId?: string };
}): Promise<BidirectionalSyncResult> {
  const hulyIssue = await getHulyIssue({ identifier: input.hulyIdentifier });

  if (!hulyIssue) {
    throw new Error(`Huly issue not found: ${input.hulyIdentifier}`);
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
  linkedIds?: { hulyId?: string; vibeId?: string };
}): Promise<BidirectionalSyncResult> {
  if (!input.context.gitRepoPath) {
    throw new Error('gitRepoPath required for Beads sync');
  }

  const beadsIssue = await getBeadsIssue({
    issueId: input.beadsIssueId,
    gitRepoPath: input.context.gitRepoPath,
  });

  if (!beadsIssue) {
    throw new Error(`Beads issue not found: ${input.beadsIssueId}`);
  }

  return BidirectionalSyncWorkflow({
    source: 'beads',
    issueData: {
      id: beadsIssue.id,
      title: beadsIssue.title,
      description: beadsIssue.description,
      status: beadsIssue.status,
      priority: beadsIssue.priority?.toString(),
      modifiedAt: beadsIssue.updated_at
        ? new Date(beadsIssue.updated_at).getTime()
        : Date.now(),
    },
    context: input.context,
    linkedIds: {
      beadsId: beadsIssue.id,
      ...input.linkedIds,
    },
  });
}
