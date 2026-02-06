/**
 * Agent Provisioning Client Functions
 *
 * Schedule and manage Letta agent provisioning workflows.
 */

import { getClient, TASK_QUEUE } from './connection';

// ============================================================
// TYPES
// ============================================================

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
