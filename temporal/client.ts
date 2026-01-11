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

import type {
  FullSyncInput,
  FullSyncResult,
  SyncProgress,
} from './workflows/orchestration';

import type {
  SyncContext,
  BidirectionalSyncResult,
  BeadsFileChangeInput,
  BeadsFileChangeResult,
  VibeSSEChangeInput,
  VibeSSEChangeResult,
  HulyWebhookChangeInput,
  HulyWebhookChangeResult,
} from './workflows/bidirectional-sync';

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

// ============================================================================
// Full Orchestration Workflows (replaces SyncOrchestrator)
// ============================================================================

/**
 * Schedule a full orchestration sync (fire-and-forget)
 *
 * This replaces the legacy SyncOrchestrator.syncHulyToVibe() function.
 * Runs as a durable Temporal workflow with automatic retry.
 */
export async function scheduleFullSync(
  input: FullSyncInput = {}
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = input.projectIdentifier
    ? `full-sync-${input.projectIdentifier}-${Date.now()}`
    : `full-sync-all-${Date.now()}`;

  const handle = await client.workflow.start('FullOrchestrationWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`[Temporal] Scheduled full sync: ${workflowId}`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Execute a full sync and wait for result
 *
 * Blocks until the workflow completes.
 */
export async function executeFullSync(input: FullSyncInput = {}): Promise<FullSyncResult> {
  const client = await getClient();

  const workflowId = input.projectIdentifier
    ? `full-sync-${input.projectIdentifier}-${Date.now()}`
    : `full-sync-all-${Date.now()}`;

  return await client.workflow.execute('FullOrchestrationWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });
}

/**
 * Get progress of a running full sync workflow
 */
export async function getFullSyncProgress(workflowId: string): Promise<SyncProgress | null> {
  try {
    const client = await getClient();
    const handle = client.workflow.getHandle(workflowId);
    return await handle.query<SyncProgress>('progress');
  } catch {
    return null;
  }
}

/**
 * Cancel a running full sync workflow
 */
export async function cancelFullSync(workflowId: string): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal('cancel');
}

/**
 * Start a scheduled sync workflow
 *
 * This replaces setInterval-based scheduling with a durable workflow.
 * The workflow runs forever (or until maxIterations), executing syncs at intervals.
 */
export async function startScheduledSync(input: {
  intervalMinutes: number;
  maxIterations?: number;
  syncOptions?: FullSyncInput;
}): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `scheduled-sync-${Date.now()}`;

  const handle = await client.workflow.start('ScheduledSyncWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(
    `[Temporal] Started scheduled sync: ${workflowId} (every ${input.intervalMinutes} minutes)`
  );

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * List running sync workflows
 */
export async function listSyncWorkflows(
  limit = 20
): Promise<
  Array<{
    workflowId: string;
    status: string;
    startTime: Date;
    type: string;
  }>
> {
  const client = await getClient();

  const workflows: Array<{
    workflowId: string;
    status: string;
    startTime: Date;
    type: string;
  }> = [];

  for await (const workflow of client.workflow.list({
    query: `WorkflowType = 'FullOrchestrationWorkflow' OR WorkflowType = 'ScheduledSyncWorkflow'`,
  })) {
    workflows.push({
      workflowId: workflow.workflowId,
      status: workflow.status.name,
      startTime: workflow.startTime,
      type: String(workflow.type) || 'unknown',
    });

    if (workflows.length >= limit) break;
  }

  return workflows;
}

// ============================================================================
// Schedule Management
// ============================================================================

/**
 * Get active scheduled sync workflow
 *
 * Returns the currently running scheduled sync workflow if any.
 */
export async function getActiveScheduledSync(): Promise<{
  workflowId: string;
  status: string;
  startTime: Date;
  intervalMinutes?: number;
} | null> {
  const client = await getClient();

  for await (const workflow of client.workflow.list({
    query: `WorkflowType = 'ScheduledSyncWorkflow' AND ExecutionStatus = 'Running'`,
  })) {
    return {
      workflowId: workflow.workflowId,
      status: workflow.status.name,
      startTime: workflow.startTime,
    };
  }

  return null;
}

/**
 * Stop a running scheduled sync workflow
 *
 * Sends a cancel signal to gracefully stop the workflow.
 */
export async function stopScheduledSync(workflowId?: string): Promise<boolean> {
  const client = await getClient();

  // If no workflowId provided, find the active one
  let targetWorkflowId = workflowId;
  if (!targetWorkflowId) {
    const active = await getActiveScheduledSync();
    if (!active) {
      console.log('[Temporal] No active scheduled sync to stop');
      return false;
    }
    targetWorkflowId = active.workflowId;
  }

  try {
    const handle = client.workflow.getHandle(targetWorkflowId);
    await handle.cancel();
    console.log(`[Temporal] Stopped scheduled sync: ${targetWorkflowId}`);
    return true;
  } catch (error) {
    console.error(`[Temporal] Failed to stop scheduled sync: ${error}`);
    return false;
  }
}

/**
 * Restart scheduled sync with new interval
 *
 * Stops the current scheduled sync and starts a new one with updated parameters.
 */
export async function restartScheduledSync(input: {
  intervalMinutes: number;
  maxIterations?: number;
  syncOptions?: FullSyncInput;
}): Promise<{ workflowId: string; runId: string } | null> {
  // Stop existing schedule first
  await stopScheduledSync();

  // Start new schedule
  return startScheduledSync(input);
}

/**
 * Check if a scheduled sync is currently active
 */
export async function isScheduledSyncActive(): Promise<boolean> {
  const active = await getActiveScheduledSync();
  return active !== null;
}

// ============================================================================
// Agent Provisioning Workflows
// ============================================================================

export interface ProvisioningInput {
  projectIdentifiers?: string[];
  maxConcurrency?: number;
  delayBetweenAgents?: number;
  skipToolAttachment?: boolean;
}

export interface ProvisioningResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  toolsAttached: number;
  errors: Array<{ projectIdentifier: string; error: string }>;
  durationMs: number;
}

export interface ProvisioningProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  currentBatch: string[];
  errors: string[];
  phase: 'fetching' | 'provisioning' | 'complete' | 'cancelled';
}

