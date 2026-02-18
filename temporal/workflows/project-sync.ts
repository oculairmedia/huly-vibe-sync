/**
 * Project Sync Workflow
 *
 * Handles syncing a single project with continueAsNew for large issue counts.
 * This prevents workflow history overflow for projects with many issues.
 *
 * Multi-phase execution: init → phase1 → phase2 → phase3 → phase3b → phase3c → done
 */

import { proxyActivities, executeChild, log, sleep, continueAsNew } from '@temporalio/workflow';

import type * as orchestrationActivities from '../activities/orchestration';
import type * as syncActivities from '../activities/sync-services';
import type * as syncDatabaseActivities from '../activities/sync-database';
import type * as agentProvisioningActivities from '../activities/agent-provisioning';
import { ProvisionSingleAgentWorkflow } from './agent-provisioning';

// ============================================================
// ACTIVITY PROXIES
// ============================================================

const {
  ensureVibeProject,
  fetchProjectData,
  fetchVibeTasksForHulyIssues,
  initializeBeads,
  fetchBeadsIssues,
} = proxyActivities<typeof orchestrationActivities>({
  startToCloseTimeout: '120 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 3,
  },
});

const {
  syncIssueToVibe,
  syncTaskToHuly,
  syncIssueToBeads,
  syncBeadsToHuly,
  syncBeadsToHulyBatch,
  createBeadsIssueInHuly,
  createBeadsIssueInVibe,
  syncBeadsToVibeBatch,
  commitBeadsToGit,
} = proxyActivities<typeof syncActivities>({
  startToCloseTimeout: '120 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 5,
    nonRetryableErrorTypes: ['HulyValidationError', 'VibeValidationError'],
  },
});

const { persistIssueSyncState, persistIssueSyncStateBatch } = proxyActivities<
  typeof syncDatabaseActivities
>({
  startToCloseTimeout: '60 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '20 seconds',
    maximumAttempts: 3,
  },
});

const { checkAgentExists, updateProjectAgent } = proxyActivities<
  typeof agentProvisioningActivities
>({
  startToCloseTimeout: '60 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 3,
  },
});

