/**
 * Full Orchestration Workflow
 *
 * Top-level workflow that replaces the SyncOrchestrator.syncHulyToVibe() function.
 * Coordinates the complete bidirectional sync across all projects.
 *
 * Features:
 * - Fetches all Huly and Vibe projects
 * - Creates Vibe projects if needed
 * - Runs Phase 1 (Huly→Vibe), Phase 2 (Vibe→Huly), Phase 3 (Beads) for each project
 * - Updates Letta agent memory
 * - Records metrics
 * - Durable execution with automatic retry
 */

import {
  proxyActivities,
  startChild,
  executeChild,
  log,
  sleep,
  defineSignal,
  defineQuery,
  setHandler,
  continueAsNew,
} from '@temporalio/workflow';

import type * as orchestrationActivities from '../activities/orchestration';
import type * as syncActivities from '../activities/sync-services';

// ============================================================
// ACTIVITY PROXIES
// ============================================================

// Orchestration activities (project fetching, Letta, metrics)
const {
  fetchHulyProjects,
  fetchVibeProjects,
  ensureVibeProject,
  fetchProjectData,
  initializeBeads,
  fetchBeadsIssues,
  updateLettaMemory,
  recordSyncMetrics,
} = proxyActivities<typeof orchestrationActivities>({
  startToCloseTimeout: '120 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 3,
  },
});

// Helper function to extract git repo path (pure function, can run in workflow)
function extractGitRepoPath(description?: string): string | null {
  if (!description) return null;
  const match = description.match(/Filesystem:\s*([^\n]+)/i);
  if (match) {
    const path = match[1].trim();
    if (path.startsWith('/')) return path;
  }
  return null;
}

