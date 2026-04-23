/**
 * Full Orchestration Workflow
 *
 * Top-level workflow that coordinates project sync across all registry projects.
 *
 * Phase 4 pipeline:
 * - Fetches project list from SQLite registry
 * - Runs ProjectSyncWorkflow per project (init → sync → agent → done)
 * - Records metrics
 * - Durable execution with automatic retry
 */

import {
  proxyActivities,
  executeChild,
  log,
  sleep,
  defineSignal,
  defineQuery,
  setHandler,
  continueAsNew,
} from '@temporalio/workflow';

import type * as orchestrationActivities from '../activities/orchestration';
import { ProjectSyncWorkflow } from './project-sync';
import type { ProjectSyncResult } from './project-sync';

// ============================================================
// ACTIVITY PROXIES
// ============================================================

const { fetchRegistryProjects, recordSyncMetrics } = proxyActivities<
  typeof orchestrationActivities
>({
  startToCloseTimeout: '120 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 3,
  },
});

// ============================================================
// SIGNALS AND QUERIES
// ============================================================

export const cancelSignal = defineSignal('cancel');
export const progressQuery = defineQuery<SyncProgress>('progress');

// ============================================================
// TYPES
// ============================================================

export interface FullSyncInput {
  projectIdentifier?: string;
  batchSize?: number;
  enableLetta?: boolean;
  dryRun?: boolean;
  circuitBreakerThreshold?: number;

  // Internal fields for continueAsNew
  _continueIndex?: number;
  _accumulatedResults?: ProjectSyncResult[];
  _accumulatedErrors?: string[];
  _originalStartTime?: number;
  _projectFailures?: Record<string, number>;
}

export interface FullSyncResult {
  success: boolean;
  projectsProcessed: number;
  issuesSynced: number;
  durationMs: number;
  errors: string[];
  projectResults: ProjectSyncResult[];
}

export interface SyncProgress {
  status: 'initializing' | 'fetching' | 'syncing' | 'completing' | 'done' | 'cancelled';
  currentProject?: string;
  projectsTotal: number;
  projectsCompleted: number;
  issuesSynced: number;
  errors: number;
  startedAt: number;
  elapsedMs: number;
}

// ============================================================
// MAIN ORCHESTRATION WORKFLOW
// ============================================================

const MAX_PROJECTS_PER_CONTINUATION = 3;

