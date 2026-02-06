/**
 * Memory Update Client Functions
 *
 * Schedule and manage Letta memory update workflows.
 */

import type {
  MemoryUpdateInput,
  MemoryUpdateResult,
  BatchMemoryUpdateInput,
  BatchMemoryUpdateResult,
} from '../workflows/memory-update';

import { getClient, TASK_QUEUE } from './connection';

/**
 * Schedule a single memory update workflow
 *
 * Returns immediately after scheduling. The workflow runs
 * in the background with automatic retry.
 */
export async function scheduleMemoryUpdate(
  input: MemoryUpdateInput
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `memory-update-${input.agentId}-${input.blockLabel}-${Date.now()}`;

  const handle = await client.workflow.start('MemoryUpdateWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`[Temporal] Scheduled memory update: ${workflowId}`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Schedule a batch memory update workflow
 *
 * All updates run in parallel with independent retry.
 */
export async function scheduleBatchMemoryUpdate(
  updates: MemoryUpdateInput[],
  source?: string
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `batch-memory-update-${Date.now()}`;

  const input: BatchMemoryUpdateInput = {
    updates,
    source: source || 'vibesync-batch',
  };

  const handle = await client.workflow.start('BatchMemoryUpdateWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(
    `[Temporal] Scheduled batch memory update: ${workflowId} (${updates.length} updates)`
  );

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Execute a memory update and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 * Use for synchronous flows where you need the result.
 */
export async function executeMemoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateResult> {
  const client = await getClient();

  const workflowId = `memory-update-${input.agentId}-${input.blockLabel}-${Date.now()}`;

  const result = await client.workflow.execute('MemoryUpdateWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  return result;
}

/**
 * Get the status of a running workflow
 */
export async function getWorkflowStatus(workflowId: string): Promise<{
  status: string;
  attempts?: number;
  lastError?: string;
}> {
  const client = await getClient();

  const handle = client.workflow.getHandle(workflowId);
  const description = await handle.describe();

  // Try to query the workflow for detailed status
  try {
    const queryResult = await handle.query<{ attempts: number; lastError?: string }>('status');
    return {
      status: description.status.name,
      ...queryResult,
    };
  } catch {
    // Query not supported or workflow completed
    return {
      status: description.status.name,
    };
  }
}

/**
 * Cancel a running workflow
 */
export async function cancelWorkflow(workflowId: string): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal('cancel');
}

/**
 * List recent memory update workflows
 */
export async function listRecentWorkflows(limit = 20): Promise<
  Array<{
    workflowId: string;
    status: string;
    startTime: Date;
  }>
> {
  const client = await getClient();

  const workflows: Array<{
    workflowId: string;
    status: string;
    startTime: Date;
  }> = [];

  // Query workflows with type filter
  for await (const workflow of client.workflow.list({
    query: `WorkflowType = 'MemoryUpdateWorkflow' OR WorkflowType = 'BatchMemoryUpdateWorkflow'`,
  })) {
    workflows.push({
      workflowId: workflow.workflowId,
      status: workflow.status.name,
      startTime: workflow.startTime,
    });

    if (workflows.length >= limit) break;
  }

  return workflows;
}

/**
 * Get failed workflows that need attention
 */
export async function getFailedWorkflows(): Promise<
  Array<{
    workflowId: string;
    startTime: Date;
    closeTime?: Date;
  }>
> {
  const client = await getClient();

  const failed: Array<{
    workflowId: string;
    startTime: Date;
    closeTime?: Date;
  }> = [];

  for await (const workflow of client.workflow.list({
    query: `ExecutionStatus = 'Failed' AND (WorkflowType = 'MemoryUpdateWorkflow' OR WorkflowType = 'BatchMemoryUpdateWorkflow')`,
  })) {
    failed.push({
      workflowId: workflow.workflowId,
      startTime: workflow.startTime,
      closeTime: workflow.closeTime,
    });
  }

  return failed;
}