// Sync activities (issue-level sync)
const { syncIssueToVibe, syncTaskToHuly, syncIssueToBeads, syncBeadsToHuly, commitBeadsToGit } =
  proxyActivities<typeof syncActivities>({
    startToCloseTimeout: '60 seconds',
    retry: {
      initialInterval: '2 seconds',
      backoffCoefficient: 2,
      maximumInterval: '60 seconds',
      maximumAttempts: 5,
      nonRetryableErrorTypes: ['HulyValidationError', 'VibeValidationError'],
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

  // ======== Internal fields for continueAsNew ========
  /** Starting project index (for continuation) */
  _continueIndex?: number;
  /** Accumulated results from previous runs */
  _accumulatedResults?: ProjectSyncResult[];
  /** Accumulated errors from previous runs */
  _accumulatedErrors?: string[];
  /** Original start time (preserved across continuations) */
  _originalStartTime?: number;
}

export interface FullSyncResult {
  success: boolean;
  projectsProcessed: number;
  issuesSynced: number;
  durationMs: number;
  errors: string[];
  projectResults: ProjectSyncResult[];
}

export interface ProjectSyncResult {
  projectIdentifier: string;
  projectName: string;
  success: boolean;
  phase1: { synced: number; skipped: number; errors: number };
  phase2: { synced: number; skipped: number; errors: number };
  phase3?: { synced: number; skipped: number; errors: number };
  lettaUpdated: boolean;
  error?: string;
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

/**
 * FullOrchestrationWorkflow
 *
 * Replaces SyncOrchestrator.syncHulyToVibe() with a durable Temporal workflow.
 * Orchestrates the complete sync across all projects.
 */
// Maximum projects to process before calling continueAsNew (prevents history overflow)
const MAX_PROJECTS_PER_CONTINUATION = 3;

export async function FullOrchestrationWorkflow(
  input: FullSyncInput = {}
): Promise<FullSyncResult> {
  const {
    projectIdentifier,
    batchSize = 5,
    enableBeads = true,
    enableLetta = true,
    dryRun = false,
    // Continuation state
    _continueIndex = 0,
    _accumulatedResults = [],
    _accumulatedErrors = [],
    _originalStartTime,
  } = input;

  const startTime = _originalStartTime || Date.now();
  let cancelled = false;

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

    const [hulyProjects, vibeProjects] = await Promise.all([
      fetchHulyProjects(),
      fetchVibeProjects(),
    ]);

    log.info('[FullOrchestration] Fetched projects', {
      huly: hulyProjects.length,
      vibe: vibeProjects.length,
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

      // Use child workflow for each project (isolates history, supports continueAsNew)
      const projectResult = await executeChild(ProjectSyncWorkflow, {
        workflowId: `project-sync-${hulyProject.identifier}-${Date.now()}`,
        args: [
          {
            hulyProject,
            vibeProjects,
            batchSize,
            enableBeads,
            enableLetta,
            dryRun,
          },
        ],
      });

      result.projectResults.push(projectResult);
      result.projectsProcessed++;
      progress.projectsCompleted++;
      progress.issuesSynced += projectResult.phase1.synced + projectResult.phase2.synced;

      if (!projectResult.success) {
        progress.errors++;
        if (projectResult.error) {
          result.errors.push(`${hulyProject.identifier}: ${projectResult.error}`);
        }
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
          _continueIndex: nextIdx,
          _accumulatedResults: result.projectResults,
          _accumulatedErrors: result.errors,
          _originalStartTime: startTime,
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
// PROJECT SYNC WORKFLOW (with continueAsNew for large projects)
// ============================================================

// Maximum issues to process before calling continueAsNew
const MAX_ISSUES_PER_CONTINUATION = 100;

export interface ProjectSyncInput {
  hulyProject: { identifier: string; name: string; description?: string };
  vibeProjects: Array<{ id: string; name: string }>;
  batchSize: number;
  enableBeads: boolean;
  enableLetta: boolean;
  dryRun: boolean;

  // Internal continuation state
  _phase?: 'init' | 'phase1' | 'phase2' | 'phase3' | 'phase3b' | 'done';
  _phase1Index?: number;
  _phase2Index?: number;
  _phase3Index?: number;
  _accumulatedResult?: ProjectSyncResult;
  _vibeProjectId?: string;
  _gitRepoPath?: string | null;
  _beadsInitialized?: boolean;
  _phase1UpdatedTasks?: string[];
}

/**
 * ProjectSyncWorkflow
 *
 * Handles syncing a single project with continueAsNew for large issue counts.
 * This prevents workflow history overflow for projects like LTSEL with 990 issues.
 */
export async function ProjectSyncWorkflow(input: ProjectSyncInput): Promise<ProjectSyncResult> {
  const {
    hulyProject,
    vibeProjects,
    batchSize,
    enableBeads,
    enableLetta,
    dryRun,
    // Continuation state
    _phase = 'init',
    _phase1Index = 0,
    _phase2Index = 0,
    _phase3Index = 0,
    _accumulatedResult,
    _vibeProjectId,
    _gitRepoPath,
    _beadsInitialized = false,
    _phase1UpdatedTasks = [],
  } = input;

  log.info(`[ProjectSync] Processing: ${hulyProject.identifier}`, {
    phase: _phase,
    phase1Index: _phase1Index,
    phase2Index: _phase2Index,
    phase3Index: _phase3Index,
  });

  // Initialize or restore result
  const result: ProjectSyncResult = _accumulatedResult || {
    projectIdentifier: hulyProject.identifier,
    projectName: hulyProject.name,
    success: false,
    phase1: { synced: 0, skipped: 0, errors: 0 },
    phase2: { synced: 0, skipped: 0, errors: 0 },
    lettaUpdated: false,
  };

  let vibeProjectId = _vibeProjectId;
  let gitRepoPath = _gitRepoPath;
  let beadsInitialized = _beadsInitialized;
  const phase1UpdatedTasks = new Set(_phase1UpdatedTasks);
  let issuesProcessedThisRun = 0;

  try {
    // INIT PHASE: Setup project and fetch data
    if (_phase === 'init') {
      // Ensure Vibe project exists
      const vibeProject = await ensureVibeProject({
        hulyProject,
        existingVibeProjects: vibeProjects,
      });
      vibeProjectId = vibeProject.id;

      // Extract git repo path for Beads
      gitRepoPath = extractGitRepoPath(hulyProject.description);

      // Initialize Beads if enabled
      if (enableBeads && gitRepoPath) {
        beadsInitialized = await initializeBeads({
          gitRepoPath,
          projectName: hulyProject.name,
          projectIdentifier: hulyProject.identifier,
        });
      }

      // Continue to phase1
      return await continueAsNew<typeof ProjectSyncWorkflow>({
        ...input,
        _phase: 'phase1',
        _vibeProjectId: vibeProjectId,
        _gitRepoPath: gitRepoPath,
        _beadsInitialized: beadsInitialized,
        _accumulatedResult: result,
      });
    }

    // Fetch project data (needed for all phases)
    const { hulyIssues, vibeTasks } = await fetchProjectData({
      hulyProject,
      vibeProjectId: vibeProjectId!,
    });

    // Build lookup maps
    const tasksByHulyId = new Map<string, { id: string; status: string }>();
    for (const task of vibeTasks) {
      const match = task.description?.match(/Huly Issue:\s*([A-Z]+-\d+)/i);
      if (match) {
        tasksByHulyId.set(match[1], { id: task.id, status: task.status });
      }
    }

    // PHASE 1: Huly → Vibe
    if (_phase === 'phase1') {
      log.info(
        `[ProjectSync] Phase 1: ${hulyIssues.length} issues → Vibe (starting at ${_phase1Index})`
      );

      for (let i = _phase1Index; i < hulyIssues.length; i += batchSize) {
        const batch = hulyIssues.slice(i, Math.min(i + batchSize, hulyIssues.length));

        const batchResults = await Promise.all(
          batch.map(async issue => {
            const existingTask = tasksByHulyId.get(issue.identifier);

            if (dryRun) {
              return { success: true, skipped: true };
            }

            const syncResult = await syncIssueToVibe({
              issue,
              context: {
                projectIdentifier: hulyProject.identifier,
                vibeProjectId: vibeProjectId!,
                gitRepoPath: gitRepoPath || undefined,
              },
              existingTaskId: existingTask?.id,
              operation: existingTask ? 'update' : 'create',
            });

            if (syncResult.success && syncResult.id) {
              phase1UpdatedTasks.add(syncResult.id);
            }

            return syncResult;
          })
        );

        for (const r of batchResults) {
          if (r.skipped) result.phase1.skipped++;
          else if (r.success) result.phase1.synced++;
          else result.phase1.errors++;
        }

        issuesProcessedThisRun += batch.length;

        // Check if we need to continue as new
        const nextIndex = i + batchSize;
        if (
          issuesProcessedThisRun >= MAX_ISSUES_PER_CONTINUATION &&
          nextIndex < hulyIssues.length
        ) {
          log.info(`[ProjectSync] Phase 1 continuing as new at index ${nextIndex}`);
          return await continueAsNew<typeof ProjectSyncWorkflow>({
            ...input,
            _phase: 'phase1',
            _phase1Index: nextIndex,
            _vibeProjectId: vibeProjectId,
            _gitRepoPath: gitRepoPath,
            _beadsInitialized: beadsInitialized,
            _accumulatedResult: result,
            _phase1UpdatedTasks: Array.from(phase1UpdatedTasks),
          });
        }
      }

      // Phase 1 complete, move to phase 2
      return await continueAsNew<typeof ProjectSyncWorkflow>({
        ...input,
        _phase: 'phase2',
        _phase1Index: hulyIssues.length,
        _vibeProjectId: vibeProjectId,
        _gitRepoPath: gitRepoPath,
        _beadsInitialized: beadsInitialized,
        _accumulatedResult: result,
        _phase1UpdatedTasks: Array.from(phase1UpdatedTasks),
      });
    }

    // PHASE 2: Vibe → Huly (skip tasks updated in Phase 1)
    if (_phase === 'phase2') {
      log.info(
        `[ProjectSync] Phase 2: ${vibeTasks.length} tasks → Huly (starting at ${_phase2Index})`
      );

      const issuesByIdentifier = new Map(hulyIssues.map(i => [i.identifier, i]));

      for (let i = _phase2Index; i < vibeTasks.length; i++) {
        const task = vibeTasks[i];

        // Skip if updated in Phase 1
        if (phase1UpdatedTasks.has(task.id)) {
          result.phase2.skipped++;
          continue;
        }

        // Extract Huly identifier
        const match = task.description?.match(/Huly Issue:\s*([A-Z]+-\d+)/i);
        if (!match) {
          result.phase2.skipped++;
          continue;
        }

        const hulyIdentifier = match[1];
        const hulyIssue = issuesByIdentifier.get(hulyIdentifier);

        if (!hulyIssue) {
          result.phase2.skipped++;
          continue;
        }

        if (dryRun) {
          result.phase2.skipped++;
          continue;
        }

        const syncResult = await syncTaskToHuly({
          task,
          hulyIdentifier,
          context: {
            projectIdentifier: hulyProject.identifier,
            vibeProjectId: vibeProjectId!,
          },
        });

        if (syncResult.skipped) result.phase2.skipped++;
        else if (syncResult.success) result.phase2.synced++;
        else result.phase2.errors++;

        issuesProcessedThisRun++;

        // Check if we need to continue as new
        const nextIndex = i + 1;
        if (issuesProcessedThisRun >= MAX_ISSUES_PER_CONTINUATION && nextIndex < vibeTasks.length) {
          log.info(`[ProjectSync] Phase 2 continuing as new at index ${nextIndex}`);
          return await continueAsNew<typeof ProjectSyncWorkflow>({
            ...input,
            _phase: 'phase2',
            _phase2Index: nextIndex,
            _vibeProjectId: vibeProjectId,
            _gitRepoPath: gitRepoPath,
            _beadsInitialized: beadsInitialized,
            _accumulatedResult: result,
            _phase1UpdatedTasks: Array.from(phase1UpdatedTasks),
          });
        }
      }

      // Phase 2 complete, move to phase 3 or done
      if (enableBeads && beadsInitialized && gitRepoPath) {
        return await continueAsNew<typeof ProjectSyncWorkflow>({
          ...input,
          _phase: 'phase3',
          _phase2Index: vibeTasks.length,
          _vibeProjectId: vibeProjectId,
          _gitRepoPath: gitRepoPath,
          _beadsInitialized: beadsInitialized,
          _accumulatedResult: result,
          _phase1UpdatedTasks: Array.from(phase1UpdatedTasks),
        });
      } else {
        // Skip to done
        return await continueAsNew<typeof ProjectSyncWorkflow>({
          ...input,
          _phase: 'done',
          _vibeProjectId: vibeProjectId,
          _gitRepoPath: gitRepoPath,
          _beadsInitialized: beadsInitialized,
          _accumulatedResult: result,
        });
      }
    }

    // PHASE 3: Beads sync (if enabled)
    if (_phase === 'phase3') {
      log.info(`[ProjectSync] Phase 3: Beads sync (starting at ${_phase3Index})`);

      if (!result.phase3) {
        result.phase3 = { synced: 0, skipped: 0, errors: 0 };
      }

      const beadsIssues = await fetchBeadsIssues({ gitRepoPath: gitRepoPath! });

      for (let i = _phase3Index; i < hulyIssues.length; i += batchSize) {
        const batch = hulyIssues.slice(i, Math.min(i + batchSize, hulyIssues.length));

        const batchResults = await Promise.all(
          batch.map(async issue => {
            if (dryRun) {
              return { success: true, skipped: true };
            }

            return await syncIssueToBeads({
              issue,
              context: {
                projectIdentifier: hulyProject.identifier,
                vibeProjectId: vibeProjectId!,
                gitRepoPath: gitRepoPath!,
              },
              existingBeadsIssues: beadsIssues,
            });
          })
        );

        for (const r of batchResults) {
          if (r.skipped) result.phase3!.skipped++;
          else if (r.success) result.phase3!.synced++;
          else result.phase3!.errors++;
        }

        issuesProcessedThisRun += batch.length;

        // Check if we need to continue as new
        const nextIndex = i + batchSize;
        if (
          issuesProcessedThisRun >= MAX_ISSUES_PER_CONTINUATION &&
          nextIndex < hulyIssues.length
        ) {
          log.info(`[ProjectSync] Phase 3 continuing as new at index ${nextIndex}`);
          return await continueAsNew<typeof ProjectSyncWorkflow>({
            ...input,
            _phase: 'phase3',
            _phase3Index: nextIndex,
            _vibeProjectId: vibeProjectId,
            _gitRepoPath: gitRepoPath,
            _beadsInitialized: beadsInitialized,
            _accumulatedResult: result,
          });
        }
      }

      // Commit Beads changes
      if (!dryRun && result.phase3!.synced > 0) {
        await commitBeadsToGit({
          context: {
            projectIdentifier: hulyProject.identifier,
            vibeProjectId: vibeProjectId!,
            gitRepoPath: gitRepoPath!,
          },
          message: `Sync from VibeSync: ${result.phase3!.synced} issues`,
        });
      }

      return await continueAsNew<typeof ProjectSyncWorkflow>({
        ...input,
        _phase: 'phase3b',
        _vibeProjectId: vibeProjectId,
        _gitRepoPath: gitRepoPath,
        _beadsInitialized: beadsInitialized,
        _accumulatedResult: result,
      });
    }

    if (_phase === 'phase3b') {
      log.info(`[ProjectSync] Phase 3b: Beads→Huly status sync`);

      const beadsIssues = await fetchBeadsIssues({ gitRepoPath: gitRepoPath! });

      let beadsSynced = 0;
      let beadsSkipped = 0;

      for (const beadsIssue of beadsIssues) {
        const hulyLabel = beadsIssue.labels?.find(l => l.startsWith('huly:'));
        if (!hulyLabel) {
          beadsSkipped++;
          continue;
        }

        const hulyIdentifier = hulyLabel.replace('huly:', '');

        if (dryRun) {
          beadsSkipped++;
          continue;
        }

        try {
          const syncResult = await syncBeadsToHuly({
            beadsIssue: {
              id: beadsIssue.id,
              title: beadsIssue.title,
              status: beadsIssue.status,
              priority: undefined,
            },
            hulyIdentifier,
            context: {
              projectIdentifier: hulyProject.identifier,
              vibeProjectId: vibeProjectId!,
              gitRepoPath: gitRepoPath!,
            },
          });

          if (syncResult.success) {
            beadsSynced++;
          } else {
            beadsSkipped++;
          }
        } catch (error) {
          log.warn(`[ProjectSync] Phase 3b error for ${beadsIssue.id}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          beadsSkipped++;
        }

        await sleep('100ms');
      }

      log.info(`[ProjectSync] Phase 3b complete`, { synced: beadsSynced, skipped: beadsSkipped });

      // Move to done
      return await continueAsNew<typeof ProjectSyncWorkflow>({
        ...input,
        _phase: 'done',
        _vibeProjectId: vibeProjectId,
        _gitRepoPath: gitRepoPath,
        _beadsInitialized: beadsInitialized,
        _accumulatedResult: result,
      });
    }

    // DONE PHASE: Finalize
    if (_phase === 'done') {
      // Update Letta memory (if enabled)
      if (enableLetta && !dryRun) {
        result.lettaUpdated = false; // Placeholder
      }

      result.success = true;

      log.info(`[ProjectSync] Complete: ${hulyProject.identifier}`, {
        phase1: result.phase1,
        phase2: result.phase2,
        phase3: result.phase3,
      });

      return result;
    }

    // Should never reach here
    throw new Error(`Unknown phase: ${_phase}`);
  } catch (error) {
    // IMPORTANT: ContinueAsNew throws an exception that must be propagated
    // Check if this is a ContinueAsNew exception and rethrow it
    if (
      error instanceof Error &&
      (error.name === 'ContinueAsNew' ||
        error.message.includes('Workflow continued as new') ||
        error.message.includes('continueAsNew'))
    ) {
      throw error;
    }

    result.error = error instanceof Error ? error.message : String(error);
    log.error(`[ProjectSync] Failed: ${hulyProject.identifier}`, {
      error: result.error,
    });
    return result;
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
