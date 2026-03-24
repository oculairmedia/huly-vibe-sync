/**
 * Project Sync Workflow — Simplified 4-Phase Pipeline
 *
 * Handles syncing a single project with continueAsNew for large issue counts.
 *
 * Phases: init → sync → agent → done
 *   init:  Discover project in registry, init beads, provision/reconcile agent
 *   sync:  Read beads issues, persist to registry DB (for MCP queries)
 *   agent: Update Letta agent memory with latest issue summary
 *   done:  Record metrics, commit beads changes if any
 */

import { proxyActivities, executeChild, log, continueAsNew } from '@temporalio/workflow';

import type * as orchestrationActivities from '../activities/orchestration';
import type * as syncDatabaseActivities from '../activities/sync-database';
import type * as agentProvisioningActivities from '../activities/agent-provisioning';
import { ProvisionSingleAgentWorkflow } from './agent-provisioning';

// ============================================================
// ACTIVITY PROXIES
// ============================================================

const { initializeBeads, fetchBeadsIssues, updateLettaMemory } = proxyActivities<
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

const { commitBeadsToGit } = proxyActivities<typeof import('../activities/sync-services')>({
  startToCloseTimeout: '120 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 3,
  },
});

const { persistIssueSyncStateBatch } = proxyActivities<typeof syncDatabaseActivities>({
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
  beadsSync: { synced: number; skipped: number; errors: number };
  lettaUpdated: boolean;
  error?: string;
}

export interface ProjectSyncInput {
  project: { identifier: string; name: string; description?: string };
  batchSize: number;
  enableBeads: boolean;
  enableLetta: boolean;
  dryRun: boolean;

  // Internal continuation state
  _phase?: 'init' | 'sync' | 'agent' | 'done';
  _accumulatedResult?: ProjectSyncResult;
  _gitRepoPath?: string | null;
  _beadsInitialized?: boolean;
}

export async function ProjectSyncWorkflow(input: ProjectSyncInput): Promise<ProjectSyncResult> {
  const {
    project,
    batchSize,
    enableBeads,
    enableLetta,
    dryRun,
    _phase = 'init',
    _accumulatedResult,
    _gitRepoPath,
    _beadsInitialized = false,
  } = input;

  log.info(`[ProjectSync] Processing: ${project.identifier}`, { phase: _phase });

  const result: ProjectSyncResult = _accumulatedResult || {
    projectIdentifier: project.identifier,
    projectName: project.name,
    success: false,
    beadsSync: { synced: 0, skipped: 0, errors: 0 },
    lettaUpdated: false,
  };

  let gitRepoPath = _gitRepoPath;
  let beadsInitialized = _beadsInitialized;

  try {
    // ── INIT: discover project, init beads, provision agent ──
    if (_phase === 'init') {
      gitRepoPath = extractGitRepoPath(project.description);

      if (enableBeads && gitRepoPath) {
        beadsInitialized = await initializeBeads({
          gitRepoPath,
          projectName: project.name,
          projectIdentifier: project.identifier,
        });
      }

      if (enableLetta && gitRepoPath) {
        try {
          const agentCheck = await checkAgentExists({
            projectIdentifier: project.identifier,
          });

          if (agentCheck.exists) {
            log.info(
              `[ProjectSync] Agent exists for ${project.identifier}, reconciling: ${agentCheck.agentId}`
            );
          } else {
            log.info(`[ProjectSync] Provisioning PM agent for ${project.identifier}...`);
          }

          const provisionResult = await executeChild(ProvisionSingleAgentWorkflow, {
            workflowId: `provision-${project.identifier}-${Date.now()}`,
            args: [
              {
                projectIdentifier: project.identifier,
                projectName: project.name,
                attachTools: true,
              },
            ],
          });

          if (provisionResult.success && provisionResult.agentId) {
            await updateProjectAgent({
              projectIdentifier: project.identifier,
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

      return await continueAsNew<typeof ProjectSyncWorkflow>({
        ...input,
        _phase: 'sync',
        _gitRepoPath: gitRepoPath,
        _beadsInitialized: beadsInitialized,
        _accumulatedResult: result,
      });
    }

    // ── SYNC: read beads issues, persist to registry DB ──
    if (_phase === 'sync') {
      if (enableBeads && beadsInitialized && gitRepoPath) {
        log.info(`[ProjectSync] Sync phase: reading beads issues`);

        const beadsIssues = await fetchBeadsIssues({ gitRepoPath });

        if (beadsIssues.length > 0 && !dryRun) {
          const persistenceBatch = beadsIssues.map(
            (issue: {
              id: string;
              title: string;
              status: string;
              priority?: number;
              description?: string;
              labels?: string[];
            }) => {
              const hulyLabel = issue.labels?.find((l: string) => l.startsWith('huly:'));
              const hulyIdentifier =
                hulyLabel?.replace('huly:', '') || `${project.identifier}-${issue.id}`;

              return {
                identifier: hulyIdentifier,
                projectIdentifier: project.identifier,
                title: issue.title,
                description: issue.description,
                status: issue.status,
                beadsIssueId: issue.id,
                beadsStatus: issue.status,
                beadsModifiedAt: Date.now(),
              };
            }
          );

          await persistIssueSyncStateBatch({ issues: persistenceBatch });
          result.beadsSync.synced = beadsIssues.length;
        } else {
          result.beadsSync.skipped = beadsIssues.length;
        }

        log.info(`[ProjectSync] Sync phase complete`, {
          synced: result.beadsSync.synced,
          skipped: result.beadsSync.skipped,
        });
      } else {
        log.info(`[ProjectSync] Sync phase: skipped (beads not initialized or disabled)`);
      }

      return await continueAsNew<typeof ProjectSyncWorkflow>({
        ...input,
        _phase: 'agent',
        _gitRepoPath: gitRepoPath,
        _beadsInitialized: beadsInitialized,
        _accumulatedResult: result,
      });
    }

    // ── AGENT: update Letta agent memory with latest issue summary ──
    if (_phase === 'agent') {
      if (enableLetta && !dryRun) {
        try {
          const beadsIssues =
            beadsInitialized && gitRepoPath ? await fetchBeadsIssues({ gitRepoPath }) : [];

          const issuesAsHulyShape = beadsIssues.map(
            (issue: {
              id: string;
              title: string;
              status: string;
              priority?: number;
              description?: string;
            }) => ({
              identifier: issue.id,
              title: issue.title,
              description: issue.description,
              status: issue.status,
            })
          );

          const agentCheck = await checkAgentExists({
            projectIdentifier: project.identifier,
          });

          if (agentCheck.exists && agentCheck.agentId) {
            const memResult = await updateLettaMemory({
              agentId: agentCheck.agentId,
              hulyProject: project,
              hulyIssues: issuesAsHulyShape,
              gitRepoPath: gitRepoPath || undefined,
            });
            result.lettaUpdated = memResult.success;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          log.warn(`[ProjectSync] Agent memory update failed: ${errorMsg}`);
        }
      }

      return await continueAsNew<typeof ProjectSyncWorkflow>({
        ...input,
        _phase: 'done',
        _gitRepoPath: gitRepoPath,
        _beadsInitialized: beadsInitialized,
        _accumulatedResult: result,
      });
    }

    // ── DONE: commit beads changes, finalize ──
    if (_phase === 'done') {
      if (!dryRun && beadsInitialized && gitRepoPath && result.beadsSync.synced > 0) {
        await commitBeadsToGit({
          context: {
            projectIdentifier: project.identifier,
            gitRepoPath,
          },
          message: `Sync from VibeSync: ${result.beadsSync.synced} issues`,
        });
      }

      result.success = true;

      log.info(`[ProjectSync] Complete: ${project.identifier}`, {
        beadsSync: result.beadsSync,
        lettaUpdated: result.lettaUpdated,
      });

      return result;
    }

    throw new Error(`Unknown phase: ${_phase}`);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'ContinueAsNew' ||
        error.message.includes('Workflow continued as new') ||
        error.message.includes('continueAsNew'))
    ) {
      throw error;
    }

    result.error = error instanceof Error ? error.message : String(error);
    log.error(`[ProjectSync] Failed: ${project.identifier}`, {
      error: result.error,
    });
    return result;
  }
}
