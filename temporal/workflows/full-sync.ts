/**
 * Full Sync Workflows
 *
 * These workflows orchestrate the complete sync process
 * using the existing service implementations wrapped as activities.
 */

import { proxyActivities, log } from '@temporalio/workflow';
import type * as syncActivities from '../activities/sync-services';

// Proxy activities with appropriate retry policies
const {
  syncIssueToVibe,
  syncTaskToHuly,
  syncIssueToBeads,
  syncBeadsToHuly,
  commitBeadsToGit,
} = proxyActivities<typeof syncActivities>({
  startToCloseTimeout: '60 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 5,
    nonRetryableErrorTypes: [
      'HulyValidationError',
      'VibeValidationError',
      'BeadsValidationError',
    ],
  },
});

// Types
export interface SyncIssueInput {
  issue: {
    identifier: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    modifiedOn?: number;
  };
  context: {
    projectIdentifier: string;
    vibeProjectId: string;
    gitRepoPath?: string;
  };
  existingVibeTaskId?: string;
  existingBeadsIssues?: Array<{ id: string; title: string; status: string }>;
  syncToVibe?: boolean;
  syncToBeads?: boolean;
}

export interface SyncIssueResult {
  success: boolean;
  vibeResult?: { success: boolean; id?: string; skipped?: boolean; error?: string };
  beadsResult?: { success: boolean; id?: string; skipped?: boolean; error?: string };
  error?: string;
}

/**
 * SyncSingleIssueWorkflow
 *
 * Syncs a single Huly issue to Vibe and Beads atomically.
 * Use this for real-time sync on issue changes.
 */
export async function SyncSingleIssueWorkflow(input: SyncIssueInput): Promise<SyncIssueResult> {
  const { issue, context, existingVibeTaskId, existingBeadsIssues = [] } = input;
  const syncToVibe = input.syncToVibe !== false;
  const syncToBeads = input.syncToBeads !== false;

  log.info(`[SyncSingleIssue] Starting: ${issue.identifier}`, {
    project: context.projectIdentifier,
    toVibe: syncToVibe,
    toBeads: syncToBeads,
  });

  const result: SyncIssueResult = { success: false };

  try {
    // Step 1: Sync to Vibe
    if (syncToVibe) {
      const operation = existingVibeTaskId ? 'update' : 'create';
      result.vibeResult = await syncIssueToVibe({
        issue,
        context,
        existingTaskId: existingVibeTaskId,
        operation,
      });

      if (!result.vibeResult.success) {
        throw new Error(`Vibe sync failed: ${result.vibeResult.error}`);
      }
    }

    // Step 2: Sync to Beads (if git repo exists)
    if (syncToBeads && context.gitRepoPath) {
      result.beadsResult = await syncIssueToBeads({
        issue,
        context,
        existingBeadsIssues,
      });
      // Beads failures are non-fatal, don't throw
    }

    result.success = true;

    log.info(`[SyncSingleIssue] Complete: ${issue.identifier}`, {
      vibe: result.vibeResult?.success,
      beads: result.beadsResult?.success,
    });

    return result;

  } catch (error) {
    result.success = false;
    result.error = error instanceof Error ? error.message : String(error);

    log.error(`[SyncSingleIssue] Failed: ${issue.identifier}`, {
      error: result.error,
    });

    throw error;
  }
}

/**
 * SyncProjectWorkflow
 *
 * Syncs an entire project's issues in parallel batches.
 * Use this for initial sync or full reconciliation.
 */
export async function SyncProjectWorkflow(input: {
  issues: SyncIssueInput[];
  context: {
    projectIdentifier: string;
    vibeProjectId: string;
    gitRepoPath?: string;
  };
  batchSize?: number;
  commitAfterSync?: boolean;
}): Promise<{
  success: boolean;
  total: number;
  synced: number;
  failed: number;
  results: SyncIssueResult[];
}> {
  const { issues, context, batchSize = 5, commitAfterSync = true } = input;

  log.info(`[SyncProject] Starting: ${context.projectIdentifier}`, {
    issueCount: issues.length,
    batchSize,
  });

  const results: SyncIssueResult[] = [];
  let synced = 0;
  let failed = 0;

  // Process issues in batches
  for (let i = 0; i < issues.length; i += batchSize) {
    const batch = issues.slice(i, i + batchSize);

    log.info(`[SyncProject] Processing batch ${Math.floor(i / batchSize) + 1}`, {
      batchSize: batch.length,
    });

    // Process batch in parallel
    const batchPromises = batch.map(issueInput =>
      SyncSingleIssueWorkflow({
        ...issueInput,
        context,
      }).catch(error => ({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    );

    const batchResults = await Promise.all(batchPromises);

    for (const result of batchResults) {
      results.push(result);
      if (result.success) {
        synced++;
      } else {
        failed++;
      }
    }
  }

  // Commit Beads changes to git
  if (commitAfterSync && context.gitRepoPath) {
    log.info(`[SyncProject] Committing Beads changes`);
    await commitBeadsToGit({
      context,
      message: `Sync ${synced} issues from VibeSync`,
    });
  }

  log.info(`[SyncProject] Complete: ${context.projectIdentifier}`, {
    synced,
    failed,
    total: issues.length,
  });

  return {
    success: failed === 0,
    total: issues.length,
    synced,
    failed,
    results,
  };
}

/**
 * SyncVibeToHulyWorkflow
 *
 * Syncs Vibe task changes back to Huly (Phase 2).
 */
export async function SyncVibeToHulyWorkflow(input: {
  task: {
    id: string;
    title: string;
    description?: string;
    status: string;
    updated_at?: string;
  };
  hulyIdentifier: string;
  context: {
    projectIdentifier: string;
    vibeProjectId: string;
  };
}): Promise<{ success: boolean; error?: string }> {
  const { task, hulyIdentifier, context } = input;

  log.info(`[SyncVibeToHuly] Starting: ${task.id} → ${hulyIdentifier}`);

  try {
    const result = await syncTaskToHuly({
      task,
      hulyIdentifier,
      context,
    });

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    log.info(`[SyncVibeToHuly] Complete: ${hulyIdentifier}`);
    return { success: true };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`[SyncVibeToHuly] Failed: ${hulyIdentifier}`, { error: errorMsg });
    throw error;
  }
}
