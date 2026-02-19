/**
 * Full Orchestration Workflow
 *
 * Top-level workflow that coordinates the complete bidirectional sync across all projects.
 *
 * Features:
 * - Fetches all Huly projects
 * - Runs Phase 3 (Beads) for each project
 * - Updates Letta agent memory
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
import type * as agentProvisioningActivities from '../activities/agent-provisioning';
import { ProvisionSingleAgentWorkflow } from './agent-provisioning';
import { ProjectSyncWorkflow } from './project-sync';
import type { ProjectSyncResult, ProjectSyncInput } from './project-sync';

// ============================================================
// ACTIVITY PROXIES
// ============================================================

const { fetchHulyProjects, fetchHulyIssuesBulk, recordSyncMetrics } = proxyActivities<
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

const { checkAgentExists } = proxyActivities<typeof agentProvisioningActivities>({
  startToCloseTimeout: '60 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
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
  /** Optional: sync only specific project */
  projectIdentifier?: string;
  /** Batch size for parallel issue sync (default: 5) */
  batchSize?: number;
  /** Enable Beads sync (default: true if configured) */
  enableBeads?: boolean;
  /** Enable Letta memory updates (default: true if configured) */
  enableLetta?: boolean;
  /** Dry run - don't make changes */
  dryRun?: boolean;
  /** Max consecutive failures before skipping a project (default: 3) */
  circuitBreakerThreshold?: number;

  // ======== Internal fields for continueAsNew ========
  /** Starting project index (for continuation) */
  _continueIndex?: number;
  /** Accumulated results from previous runs */
  _accumulatedResults?: ProjectSyncResult[];
  /** Accumulated errors from previous runs */
  _accumulatedErrors?: string[];
  /** Original start time (preserved across continuations) */
  _originalStartTime?: number;
  /** Circuit breaker: map of project -> consecutive failure count */
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

// Maximum projects to process before calling continueAsNew (prevents history overflow)
const MAX_PROJECTS_PER_CONTINUATION = 3;

/**
 * FullOrchestrationWorkflow
 *
 * Replaces SyncOrchestrator.syncHulyToVibe() with a durable Temporal workflow.
 * Orchestrates the complete sync across all projects.
 */
