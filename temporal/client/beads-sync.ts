import { getClient, TASK_QUEUE } from './connection';

export interface SyncContext {
  projectIdentifier: string;
  gitRepoPath?: string;
}

export interface BidirectionalSyncResult {
  success: boolean;
  source: string;
  issueId: string;
  errors: string[];
}

export interface BeadsFileChangeInput {
  projectIdentifier: string;
  projectPath: string;
  changedFiles: string[];
  timestamp: string;
}

export interface BeadsFileChangeResult {
  success: boolean;
  issuesProcessed: number;
  errors: string[];
}

export interface BeadsSyncInput {
  beadsIssueId: string;
  context: SyncContext;
  linkedIds?: { hulyId?: string; vibeId?: string };
}

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

export async function executeBeadsSync(input: BeadsSyncInput): Promise<BidirectionalSyncResult> {
  const client = await getClient();

  const workflowId = `sync-beads-${input.context.projectIdentifier}-${input.beadsIssueId}-${Date.now()}`;

  return await client.workflow.execute('SyncFromBeadsWorkflow', {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [input],
  });
}

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
