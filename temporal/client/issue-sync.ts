/**
 * Issue Sync Client Functions
 *
 * Schedule and manage issue sync workflows.
 */

import type { IssueSyncInput, IssueSyncResult } from '../workflows/issue-sync';

import { getClient, TASK_QUEUE } from './connection';

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
export async function executeIssueSync(input: IssueSyncInput): Promise<IssueSyncResult> {
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