/**
 * Start agent provisioning workflow
 *
 * Creates Letta agents for Huly projects with fault tolerance and resume capability.
 */
export async function startAgentProvisioning(
  input: ProvisioningInput = {}
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `provision-agents-${Date.now()}`;

  const handle = await client.workflow.start('ProvisionAgentsWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`[Temporal] Started agent provisioning: ${workflowId}`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Execute agent provisioning and wait for completion
 */
export async function executeAgentProvisioning(
  input: ProvisioningInput = {}
): Promise<ProvisioningResult> {
  const client = await getClient();

  const workflowId = `provision-agents-${Date.now()}`;

  return await client.workflow.execute('ProvisionAgentsWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });
}

/**
 * Get provisioning progress
 */
export async function getProvisioningProgress(
  workflowId: string
): Promise<ProvisioningProgress | null> {
  try {
    const client = await getClient();
    const handle = client.workflow.getHandle(workflowId);
    return await handle.query<ProvisioningProgress>('progress');
  } catch {
    return null;
  }
}

/**
 * Cancel a running provisioning workflow
 */
export async function cancelProvisioning(workflowId: string): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal('cancel');
}

/**
 * Provision a single agent
 */
export async function provisionSingleAgent(input: {
  projectIdentifier: string;
  projectName: string;
  attachTools?: boolean;
}): Promise<{
  success: boolean;
  agentId?: string;
  created?: boolean;
  toolsAttached?: number;
  error?: string;
}> {
  const client = await getClient();

  const workflowId = `provision-single-${input.projectIdentifier}-${Date.now()}`;

  return await client.workflow.execute('ProvisionSingleAgentWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });
}

/**
 * Cleanup failed provisions
 */
export async function cleanupFailedProvisions(
  projectIdentifiers: string[]
): Promise<{ cleaned: number; errors: string[] }> {
  const client = await getClient();

  const workflowId = `cleanup-provisions-${Date.now()}`;

  return await client.workflow.execute('CleanupFailedProvisionsWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [{ projectIdentifiers }],
  });
}

// ============================================================================
// Beads Sync Workflows
// ============================================================================

export interface BeadsSyncInput {
  beadsIssueId: string;
  context: SyncContext;
  linkedIds?: { hulyId?: string; vibeId?: string };
}

/**
 * Schedule a Beads sync workflow (fire-and-forget)
 *
 * Triggered when Beads files change. Syncs from Beads to Huly and Vibe.
 * Returns immediately; workflow runs in background with retry.
 */
export async function scheduleBeadsSync(
  input: BeadsSyncInput
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `sync-beads-${input.context.projectIdentifier}-${input.beadsIssueId}-${Date.now()}`;

  const handle = await client.workflow.start('SyncFromBeadsWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`[Temporal] Scheduled Beads sync: ${workflowId}`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Execute a Beads sync and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 */
export async function executeBeadsSync(
  input: BeadsSyncInput
): Promise<BidirectionalSyncResult> {
  const client = await getClient();

  const workflowId = `sync-beads-${input.context.projectIdentifier}-${input.beadsIssueId}-${Date.now()}`;

  return await client.workflow.execute('SyncFromBeadsWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });
}

/**
 * Schedule batch Beads sync for multiple changed issues
 *
 * When multiple Beads issues change at once (e.g., git pull), this
 * schedules individual workflows for each changed issue.
 */
export async function scheduleBatchBeadsSync(
  inputs: BeadsSyncInput[]
): Promise<Array<{ workflowId: string; runId: string }>> {
  const results: Array<{ workflowId: string; runId: string }> = [];

  for (const input of inputs) {
    try {
      const result = await scheduleBeadsSync(input);
      results.push(result);
    } catch (error) {
      console.error(
        `[Temporal] Failed to schedule Beads sync for ${input.beadsIssueId}:`,
        error
      );
    }
  }

  console.log(`[Temporal] Scheduled ${results.length}/${inputs.length} Beads syncs`);
  return results;
}

/**
 * Schedule a Beads file change workflow
 *
 * This is the main entry point for BeadsWatcher to trigger durable syncs.
 * When .beads files change, call this to sync all Beads issues.
 */
export async function scheduleBeadsFileChange(
  input: BeadsFileChangeInput
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `beads-change-${input.projectIdentifier}-${Date.now()}`;

  const handle = await client.workflow.start('BeadsFileChangeWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`[Temporal] Scheduled Beads file change workflow: ${workflowId}`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Execute a Beads file change workflow and wait for result
 */
export async function executeBeadsFileChange(
  input: BeadsFileChangeInput
): Promise<BeadsFileChangeResult> {
  const client = await getClient();

  const workflowId = `beads-change-${input.projectIdentifier}-${Date.now()}`;

  return await client.workflow.execute('BeadsFileChangeWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });
}

/**
 * Schedule a Vibe SSE change workflow
 *
 * This is the main entry point for VibeEventWatcher to trigger durable syncs.
 * When Vibe SSE events indicate task changes, call this to sync to Huly.
 */
export async function scheduleVibeSSEChange(
  input: VibeSSEChangeInput
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `vibe-sse-${input.vibeProjectId}-${Date.now()}`;

  const handle = await client.workflow.start('VibeSSEChangeWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`[Temporal] Scheduled Vibe SSE change workflow: ${workflowId}`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Execute a Vibe SSE change workflow and wait for result
 */
export async function executeVibeSSEChange(
  input: VibeSSEChangeInput
): Promise<VibeSSEChangeResult> {
  const client = await getClient();

  const workflowId = `vibe-sse-${input.vibeProjectId}-${Date.now()}`;

  return await client.workflow.execute('VibeSSEChangeWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });
}

// ============================================================
// HULY WEBHOOK CHANGE WORKFLOWS
// ============================================================

/**
 * Schedule a Huly webhook change workflow (fire and forget)
 *
 * Processes Huly webhook change events and syncs to Vibe/Beads.
 * Returns immediately after scheduling.
 */
export async function scheduleHulyWebhookChange(
  input: HulyWebhookChangeInput
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();

  const workflowId = `huly-webhook-${input.type}-${Date.now()}`;

  const handle = await client.workflow.start('HulyWebhookChangeWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`[Temporal] Scheduled Huly webhook change workflow: ${workflowId}`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Execute a Huly webhook change workflow and wait for result
 */
export async function executeHulyWebhookChange(
  input: HulyWebhookChangeInput
): Promise<HulyWebhookChangeResult> {
  const client = await getClient();

  const workflowId = `huly-webhook-${input.type}-${Date.now()}`;

  return await client.workflow.execute('HulyWebhookChangeWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });
}
