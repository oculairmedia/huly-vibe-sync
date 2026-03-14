/**
 * Event Trigger Client Functions
 *
 * Schedule and manage Huly webhook change workflows.
 */

import type {
  HulyWebhookChangeInput,
  HulyWebhookChangeResult,
} from '../workflows/bidirectional-sync';

import { WorkflowIdReusePolicy } from '@temporalio/client';
import { getClient, TASK_QUEUE } from './connection';

function buildWebhookWorkflowId(input: HulyWebhookChangeInput): string {
  const timestamp = Date.parse(input.timestamp);
  const suffix = Number.isFinite(timestamp) ? timestamp : Date.now();
  return `huly-webhook-${input.type}-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Schedule a Huly webhook change workflow (fire and forget)
 *
 * Processes Huly webhook change events and syncs to Beads.
 * Returns immediately after scheduling.
 */
export async function scheduleHulyWebhookChange(
  input: HulyWebhookChangeInput
): Promise<{ workflowId: string; runId: string }> {
  const client = await getClient();
  const workflowId = buildWebhookWorkflowId(input);
  const handle = await client.workflow.start('HulyWebhookChangeWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
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
  return await client.workflow.execute('HulyWebhookChangeWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId: buildWebhookWorkflowId(input),
    args: [input],
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
  });
}