export async function FullOrchestrationWorkflow(
  input: FullSyncInput = {}
): Promise<FullSyncResult> {
  const {
    projectIdentifier,
    batchSize = 5,
    enableBeads = true,
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

  // Progress tracking
  const progress: SyncProgress = {
    status: 'initializing',
    projectsTotal: 0,
    projectsCompleted: 0,
    issuesSynced: 0,
    errors: 0,
    startedAt: startTime,
    elapsedMs: 0,
  };

  // Set up signal and query handlers
  setHandler(cancelSignal, () => {
    cancelled = true;
    progress.status = 'cancelled';
  });

  setHandler(progressQuery, () => ({
    ...progress,
    elapsedMs: Date.now() - startTime,
  }));

  // Initialize result with accumulated data from previous continuations
  const result: FullSyncResult = {
    success: false,
    projectsProcessed: _accumulatedResults.length,
    issuesSynced: _accumulatedResults.reduce(
      (sum, r) => sum + r.phase1.synced + r.phase2.synced + (r.phase3?.synced || 0),
      0
    ),
    durationMs: 0,
    errors: [..._accumulatedErrors],
    projectResults: [..._accumulatedResults],
  };

  try {
    log.info('[FullOrchestration] Starting full sync', {
      projectIdentifier,
      batchSize,
      enableBeads,
      enableLetta,
      dryRun,
      continueIndex: _continueIndex,
      accumulatedProjects: _accumulatedResults.length,
    });

    // Phase 0: Fetch all projects
    progress.status = 'fetching';

    const hulyProjects = await fetchHulyProjects();

    log.info('[FullOrchestration] Fetched projects', {
      huly: hulyProjects.length,
    });

    // Filter to specific project if requested
    let projectsToSync = hulyProjects;
    if (projectIdentifier) {
      projectsToSync = hulyProjects.filter(
        p => p.identifier === projectIdentifier || p.name === projectIdentifier
      );

      if (projectsToSync.length === 0) {
        throw new Error(`Project not found: ${projectIdentifier}`);
      }
    }

    progress.projectsTotal = projectsToSync.length;
    progress.projectsCompleted = _continueIndex;
    progress.status = 'syncing';

    // Bulk prefetch issues from all projects (7.4x faster than sequential)
    const projectIdentifiers = projectsToSync.map(p => p.identifier);
    let prefetchedIssuesByProject: Record<
      string,
      Array<{
        identifier: string;
        title: string;
        status: string;
        priority?: string;
        modifiedOn?: number;
        parentIssue?: string;
      }>
    > = {};

    try {
      prefetchedIssuesByProject = await fetchHulyIssuesBulk({
        projectIdentifiers,
        limit: 1000,
      });
      log.info('[FullOrchestration] Bulk prefetched issues', {
        projects: Object.keys(prefetchedIssuesByProject).length,
        totalIssues: Object.values(prefetchedIssuesByProject).reduce(
          (sum, arr) => sum + arr.length,
          0
        ),
      });
    } catch (error) {
      log.warn('[FullOrchestration] Bulk prefetch failed, falling back to per-project fetch', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Track how many projects we process in this continuation
    let projectsProcessedThisRun = 0;

    // Process each project (starting from _continueIndex)
    for (let idx = _continueIndex; idx < projectsToSync.length; idx++) {
      const hulyProject = projectsToSync[idx];

      if (cancelled) {
        log.info('[FullOrchestration] Cancelled by signal');
        break;
      }

      progress.currentProject = hulyProject.identifier;

      // Circuit breaker: skip projects that have failed too many times
      const failureCount = projectFailures[hulyProject.identifier] || 0;
      if (failureCount >= circuitBreakerThreshold) {
        log.warn(
          '[FullOrchestration] Circuit breaker: skipping project due to consecutive failures',
          {
            project: hulyProject.identifier,
            failureCount,
            threshold: circuitBreakerThreshold,
          }
        );

        // Record as skipped in results
        const skippedResult: ProjectSyncResult = {
          projectIdentifier: hulyProject.identifier,
          projectName: hulyProject.name,
          success: false,
          phase1: { synced: 0, skipped: 0, errors: 0 },
          phase2: { synced: 0, skipped: 0, errors: 0 },
          lettaUpdated: false,
          error: `Circuit breaker: skipped after ${failureCount} consecutive failures`,
        };
        result.projectResults.push(skippedResult);
        result.projectsProcessed++;
        progress.projectsCompleted++;
        progress.errors++;
        result.errors.push(`${hulyProject.identifier}: Circuit breaker triggered`);
        projectsProcessedThisRun++;
        continue;
      }

      // Child workflow isolates history and supports continueAsNew
      const projectResult = await executeChild(ProjectSyncWorkflow, {
        workflowId: `project-sync-${hulyProject.identifier}-${Date.now()}`,
        args: [
          {
            hulyProject,
            batchSize,
            enableBeads,
            enableLetta,
            dryRun,
            prefetchedIssues: prefetchedIssuesByProject[hulyProject.identifier] || undefined,
            prefetchedIssuesAreComplete: true,
          },
        ],
      });

      result.projectResults.push(projectResult);
      result.projectsProcessed++;
      progress.projectsCompleted++;
      progress.issuesSynced += projectResult.phase1.synced + projectResult.phase2.synced;

      if (!projectResult.success) {
        progress.errors++;
        projectFailures[hulyProject.identifier] =
          (projectFailures[hulyProject.identifier] || 0) + 1;
        if (projectResult.error) {
          result.errors.push(`${hulyProject.identifier}: ${projectResult.error}`);
        }
      } else {
        projectFailures[hulyProject.identifier] = 0;
      }

      projectsProcessedThisRun++;

      // Check if we need to continue as new (to prevent history overflow)
      const nextIdx = idx + 1;
      const hasMoreProjects = nextIdx < projectsToSync.length;

      if (hasMoreProjects && projectsProcessedThisRun >= MAX_PROJECTS_PER_CONTINUATION) {
        log.info('[FullOrchestration] Continuing as new workflow to reset history', {
          processedThisRun: projectsProcessedThisRun,
          totalProcessed: result.projectResults.length,
          remaining: projectsToSync.length - nextIdx,
          nextIndex: nextIdx,
        });

        // Continue as new with accumulated state
        await continueAsNew<typeof FullOrchestrationWorkflow>({
          projectIdentifier,
          batchSize,
          enableBeads,
          enableLetta,
          dryRun,
          circuitBreakerThreshold,
          _continueIndex: nextIdx,
          _accumulatedResults: result.projectResults,
          _accumulatedErrors: result.errors,
          _originalStartTime: startTime,
          _projectFailures: projectFailures,
        });

        // This line is never reached - continueAsNew throws
        return result;
      }

      // Small delay between projects to avoid overwhelming APIs
      await sleep('500 milliseconds');
    }

    // Record metrics
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

/**
 * ScheduledSyncWorkflow
 *
 * Long-running workflow for periodic sync.
 * Replaces setInterval-based scheduling.
 */
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
      // Run full sync as child workflow
      await executeChild(FullOrchestrationWorkflow, {
        workflowId: `full-sync-scheduled-${Date.now()}`,
        args: [syncOptions],
      });
    } catch (error) {
      log.error('[ScheduledSync] Sync iteration failed', {
        iteration,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue to next iteration
    }

    // Wait for next interval
    log.info(`[ScheduledSync] Sleeping for ${intervalMinutes} minutes`);
    await sleep(`${intervalMinutes} minutes`);
  }

  log.info('[ScheduledSync] Completed all iterations');
}
