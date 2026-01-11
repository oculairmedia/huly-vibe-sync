/**
 * Temporal Client for VibeSync
 *
 * Helper functions to trigger and monitor Temporal workflows
 * from VibeSync's existing code.
 *
 * Usage:
 *   import { scheduleMemoryUpdate, scheduleBatchMemoryUpdate } from './temporal/client';
 *
 *   // Single update
 *   await scheduleMemoryUpdate({
 *     agentId: 'agent-xxx',
 *     blockLabel: 'board_metrics',
 *     newValue: '{"issues": 10}',
 *     source: 'vibesync-sync',
 *   });
 *
 *   // Batch update
 *   await scheduleBatchMemoryUpdate([
 *     { agentId: 'agent-1', blockLabel: 'board_metrics', newValue: '...' },
 *     { agentId: 'agent-2', blockLabel: 'board_metrics', newValue: '...' },
 *   ]);
 */

import { Client, Connection } from '@temporalio/client';
import type {
  MemoryUpdateInput,
  MemoryUpdateResult,
  BatchMemoryUpdateInput,
  BatchMemoryUpdateResult,
} from './workflows/memory-update';

import type {
  IssueSyncInput,
  IssueSyncResult,
} from './workflows/issue-sync';

import type {
  SyncIssueInput,
  SyncIssueResult,
} from './workflows/full-sync';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'vibesync-queue';

let clientInstance: Client | null = null;

/**
 * Get or create the Temporal client instance
 */
async function getClient(): Promise<Client> {
  if (!clientInstance) {
    const connection = await Connection.connect({
      address: TEMPORAL_ADDRESS,
    });
    clientInstance = new Client({ connection });
  }
  return clientInstance;
}

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

  console.log(`[Temporal] Scheduled batch memory update: ${workflowId} (${updates.length} updates)`);

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
export async function executeMemoryUpdate(
  input: MemoryUpdateInput
): Promise<MemoryUpdateResult> {
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

// ============================================================================
// Issue Sync Workflows
// ============================================================================

/**
 * Schedule an issue sync workflow (fire-and-forget)
 *
 * Syncs an issue across Huly, VibeKanban, and Beads atomically.
 * Returns immediately; workflow runs in background with retry.
 */
export async function scheduleIssueSync(
  input: IssueSyncInput
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const identifier = input.issue.identifier || input.issue.title.substring(0, 20);
  const workflowId = `issue-sync-${input.operation}-${identifier}-${Date.now()}`;

  const handle = await client.workflow.start('IssueSyncWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`[Temporal] Scheduled issue sync: ${workflowId}`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Execute an issue sync and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 * Use when you need to know if sync succeeded before continuing.
 */
export async function executeIssueSync(
  input: IssueSyncInput
): Promise<IssueSyncResult> {
  const client = await getClient();

  const identifier = input.issue.identifier || input.issue.title.substring(0, 20);
  const workflowId = `issue-sync-${input.operation}-${identifier}-${Date.now()}`;

  const result = await client.workflow.execute('IssueSyncWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  return result;
}

/**
 * Schedule a batch issue sync workflow
 *
 * Syncs multiple issues in parallel with controlled concurrency.
 * Useful for full project syncs.
 */
export async function scheduleBatchIssueSync(
  issues: IssueSyncInput[],
  maxParallel = 5
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `batch-issue-sync-${Date.now()}`;

  const handle = await client.workflow.start('BatchIssueSyncWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [{ issues, maxParallel }],
  });

  console.log(`[Temporal] Scheduled batch issue sync: ${workflowId} (${issues.length} issues)`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Check if Temporal is enabled via feature flag
 */
export function isTemporalEnabled(): boolean {
  return process.env.USE_TEMPORAL_SYNC === 'true';
}

/**
 * Check if Temporal is available (can connect)
 */
export async function isTemporalAvailable(): Promise<boolean> {
  try {
    await getClient();
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Full Sync Workflows (using existing services)
// ============================================================================

/**
 * Schedule a single issue sync using existing services
 *
 * This is the recommended way to sync issues - it uses the battle-tested
 * service implementations wrapped in Temporal for durability.
 */
export async function scheduleSingleIssueSync(
  input: SyncIssueInput
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `sync-issue-${input.issue.identifier}-${Date.now()}`;

  const handle = await client.workflow.start('SyncSingleIssueWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`[Temporal] Scheduled issue sync: ${workflowId}`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Execute a single issue sync and wait for result
 */
export async function executeSingleIssueSync(
  input: SyncIssueInput
): Promise<SyncIssueResult> {
  const client = await getClient();

  const workflowId = `sync-issue-${input.issue.identifier}-${Date.now()}`;

  return await client.workflow.execute('SyncSingleIssueWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });
}

/**
 * Schedule a full project sync
 */
export async function scheduleProjectSync(input: {
  issues: SyncIssueInput[];
  context: {
    projectIdentifier: string;
    vibeProjectId: string;
    gitRepoPath?: string;
  };
  batchSize?: number;
}): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `sync-project-${input.context.projectIdentifier}-${Date.now()}`;

  const handle = await client.workflow.start('SyncProjectWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`[Temporal] Scheduled project sync: ${workflowId} (${input.issues.length} issues)`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Schedule Vibe→Huly sync (Phase 2)
 */
export async function scheduleVibeToHulySync(input: {
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
}): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `sync-vibe-huly-${input.hulyIdentifier}-${Date.now()}`;

  const handle = await client.workflow.start('SyncVibeToHulyWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}
