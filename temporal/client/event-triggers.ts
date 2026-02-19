/**
 * Event Trigger Client Functions
 *
 * Schedule and manage Huly webhook change workflows.
 */

import type {
  HulyWebhookChangeInput,
  HulyWebhookChangeResult,
} from '../workflows/bidirectional-sync';

import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowExecutionAlreadyStartedError,
} from '@temporalio/client';
import { getClient, TASK_QUEUE } from './connection';

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

  const workflowId = `huly-webhook-${input.type}`;

  try {
    const handle = await client.workflow.start('HulyWebhookChangeWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [input],
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    });

    console.log(`[Temporal] Scheduled Huly webhook change workflow: ${workflowId}`);

    return {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    };
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      console.log(`[Temporal] Workflow ${workflowId} already running, coalescing`);
      return { workflowId, runId: 'coalesced' };
    }
    throw error;
  }
}

/**
 * Execute a Huly webhook change workflow and wait for result
 */
export async function executeHulyWebhookChange(
  input: HulyWebhookChangeInput
): Promise<HulyWebhookChangeResult> {
  const client = await getClient();

  const workflowId = `huly-webhook-${input.type}`;

  try {
    return await client.workflow.execute('HulyWebhookChangeWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [input],
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    });
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      console.log(`[Temporal] Workflow ${workflowId} already running, coalescing`);
      // For execute, we need to wait for the existing workflow
      const handle = client.workflow.getHandle(workflowId);
      return await handle.result();
    }
    throw error;
  }
}
