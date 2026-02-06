/**
 * Event Trigger Client Functions
 *
 * Schedule and manage Vibe SSE and Huly webhook change workflows.
 */

import type {
  VibeSSEChangeInput,
  VibeSSEChangeResult,
  HulyWebhookChangeInput,
  HulyWebhookChangeResult,
} from '../workflows/bidirectional-sync';

import { getClient, TASK_QUEUE } from './connection';

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