export async function FullOrchestrationWorkflow(
  input: FullSyncInput = {}
): Promise<FullSyncResult> {
  const {
    projectIdentifier,
    batchSize = 5,
    enableLetta = true,
    dryRun = false,
    circuitBreakerThreshold = 3,
    _continueIndex = 0,
    _accumulatedResults = [],
    _accumulatedErrors = [],
    _originalStartTime,
    _projectFailures = {},
  } = input;

  const startTime = _originalStartTime || Date.now();
  let cancelled = false;
  const projectFailures = { ..._projectFailures };

  const progress: SyncProgress = {
    status: 'initializing',
    projectsTotal: 0,
    projectsCompleted: 0,
    issuesSynced: 0,
    errors: 0,
    startedAt: startTime,
    elapsedMs: 0,
  };

  setHandler(cancelSignal, () => {
    cancelled = true;
    progress.status = 'cancelled';
  });

  setHandler(progressQuery, () => ({
    ...progress,
    elapsedMs: Date.now() - startTime,
  }));

  const result: FullSyncResult = {
    success: false,
    projectsProcessed: _accumulatedResults.length,
    issuesSynced: 0,
    durationMs: 0,
    errors: [..._accumulatedErrors],
    projectResults: [..._accumulatedResults],
  };

  try {
    log.info('[FullOrchestration] Starting full sync', {
      projectIdentifier,
      enableLetta,
      dryRun,
      continueIndex: _continueIndex,
      accumulatedProjects: _accumulatedResults.length,
    });

    // Init: load project list from registry
    progress.status = 'fetching';
    const registryProjects = await fetchRegistryProjects();

    log.info('[FullOrchestration] Loaded registry projects', {
      count: registryProjects.length,
    });

    let projectsToSync = registryProjects;
    if (projectIdentifier) {
      projectsToSync = registryProjects.filter(
        (p: { identifier: string; name: string }) =>
          p.identifier === projectIdentifier || p.name === projectIdentifier
      );

      if (projectsToSync.length === 0) {
        throw new Error(`Project not found: ${projectIdentifier}`);
      }
    }

    progress.projectsTotal = projectsToSync.length;
    progress.projectsCompleted = _continueIndex;
    progress.status = 'syncing';

    let projectsProcessedThisRun = 0;

    for (let idx = _continueIndex; idx < projectsToSync.length; idx++) {
      const project = projectsToSync[idx];

      if (cancelled) {
        log.info('[FullOrchestration] Cancelled by signal');
        break;
      }

      progress.currentProject = project.identifier;

      const failureCount = projectFailures[project.identifier] || 0;
      if (failureCount >= circuitBreakerThreshold) {
        log.warn(
          '[FullOrchestration] Circuit breaker: skipping project due to consecutive failures',
          { project: project.identifier, failureCount, threshold: circuitBreakerThreshold }
        );

        const skippedResult: ProjectSyncResult = {
          projectIdentifier: project.identifier,
          projectName: project.name,
          success: false,
          lettaUpdated: false,
          error: `Circuit breaker: skipped after ${failureCount} consecutive failures`,
        };
        result.projectResults.push(skippedResult);
        result.projectsProcessed++;
        progress.projectsCompleted++;
        progress.errors++;
        result.errors.push(`${project.identifier}: Circuit breaker triggered`);
        projectsProcessedThisRun++;
        continue;
      }

      const projectResult = await executeChild(ProjectSyncWorkflow, {
        workflowId: `project-sync-${project.identifier}-${Date.now()}`,
        args: [
          {
            project: {
              identifier: project.identifier,
              name: project.name,
              description: project.description,
            },
            batchSize,
            enableLetta,
            dryRun,
          },
        ],
      });

      result.projectResults.push(projectResult);
      result.projectsProcessed++;
      progress.projectsCompleted++;

      if (!projectResult.success) {
        progress.errors++;
        projectFailures[project.identifier] = (projectFailures[project.identifier] || 0) + 1;
        if (projectResult.error) {
          result.errors.push(`${project.identifier}: ${projectResult.error}`);
        }
      } else {
        projectFailures[project.identifier] = 0;
      }

      projectsProcessedThisRun++;

      const nextIdx = idx + 1;
      const hasMoreProjects = nextIdx < projectsToSync.length;

      if (hasMoreProjects && projectsProcessedThisRun >= MAX_PROJECTS_PER_CONTINUATION) {
        log.info('[FullOrchestration] Continuing as new workflow to reset history', {
          processedThisRun: projectsProcessedThisRun,
          totalProcessed: result.projectResults.length,
          remaining: projectsToSync.length - nextIdx,
          nextIndex: nextIdx,
        });

        await continueAsNew<typeof FullOrchestrationWorkflow>({
          projectIdentifier,
          batchSize,
          enableLetta,
          dryRun,
          circuitBreakerThreshold,
          _continueIndex: nextIdx,
          _accumulatedResults: result.projectResults,
          _accumulatedErrors: result.errors,
          _originalStartTime: startTime,
          _projectFailures: projectFailures,
        });

        return result;
      }

      await sleep('500 milliseconds');
    }

    // Done: record metrics
    progress.status = 'completing';
    result.projectsProcessed = progress.projectsCompleted;
    result.issuesSynced = progress.issuesSynced;
    result.durationMs = Date.now() - startTime;
    result.success = result.errors.length === 0;

    await recordSyncMetrics({
      projectsProcessed: result.projectsProcessed,
      issuesSynced: result.issuesSynced,
      durationMs: result.durationMs,
      errors: result.errors.length,
    });

    progress.status = cancelled ? 'cancelled' : 'done';

    log.info('[FullOrchestration] Sync complete', {
      projects: result.projectsProcessed,
      issues: result.issuesSynced,
      duration: `${(result.durationMs / 1000).toFixed(2)}s`,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    result.durationMs = Date.now() - startTime;
    result.errors.push(error instanceof Error ? error.message : String(error));

    log.error('[FullOrchestration] Sync failed', {
      error: result.errors[result.errors.length - 1],
    });

    throw error;
  }
}

// ============================================================
// SCHEDULED SYNC WORKFLOW
// ============================================================

export async function ScheduledSyncWorkflow(input: {
  intervalMinutes: number;
  maxIterations?: number;
  syncOptions?: FullSyncInput;
}): Promise<void> {
  const { intervalMinutes, maxIterations = Infinity, syncOptions = {} } = input;

  let iteration = 0;

  log.info('[ScheduledSync] Starting scheduled sync', {
    intervalMinutes,
    maxIterations,
  });

  while (iteration < maxIterations) {
    iteration++;

    log.info(`[ScheduledSync] Running iteration ${iteration}`);

    try {
      await executeChild(FullOrchestrationWorkflow, {
        workflowId: `full-sync-scheduled-${Date.now()}`,
        args: [syncOptions],
      });
    } catch (error) {
      log.error('[ScheduledSync] Sync iteration failed', {
        iteration,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    log.info(`[ScheduledSync] Sleeping for ${intervalMinutes} minutes`);
    await sleep(`${intervalMinutes} minutes`);
  }

  log.info('[ScheduledSync] Completed all iterations');
}
