/**
 * Data Reconciliation Workflows
 *
 * Runs periodic reconciliation to detect stale sync records.
 */

import { proxyActivities, log, sleep, executeChild } from '@temporalio/workflow';
import type * as reconciliationActivities from '../activities/reconciliation';

const { reconcileSyncData } = proxyActivities<typeof reconciliationActivities>({
  startToCloseTimeout: '120 seconds',
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 3,
  },
});

export type ReconciliationAction = 'mark_deleted' | 'hard_delete';

export interface DataReconciliationInput {
  projectIdentifier?: string;
  action?: ReconciliationAction;
  dryRun?: boolean;
}

export interface DataReconciliationResult {
  success: boolean;
  action: ReconciliationAction;
  dryRun: boolean;
  projectsProcessed: number;
  projectsWithVibeChecked: number;
  projectsWithBeadsChecked: number;
  staleVibe: Array<{ identifier: string; projectIdentifier: string; vibeTaskId: string }>;
  staleBeads: Array<{ identifier: string; projectIdentifier: string; beadsIssueId: string }>;
  updated: { markedVibe: number; markedBeads: number; deleted: number };
  errors: string[];
}

/**
 * DataReconciliationWorkflow
 */
export async function DataReconciliationWorkflow(
  input: DataReconciliationInput = {}
): Promise<DataReconciliationResult> {
  log.info('[Reconcile] Starting data reconciliation', { input });
  const result = await reconcileSyncData(input);
  log.info('[Reconcile] Completed data reconciliation', {
    success: result.success,
    staleVibe: result.staleVibe.length,
    staleBeads: result.staleBeads.length,
    action: result.action,
    dryRun: result.dryRun,
  });
  return result;
}

/**
 * ScheduledReconciliationWorkflow
 */
export async function ScheduledReconciliationWorkflow(input: {
  intervalMinutes: number;
  maxIterations?: number;
  reconcileOptions?: DataReconciliationInput;
}): Promise<void> {
  const { intervalMinutes, maxIterations = Infinity, reconcileOptions = {} } = input;

  let iteration = 0;
  log.info('[ScheduledReconcile] Starting scheduled reconciliation', {
    intervalMinutes,
    maxIterations,
  });

  while (iteration < maxIterations) {
    iteration++;
    log.info(`[ScheduledReconcile] Running iteration ${iteration}`);

    try {
      await executeChild(DataReconciliationWorkflow, {
        workflowId: `reconcile-scheduled-${Date.now()}`,
        args: [reconcileOptions],
      });
    } catch (error) {
      log.error('[ScheduledReconcile] Reconciliation iteration failed', {
        iteration,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    log.info(`[ScheduledReconcile] Sleeping for ${intervalMinutes} minutes`);
    await sleep(`${intervalMinutes} minutes`);
  }

  log.info('[ScheduledReconcile] Completed all iterations');
}
