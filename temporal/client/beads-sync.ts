/**
 * Beads Sync Client Functions
 *
 * Schedule and manage Beads sync and file change workflows.
 */

import type {
  SyncContext,
  BidirectionalSyncResult,
  BeadsFileChangeInput,
  BeadsFileChangeResult,
} from '../workflows/bidirectional-sync';

import { getClient, TASK_QUEUE } from './connection';

// ============================================================
// TYPES
// ============================================================

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
export async function executeBeadsSync(input: BeadsSyncInput): Promise<BidirectionalSyncResult> {
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
      console.error(`[Temporal] Failed to schedule Beads sync for ${input.beadsIssueId}:`, error);
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
