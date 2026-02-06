/**
 * Full Sync Client Functions
 *
 * Schedule and manage full orchestration sync workflows.
 */

import type { SyncIssueInput, SyncIssueResult } from '../workflows/full-sync';
import type { FullSyncInput, FullSyncResult, SyncProgress } from '../workflows/orchestration';

import { getClient, TASK_QUEUE } from './connection';

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
export async function executeSingleIssueSync(input: SyncIssueInput): Promise<SyncIssueResult> {
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
 * List running sync workflows
 */
export async function listSyncWorkflows(limit = 20): Promise<
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
