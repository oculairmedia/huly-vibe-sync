/**
 * Temporal Workflow Triggers
 *
 * Helper functions for external services to trigger bidirectional sync workflows.
 * Used by: VibeEventWatcher, BeadsWatcher, HulyWebhookHandler
 */

import { Client, Connection } from '@temporalio/client';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'vibesync-queue';

let connection: Connection | null = null;
let client: Client | null = null;

/**
 * Get or create Temporal client
 */
async function getClient(): Promise<Client> {
  if (client) return client;

  connection = await Connection.connect({
    address: TEMPORAL_ADDRESS,
  });

  client = new Client({ connection });
  return client;
}

/**
 * Check if Temporal is available
 */
export async function isTemporalAvailable(): Promise<boolean> {
  try {
    await getClient();
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// WORKFLOW TRIGGERS
// ============================================================

export interface SyncContext {
  projectIdentifier: string;
  vibeProjectId: string;
  gitRepoPath?: string;
}

export interface LinkedIds {
  hulyId?: string;
  vibeId?: string;
  beadsId?: string;
}

/**
 * Trigger sync when Vibe task changes
 */
export async function triggerSyncFromVibe(
  vibeTaskId: string,
  context: SyncContext,
  linkedIds?: LinkedIds
): Promise<{ workflowId: string }> {
  const temporal = await getClient();
  const workflowId = `sync-vibe-${vibeTaskId}-${Date.now()}`;

  await temporal.workflow.start('SyncFromVibeWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [{
      vibeTaskId,
      context,
      linkedIds,
    }],
  });

  console.log(`[Temporal] Started SyncFromVibeWorkflow: ${workflowId}`);
  return { workflowId };
}

/**
 * Trigger sync when Huly issue changes
 */
export async function triggerSyncFromHuly(
  hulyIdentifier: string,
  context: SyncContext,
  linkedIds?: LinkedIds
): Promise<{ workflowId: string }> {
  const temporal = await getClient();
  const workflowId = `sync-huly-${hulyIdentifier}-${Date.now()}`;

  await temporal.workflow.start('SyncFromHulyWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [{
      hulyIdentifier,
      context,
      linkedIds,
    }],
  });

  console.log(`[Temporal] Started SyncFromHulyWorkflow: ${workflowId}`);
  return { workflowId };
}

/**
 * Trigger sync when Beads issue changes
 */
export async function triggerSyncFromBeads(
  beadsIssueId: string,
  context: SyncContext,
  linkedIds?: LinkedIds
): Promise<{ workflowId: string }> {
  const temporal = await getClient();
  const workflowId = `sync-beads-${beadsIssueId}-${Date.now()}`;

  await temporal.workflow.start('SyncFromBeadsWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [{
      beadsIssueId,
      context,
      linkedIds,
    }],
  });

  console.log(`[Temporal] Started SyncFromBeadsWorkflow: ${workflowId}`);
  return { workflowId };
}

/**
 * Trigger generic bidirectional sync
 */
export async function triggerBidirectionalSync(
  source: 'vibe' | 'huly' | 'beads',
  issueData: {
    id: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    modifiedAt: number;
  },
  context: SyncContext,
  linkedIds?: LinkedIds
): Promise<{ workflowId: string }> {
  const temporal = await getClient();
  const workflowId = `sync-${source}-${issueData.id}-${Date.now()}`;

  await temporal.workflow.start('BidirectionalSyncWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [{
      source,
      issueData,
      context,
      linkedIds,
    }],
  });

  console.log(`[Temporal] Started BidirectionalSyncWorkflow: ${workflowId}`);
  return { workflowId };
}

/**
 * Close the Temporal connection
 */
export async function closeConnection(): Promise<void> {
  if (connection) {
    await connection.close();
    connection = null;
    client = null;
  }
}