// Helper function to extract git repo path (pure function, can run in workflow)
function extractGitRepoPath(description?: string): string | null {
  if (!description) return null;

  const patterns = [
    /Filesystem:\s*([^\n]+)/i,
    /Path:\s*([^\n]+)/i,
    /Directory:\s*([^\n]+)/i,
    /Location:\s*([^\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const path = match[1].trim().replace(/[,;.]$/, '');
      if (path.startsWith('/')) return path;
    }
  }

  return null;
}

// ============================================================
// TYPES
// ============================================================

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

export interface ProjectSyncInput {
  hulyProject: { identifier: string; name: string; description?: string };
  vibeProjects: Array<{ id: string; name: string }>;
  batchSize: number;
  enableBeads: boolean;
  enableLetta: boolean;
  dryRun: boolean;
  prefetchedIssues?: Array<{
    identifier: string;
    title: string;
    status: string;
    priority?: string;
    modifiedOn?: number;
    parentIssue?: string;
  }>;
  prefetchedIssuesAreComplete?: boolean;

  // Internal continuation state
  _phase?: 'init' | 'phase1' | 'phase2' | 'phase3' | 'phase3b' | 'phase3c' | 'done';
  _phase1Index?: number;
  _phase2Index?: number;
  _phase3Index?: number;
  _accumulatedResult?: ProjectSyncResult;
  _vibeProjectId?: string;
  _gitRepoPath?: string | null;
  _beadsInitialized?: boolean;
  _phase1UpdatedTasks?: string[];
}

// Maximum issues to process before calling continueAsNew
const MAX_ISSUES_PER_CONTINUATION = 100;

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
    prefetchedIssues,
    prefetchedIssuesAreComplete = true,
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
  const isWebhookPrefetch = !!prefetchedIssues?.length && prefetchedIssuesAreComplete === false;
  const effectiveBatchSize = isWebhookPrefetch ? Math.max(batchSize, 20) : batchSize;
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

      // Auto-provision PM agent if Letta is enabled and project has a git repo path
      if (enableLetta && gitRepoPath) {
        try {
          const agentCheck = await checkAgentExists({
            projectIdentifier: hulyProject.identifier,
          });

          if (agentCheck.exists) {
            log.info(
              `[ProjectSync] Agent exists for ${hulyProject.identifier}, reconciling tools/memory: ${agentCheck.agentId}`
            );
          } else {
            log.info(`[ProjectSync] Provisioning PM agent for ${hulyProject.identifier}...`);
          }

          const provisionResult = await executeChild(ProvisionSingleAgentWorkflow, {
            workflowId: `provision-${hulyProject.identifier}-${Date.now()}`,
            args: [
              {
                projectIdentifier: hulyProject.identifier,
                projectName: hulyProject.name,
                attachTools: true,
              },
            ],
          });

          if (provisionResult.success && provisionResult.agentId) {
            await updateProjectAgent({
              projectIdentifier: hulyProject.identifier,
              agentId: provisionResult.agentId,
            });
            log.info(`[ProjectSync] PM agent reconciled: ${provisionResult.agentId}`);
          } else if (!provisionResult.success) {
            log.warn(`[ProjectSync] Agent provisioning failed: ${provisionResult.error}`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          log.warn(`[ProjectSync] Agent provisioning failed, continuing sync: ${errorMsg}`);
        }
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

    // Fetch project data (use prefetched issues if available, else fetch)
    let hulyIssues: Array<{
      identifier: string;
      title: string;
      status: string;
      priority?: string;
      modifiedOn?: number;
      parentIssue?: string;
      description?: string;
    }>;
    let vibeTasks: Array<{ id: string; title: string; status: string; description?: string }>;

    if (prefetchedIssues && prefetchedIssues.length > 0) {
      hulyIssues = prefetchedIssues;

      if (isWebhookPrefetch) {
        vibeTasks = await fetchVibeTasksForHulyIssues({
          projectIdentifier: hulyProject.identifier,
          vibeProjectId: vibeProjectId!,
          hulyIssueIdentifiers: prefetchedIssues.map(issue => issue.identifier),
        });
        log.info(
          `[ProjectSync] Using webhook-prefetched issues (${prefetchedIssues.length}) with mapped Vibe tasks (${vibeTasks.length}), batch size ${effectiveBatchSize}`
        );
      } else {
        const projectData = await fetchProjectData({
          hulyProject,
          vibeProjectId: vibeProjectId!,
        });
        vibeTasks = projectData.vibeTasks;
        log.info(`[ProjectSync] Using ${prefetchedIssues.length} prefetched issues`);
      }
    } else {
      const projectData = await fetchProjectData({
        hulyProject,
        vibeProjectId: vibeProjectId!,
      });
      hulyIssues = projectData.hulyIssues;
      vibeTasks = projectData.vibeTasks;
    }

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
      hulyIssues.sort((a, b) => {
        const aIsChild = !!a.parentIssue;
        const bIsChild = !!b.parentIssue;
        if (aIsChild === bIsChild) return 0;
        return aIsChild ? 1 : -1;
      });

      log.info(
        `[ProjectSync] Phase 1: ${hulyIssues.length} issues → Vibe (starting at ${_phase1Index})`
      );

      for (let i = _phase1Index; i < hulyIssues.length; i += effectiveBatchSize) {
        const batch = hulyIssues.slice(i, Math.min(i + effectiveBatchSize, hulyIssues.length));

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

              tasksByHulyId.set(issue.identifier, {
                id: syncResult.id,
                status: existingTask?.status || issue.status || 'unknown',
              });

              const parentVibeId = issue.parentIssue
                ? tasksByHulyId.get(issue.parentIssue)?.id || null
                : null;

              await persistIssueSyncState({
                identifier: issue.identifier,
                projectIdentifier: hulyProject.identifier,
                title: issue.title,
                description: issue.description,
                status: issue.status,
                priority: issue.priority,
                hulyId: issue.identifier,
                vibeTaskId: syncResult.id,
                hulyModifiedAt: issue.modifiedOn,
                vibeModifiedAt: Date.now(),
                vibeStatus: existingTask?.status,
                parentHulyId: issue.parentIssue || null,
                parentVibeId,
              });
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
        const nextIndex = i + effectiveBatchSize;
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
          knownParentIssue: hulyIssue.parentIssue || null,
        });

        if (syncResult.skipped) result.phase2.skipped++;
        else if (syncResult.success) result.phase2.synced++;
        else result.phase2.errors++;

        if (syncResult.success) {
          const parentVibeId = hulyIssue.parentIssue
            ? tasksByHulyId.get(hulyIssue.parentIssue)?.id || null
            : null;

          await persistIssueSyncState({
            identifier: hulyIdentifier,
            projectIdentifier: hulyProject.identifier,
            title: hulyIssue.title,
            description: hulyIssue.description,
            status: hulyIssue.status,
            priority: hulyIssue.priority,
            hulyId: hulyIdentifier,
            vibeTaskId: task.id,
            hulyModifiedAt: hulyIssue.modifiedOn,
            vibeModifiedAt: task.description ? Date.now() : undefined,
            vibeStatus: task.status,
            parentHulyId: hulyIssue.parentIssue || null,
            parentVibeId,
          });
        }

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

      let beadsIssues = await fetchBeadsIssues({ gitRepoPath: gitRepoPath! });

      for (let i = _phase3Index; i < hulyIssues.length; i += effectiveBatchSize) {
        const batch = hulyIssues.slice(i, Math.min(i + effectiveBatchSize, hulyIssues.length));
        const seenTitles = new Set<string>();
        const batchResults: Array<{ success: boolean; skipped?: boolean; id?: string }> = [];
        const persistenceBatch: Array<{
          identifier: string;
          projectIdentifier: string;
          title?: string;
          description?: string;
          status?: string;
          priority?: string;
          hulyId?: string;
          beadsIssueId?: string;
          hulyModifiedAt?: number;
          beadsModifiedAt?: number;
          beadsStatus?: string;
          parentHulyId?: string | null;
        }> = [];

        for (const issue of batch) {
          if (dryRun) {
            batchResults.push({ success: true, skipped: true });
            continue;
          }

          const normalizedTitle = issue.title.trim().toLowerCase();
          if (seenTitles.has(normalizedTitle)) {
            batchResults.push({ success: true, skipped: true });
            continue;
          }
          seenTitles.add(normalizedTitle);

          const syncResult = await syncIssueToBeads({
            issue,
            context: {
              projectIdentifier: hulyProject.identifier,
              vibeProjectId: vibeProjectId!,
              gitRepoPath: gitRepoPath!,
            },
            existingBeadsIssues: beadsIssues,
          });

          batchResults.push(syncResult);

          if (syncResult.id) {
            beadsIssues.push({
              id: syncResult.id,
              title: issue.title,
              status: issue.status,
            });

            persistenceBatch.push({
              identifier: issue.identifier,
              projectIdentifier: hulyProject.identifier,
              title: issue.title,
              description: issue.description,
              status: issue.status,
              priority: issue.priority,
              hulyId: issue.identifier,
              beadsIssueId: syncResult.id,
              hulyModifiedAt: issue.modifiedOn,
              beadsModifiedAt: Date.now(),
              beadsStatus: issue.status,
              parentHulyId: issue.parentIssue || null,
            });
          }
        }

        if (persistenceBatch.length > 0) {
          await persistIssueSyncStateBatch({ issues: persistenceBatch });
        }

        beadsIssues = await fetchBeadsIssues({ gitRepoPath: gitRepoPath! });

        for (const r of batchResults) {
          if (r.skipped) result.phase3!.skipped++;
          else if (r.success) result.phase3!.synced++;
          else result.phase3!.errors++;
        }

        issuesProcessedThisRun += batch.length;

        // Check if we need to continue as new
        const nextIndex = i + effectiveBatchSize;
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
      log.info(`[ProjectSync] Phase 3b: Beads→Huly sync`);

      const beadsIssues = await fetchBeadsIssues({ gitRepoPath: gitRepoPath! });

      let beadsSynced = 0;
      let beadsCreated = 0;
      let beadsSkipped = 0;

      if (dryRun) {
        beadsSkipped = beadsIssues.length;
      } else {
        const toSync: Array<{ beadsId: string; hulyIdentifier: string; status: string }> = [];
        const toCreate: typeof beadsIssues = [];

        for (const beadsIssue of beadsIssues) {
          const hulyLabels = beadsIssue.labels?.filter(l => l.startsWith('huly:')) ?? [];
          if (hulyLabels.length > 0) {
            for (const label of hulyLabels) {
              toSync.push({
                beadsId: beadsIssue.id,
                hulyIdentifier: label.replace('huly:', ''),
                status: beadsIssue.status,
              });
            }
          } else {
            toCreate.push(beadsIssue);
          }
        }

        if (toSync.length > 0) {
          log.info(`[ProjectSync] Phase 3b: Batch syncing ${toSync.length} issues to Huly`);
          try {
            const batchResult = await syncBeadsToHulyBatch({
              beadsIssues: toSync,
              context: {
                projectIdentifier: hulyProject.identifier,
                vibeProjectId: vibeProjectId!,
                gitRepoPath: gitRepoPath!,
              },
            });
            beadsSynced = batchResult.updated;
            beadsSkipped += batchResult.failed;
            if (batchResult.errors.length > 0) {
              log.warn(`[ProjectSync] Phase 3b batch errors`, {
                errors: batchResult.errors.slice(0, 5),
              });
            }

            const failedIdentifiers = new Set(batchResult.errors.map(e => e.identifier));
            const statusUpdates = toSync
              .filter(item => !failedIdentifiers.has(item.hulyIdentifier))
              .map(item => ({
                identifier: item.hulyIdentifier,
                projectIdentifier: hulyProject.identifier,
                beadsIssueId: item.beadsId,
                beadsStatus: item.status,
                beadsModifiedAt: Date.now(),
              }));

            if (statusUpdates.length > 0) {
              await persistIssueSyncStateBatch({ issues: statusUpdates });
            }
          } catch (error) {
            log.warn(`[ProjectSync] Phase 3b batch sync failed`, {
              error: error instanceof Error ? error.message : String(error),
            });
            beadsSkipped += toSync.length;
          }
        }

        for (const beadsIssue of toCreate) {
          try {
            const createResult = await createBeadsIssueInHuly({
              beadsIssue: {
                id: beadsIssue.id,
                title: beadsIssue.title,
                status: beadsIssue.status,
                priority: beadsIssue.priority,
                description: beadsIssue.description,
                labels: beadsIssue.labels,
              },
              context: {
                projectIdentifier: hulyProject.identifier,
                vibeProjectId: vibeProjectId!,
                gitRepoPath: gitRepoPath!,
              },
            });

            if (createResult.created) {
              beadsCreated++;
              log.info(
                `[ProjectSync] Created Huly issue ${createResult.hulyIdentifier} from ${beadsIssue.id}`
              );

              if (createResult.hulyIdentifier) {
                await persistIssueSyncState({
                  identifier: createResult.hulyIdentifier,
                  projectIdentifier: hulyProject.identifier,
                  title: beadsIssue.title,
                  description: beadsIssue.description,
                  status: beadsIssue.status,
                  beadsIssueId: beadsIssue.id,
                  beadsStatus: beadsIssue.status,
                  beadsModifiedAt: Date.now(),
                });
              }
            } else {
              beadsSkipped++;

              if (createResult.hulyIdentifier) {
                await persistIssueSyncState({
                  identifier: createResult.hulyIdentifier,
                  projectIdentifier: hulyProject.identifier,
                  title: beadsIssue.title,
                  description: beadsIssue.description,
                  status: beadsIssue.status,
                  beadsIssueId: beadsIssue.id,
                  beadsStatus: beadsIssue.status,
                  beadsModifiedAt: Date.now(),
                });
              }
            }
          } catch (error) {
            log.warn(`[ProjectSync] Phase 3b create error for ${beadsIssue.id}`, {
              error: error instanceof Error ? error.message : String(error),
            });
            beadsSkipped++;
          }
          await sleep('100ms');
        }
      }

      log.info(`[ProjectSync] Phase 3b complete`, {
        synced: beadsSynced,
        created: beadsCreated,
        skipped: beadsSkipped,
      });

      return await continueAsNew<typeof ProjectSyncWorkflow>({
        ...input,
        _phase: 'phase3c',
        _vibeProjectId: vibeProjectId,
        _gitRepoPath: gitRepoPath,
        _beadsInitialized: beadsInitialized,
        _accumulatedResult: result,
      });
    }

    if (_phase === 'phase3c') {
      log.info(`[ProjectSync] Phase 3c: Beads→Vibe sync (batch)`);

      const beadsIssues = await fetchBeadsIssues({ gitRepoPath: gitRepoPath! });

      let vibeCreated = 0;
      let vibeSkipped = 0;

      if (dryRun) {
        vibeSkipped = beadsIssues.length;
      } else if (beadsIssues.length > 0) {
        const batchResult = await syncBeadsToVibeBatch({
          beadsIssues: beadsIssues.map(issue => ({
            id: issue.id,
            title: issue.title,
            status: issue.status,
            priority: issue.priority,
            description: issue.description,
            labels: issue.labels,
          })),
          context: {
            projectIdentifier: hulyProject.identifier,
            vibeProjectId: vibeProjectId!,
            gitRepoPath: gitRepoPath!,
          },
        });

        vibeCreated = batchResult.stats.created;
        vibeSkipped = batchResult.stats.skipped + batchResult.stats.updated;

        for (const r of batchResult.results) {
          if (r.created) {
            log.info(`[ProjectSync] Created Vibe task ${r.vibeTaskId} from ${r.beadsId}`);
          }
        }
      }

      log.info(`[ProjectSync] Phase 3c complete`, { created: vibeCreated, skipped: vibeSkipped });

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
