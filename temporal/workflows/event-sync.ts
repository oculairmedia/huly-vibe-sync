/**
 * Event-Triggered Sync Workflows
 *
 * Workflows triggered by external events (Beads file changes, Vibe SSE, Huly webhooks).
 * These are durable replacements for in-memory event callbacks.
 */

import {
  proxyActivities,
  log,
  sleep,
  executeChild,
} from '@temporalio/workflow';

import type * as syncActivities from '../activities/bidirectional';
import type * as orchestrationActivities from '../activities/orchestration';

import {
  SyncFromVibeWorkflow,
  SyncFromHulyWorkflow,
} from './bidirectional-sync';

import type { SyncContext } from './bidirectional-sync';

const {
  syncBeadsToHuly,
  getVibeTask,
  getBeadsIssue,
} = proxyActivities<typeof syncActivities>({
  startToCloseTimeout: '120 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 5,
    nonRetryableErrorTypes: ['ValidationError', 'NotFoundError', 'ConflictError'],
  },
});

const { fetchBeadsIssues, resolveGitRepoPath } = proxyActivities<typeof orchestrationActivities>({
  startToCloseTimeout: '120 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 3,
  },
});

// ============================================================
// BEADS FILE CHANGE WORKFLOW
// ============================================================

export interface BeadsFileChangeInput {
  projectIdentifier: string;
  gitRepoPath: string;
  vibeProjectId: string;
  changedFiles: string[];
  timestamp: string;
}

export interface BeadsFileChangeResult {
  success: boolean;
  issuesProcessed: number;
  issuesSynced: number;
  errors: Array<{ issueId: string; error: string }>;
}

/**
 * BeadsFileChangeWorkflow - Triggered when .beads files change
 *
 * This workflow is the durable replacement for BeadsWatcher callbacks.
 * It fetches all Beads issues and syncs each one to Huly and Vibe.
 */
