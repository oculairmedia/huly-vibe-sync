/**
 * Reconciliation Client Functions
 *
 * Schedule and manage data reconciliation workflows.
 */

import { getClient, TASK_QUEUE } from './connection';

// ============================================================
// TYPES
// ============================================================

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

export async function executeDataReconciliation(
  input: DataReconciliationInput = {}
): Promise<DataReconciliationResult> {
  const client = await getClient();

  const workflowId = `reconcile-${Date.now()}`;

  return await client.workflow.execute('DataReconciliationWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });
}

export async function startScheduledReconciliation(input: {
  intervalMinutes: number;
  maxIterations?: number;
  reconcileOptions?: DataReconciliationInput;
}): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `scheduled-reconcile-${Date.now()}`;

  const handle = await client.workflow.start('ScheduledReconciliationWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(
    `[Temporal] Started scheduled reconciliation: ${workflowId} (every ${input.intervalMinutes} minutes)`
  );

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

export async function getActiveScheduledReconciliation(): Promise<{
  workflowId: string;
  status: string;
  startTime: Date;
  intervalMinutes?: number;
} | null> {
  const client = await getClient();

  for await (const workflow of client.workflow.list({
    query: `WorkflowType = 'ScheduledReconciliationWorkflow' AND ExecutionStatus = 'Running'`,
  })) {
    return {
      workflowId: workflow.workflowId,
      status: workflow.status.name,
      startTime: workflow.startTime,
    };
  }

  return null;
}

export async function stopScheduledReconciliation(workflowId?: string): Promise<boolean> {
  const client = await getClient();

  let targetWorkflowId = workflowId;
  if (!targetWorkflowId) {
    const active = await getActiveScheduledReconciliation();
    if (!active) {
      console.log('[Temporal] No active scheduled reconciliation to stop');
      return false;
    }
    targetWorkflowId = active.workflowId;
  }

  try {
    const handle = client.workflow.getHandle(targetWorkflowId);
    await handle.cancel();
    console.log(`[Temporal] Stopped scheduled reconciliation: ${targetWorkflowId}`);
    return true;
  } catch (error) {
    console.error(`[Temporal] Failed to stop scheduled reconciliation: ${error}`);
    return false;
  }
}