export async function BeadsFileChangeWorkflow(
  input: BeadsFileChangeInput
): Promise<BeadsFileChangeResult> {
  const { projectIdentifier, gitRepoPath, changedFiles } = input;

  log.info('[BeadsFileChange] Starting workflow', {
    project: projectIdentifier,
    fileCount: changedFiles.length,
  });

  const result: BeadsFileChangeResult = {
    success: false,
    issuesProcessed: 0,
    issuesSynced: 0,
    errors: [],
  };

  try {
    // Fetch all Beads issues from the repository
    const beadsIssues = await fetchBeadsIssues({ gitRepoPath });

    if (beadsIssues.length === 0) {
      log.info('[BeadsFileChange] No Beads issues found');
      result.success = true;
      return result;
    }

    log.info('[BeadsFileChange] Found issues to sync', {
      count: beadsIssues.length,
    });

    result.issuesProcessed = beadsIssues.length;

    // For each Beads issue with a huly: label, sync status to Huly
    for (const beadsIssue of beadsIssues) {
      try {
        // Extract Huly identifier from labels (format: huly:PROJ-123)
        const hulyLabel = beadsIssue.labels?.find(l => l.startsWith('huly:'));
        if (!hulyLabel) {
          log.info('[BeadsFileChange] Skipping issue without huly label', {
            issueId: beadsIssue.id,
          });
          result.issuesSynced++;
          continue;
        }

        const hulyIdentifier = hulyLabel.replace('huly:', '');

        // Get full issue details
        const fullIssue = await getBeadsIssue({
          issueId: beadsIssue.id,
          gitRepoPath,
        });

        if (!fullIssue) {
          log.warn('[BeadsFileChange] Issue not found', { issueId: beadsIssue.id });
          continue;
        }

        log.info('[BeadsFileChange] Syncing Beads→Huly', {
          beadsId: fullIssue.id,
          hulyId: hulyIdentifier,
          beadsStatus: fullIssue.status,
        });

        const syncResult = await syncBeadsToHuly({
          beadsIssue: {
            id: fullIssue.id,
            title: fullIssue.title,
            description: fullIssue.description,
            status: fullIssue.status,
            modifiedAt: fullIssue.updated_at
              ? new Date(fullIssue.updated_at).getTime()
              : Date.now(),
          },
          hulyIdentifier,
          context: {
            projectIdentifier,
            vibeProjectId: '', // Not needed for Beads→Huly
            gitRepoPath,
          },
        });

        if (syncResult.success) {
          log.info('[BeadsFileChange] Synced to Huly', {
            beadsId: fullIssue.id,
            hulyId: hulyIdentifier,
          });
          result.issuesSynced++;
        } else {
          log.warn('[BeadsFileChange] Sync to Huly failed', {
            beadsId: fullIssue.id,
            error: syncResult.error,
          });
          if (syncResult.error) {
            result.errors.push({ issueId: beadsIssue.id, error: syncResult.error });
          }
        }

        // Small delay between issues to avoid overwhelming APIs
        await sleep('200ms');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error('[BeadsFileChange] Failed to process issue', {
          issueId: beadsIssue.id,
          error: errorMsg,
        });
        result.errors.push({ issueId: beadsIssue.id, error: errorMsg });
      }
    }

    result.success = result.errors.length === 0;

    log.info('[BeadsFileChange] Workflow complete', {
      processed: result.issuesProcessed,
      synced: result.issuesSynced,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('[BeadsFileChange] Workflow failed', { error: errorMsg });
    result.errors.push({ issueId: 'workflow', error: errorMsg });
    return result;
  }
}

// ============================================================
// VIBE SSE EVENT WORKFLOW
// ============================================================

export interface VibeSSEChangeInput {
  vibeProjectId: string;
  hulyProjectIdentifier?: string;
  changedTaskIds: string[];
  timestamp: string;
}

export interface VibeSSEChangeResult {
  success: boolean;
  tasksProcessed: number;
  tasksSynced: number;
  errors: Array<{ taskId: string; error: string }>;
}

/**
 * VibeSSEChangeWorkflow - Triggered by Vibe SSE events
 *
 * This workflow is the durable replacement for VibeEventWatcher callbacks.
 * It processes batch task changes from the SSE stream and syncs each to Huly.
 */
export async function VibeSSEChangeWorkflow(
  input: VibeSSEChangeInput
): Promise<VibeSSEChangeResult> {
  const { vibeProjectId, hulyProjectIdentifier, changedTaskIds } = input;

  log.info('[VibeSSEChange] Starting workflow', {
    vibeProject: vibeProjectId,
    hulyProject: hulyProjectIdentifier,
    taskCount: changedTaskIds.length,
  });

  const result: VibeSSEChangeResult = {
    success: false,
    tasksProcessed: 0,
    tasksSynced: 0,
    errors: [],
  };

  if (changedTaskIds.length === 0) {
    log.info('[VibeSSEChange] No tasks to process');
    result.success = true;
    return result;
  }

  result.tasksProcessed = changedTaskIds.length;

  // Build sync context
  const context: SyncContext = {
    projectIdentifier: hulyProjectIdentifier || '',
    vibeProjectId,
  };

  // Process each changed task
  for (const taskId of changedTaskIds) {
    try {
      // Get the task details from Vibe
      const vibeTask = await getVibeTask({ taskId });

      if (!vibeTask) {
        log.warn('[VibeSSEChange] Task not found', { taskId });
        result.errors.push({ taskId, error: 'Task not found' });
        continue;
      }

      log.info('[VibeSSEChange] Processing task', {
        taskId: vibeTask.id,
        title: vibeTask.title,
        status: vibeTask.status,
      });

      // Use SyncFromVibeWorkflow as child to handle the sync properly
      const syncResult = await executeChild(SyncFromVibeWorkflow, {
        args: [
          {
            vibeTaskId: taskId,
            context,
          },
        ],
        workflowId: `vibe-sse-sync-${vibeProjectId}-${taskId}-${Date.now()}`,
      });

      if (syncResult.success) {
        result.tasksSynced++;
        log.info('[VibeSSEChange] Task synced via SyncFromVibeWorkflow', {
          taskId: vibeTask.id,
          hulyResult: syncResult.results.huly,
          beadsResult: syncResult.results.beads,
        });
      } else {
        log.warn('[VibeSSEChange] Task sync failed', {
          taskId: vibeTask.id,
          error: syncResult.error,
        });
        if (syncResult.error) {
          result.errors.push({ taskId, error: syncResult.error });
        }
      }

      // Small delay between tasks to avoid overwhelming APIs
      await sleep('200ms');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('[VibeSSEChange] Failed to process task', {
        taskId,
        error: errorMsg,
      });
      result.errors.push({ taskId, error: errorMsg });
    }
  }

  result.success = result.errors.length === 0;

  log.info('[VibeSSEChange] Workflow complete', {
    processed: result.tasksProcessed,
    synced: result.tasksSynced,
    errors: result.errors.length,
  });

  return result;
}

// ============================================================
// HULY WEBHOOK CHANGE WORKFLOW
// ============================================================

export interface HulyWebhookChangeInput {
  type: 'task.changed' | 'project.changed';
  changes: Array<{
    id: string;
    class: string;
    modifiedOn?: number;
    data?: {
      identifier?: string;
      title?: string;
      status?: string;
      space?: string;
    };
  }>;
  byProject?: Record<string, unknown[]>;
  timestamp: string;
}

export interface HulyWebhookChangeResult {
  success: boolean;
  issuesProcessed: number;
  issuesSynced: number;
  errors: Array<{ issueId: string; error: string }>;
}

/**
 * HulyWebhookChangeWorkflow - Triggered by Huly webhook events
 *
 * This workflow is the durable replacement for HulyWebhookHandler callbacks.
 * It processes Huly change notifications and syncs to Vibe/Beads.
 */
export async function HulyWebhookChangeWorkflow(
  input: HulyWebhookChangeInput
): Promise<HulyWebhookChangeResult> {
  const { type, changes, timestamp } = input;

  log.info('[HulyWebhookChange] Starting workflow', {
    type,
    changeCount: changes.length,
    timestamp,
  });

  const result: HulyWebhookChangeResult = {
    success: false,
    issuesProcessed: 0,
    issuesSynced: 0,
    errors: [],
  };

  if (changes.length === 0) {
    log.info('[HulyWebhookChange] No changes to process');
    result.success = true;
    return result;
  }

  // Filter to Issue class changes only
  const issueChanges = changes.filter(c => c.class === 'tracker:class:Issue');

  if (issueChanges.length === 0) {
    log.info('[HulyWebhookChange] No issue changes to process');
    result.success = true;
    return result;
  }

  const issueMap = new Map<string, (typeof issueChanges)[0]>();
  for (const change of issueChanges) {
    const key = change.data?.identifier || change.id;
    if (!key) continue;
    const existing = issueMap.get(key);
    if (!existing || (change.modifiedOn ?? 0) > (existing.modifiedOn ?? 0)) {
      issueMap.set(key, change);
    }
  }
  const dedupedChanges = Array.from(issueMap.values());

  if (dedupedChanges.length < issueChanges.length) {
    log.info('[HulyWebhookChange] Deduplicated issues', {
      before: issueChanges.length,
      after: dedupedChanges.length,
    });
  }

  result.issuesProcessed = dedupedChanges.length;

  for (const change of dedupedChanges) {
    const issueId = change.data?.identifier || change.id;

    try {
      if (!issueId) {
        log.warn('[HulyWebhookChange] Change missing identifier', { change });
        result.errors.push({ issueId: 'unknown', error: 'Missing identifier' });
        continue;
      }

      log.info('[HulyWebhookChange] Processing issue', {
        identifier: issueId,
        status: change.data?.status,
        title: change.data?.title?.substring(0, 50),
      });

      // Extract project identifier from issue identifier (e.g., "PROJ-123" -> "PROJ")
      const projectIdentifier = issueId.split('-')[0];

      // Resolve gitRepoPath for Beads sync — non-blocking, null on failure
      let gitRepoPath: string | undefined;
      try {
        gitRepoPath = (await resolveGitRepoPath({ projectIdentifier })) || undefined;
      } catch (err) {
        log.warn('[HulyWebhookChange] gitRepoPath resolution failed, proceeding without Beads', {
          projectIdentifier,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const syncResult = await executeChild(SyncFromHulyWorkflow, {
        args: [
          {
            hulyIdentifier: issueId,
            context: {
              projectIdentifier,
              vibeProjectId: '', // Will be looked up by the workflow
              gitRepoPath,
            },
          },
        ],
        workflowId: `huly-webhook-sync-${issueId}-${Date.now()}`,
      });

      if (syncResult.success) {
        result.issuesSynced++;
        log.info('[HulyWebhookChange] Issue synced via SyncFromHulyWorkflow', {
          identifier: issueId,
          vibeResult: syncResult.results.vibe,
          beadsResult: syncResult.results.beads,
        });
      } else {
        log.warn('[HulyWebhookChange] Issue sync failed', {
          identifier: issueId,
          error: syncResult.error,
        });
        if (syncResult.error) {
          result.errors.push({ issueId, error: syncResult.error });
        }
      }

      await sleep('500ms');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('[HulyWebhookChange] Failed to process issue', {
        issueId,
        error: errorMsg,
      });
      result.errors.push({ issueId: issueId || 'unknown', error: errorMsg });
    }
  }

  result.success = result.errors.length === 0;

  log.info('[HulyWebhookChange] Workflow complete', {
    processed: result.issuesProcessed,
    synced: result.issuesSynced,
    errors: result.errors.length,
  });

  return result;
}
