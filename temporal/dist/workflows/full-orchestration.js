"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.progressQuery = exports.cancelSignal = void 0;
exports.FullOrchestrationWorkflow = FullOrchestrationWorkflow;
exports.ScheduledSyncWorkflow = ScheduledSyncWorkflow;
const workflow_1 = require("@temporalio/workflow");
const project_sync_1 = require("./project-sync");
// ============================================================
// ACTIVITY PROXIES
// ============================================================
const { fetchRegistryProjects, recordSyncMetrics } = (0, workflow_1.proxyActivities)({
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
exports.cancelSignal = (0, workflow_1.defineSignal)('cancel');
exports.progressQuery = (0, workflow_1.defineQuery)('progress');
// ============================================================
// MAIN ORCHESTRATION WORKFLOW
// ============================================================
const MAX_PROJECTS_PER_CONTINUATION = 3;
async function FullOrchestrationWorkflow(input = {}) {
    const { projectIdentifier, batchSize = 5, enableLetta = true, dryRun = false, circuitBreakerThreshold = 3, _continueIndex = 0, _accumulatedResults = [], _accumulatedErrors = [], _originalStartTime, _projectFailures = {}, } = input;
    const startTime = _originalStartTime || Date.now();
    let cancelled = false;
    const projectFailures = { ..._projectFailures };
    const progress = {
        status: 'initializing',
        projectsTotal: 0,
        projectsCompleted: 0,
        issuesSynced: 0,
        errors: 0,
        startedAt: startTime,
        elapsedMs: 0,
    };
    (0, workflow_1.setHandler)(exports.cancelSignal, () => {
        cancelled = true;
        progress.status = 'cancelled';
    });
    (0, workflow_1.setHandler)(exports.progressQuery, () => ({
        ...progress,
        elapsedMs: Date.now() - startTime,
    }));
    const result = {
        success: false,
        projectsProcessed: _accumulatedResults.length,
        issuesSynced: 0,
        durationMs: 0,
        errors: [..._accumulatedErrors],
        projectResults: [..._accumulatedResults],
    };
    try {
        workflow_1.log.info('[FullOrchestration] Starting full sync', {
            projectIdentifier,
            enableLetta,
            dryRun,
            continueIndex: _continueIndex,
            accumulatedProjects: _accumulatedResults.length,
        });
        // Init: load project list from registry
        progress.status = 'fetching';
        const registryProjects = await fetchRegistryProjects();
        workflow_1.log.info('[FullOrchestration] Loaded registry projects', {
            count: registryProjects.length,
        });
        let projectsToSync = registryProjects;
        if (projectIdentifier) {
            projectsToSync = registryProjects.filter((p) => p.identifier === projectIdentifier || p.name === projectIdentifier);
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
                workflow_1.log.info('[FullOrchestration] Cancelled by signal');
                break;
            }
            progress.currentProject = project.identifier;
            const failureCount = projectFailures[project.identifier] || 0;
            if (failureCount >= circuitBreakerThreshold) {
                workflow_1.log.warn('[FullOrchestration] Circuit breaker: skipping project due to consecutive failures', { project: project.identifier, failureCount, threshold: circuitBreakerThreshold });
                const skippedResult = {
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
            const projectResult = await (0, workflow_1.executeChild)(project_sync_1.ProjectSyncWorkflow, {
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
            }
            else {
                projectFailures[project.identifier] = 0;
            }
            projectsProcessedThisRun++;
            const nextIdx = idx + 1;
            const hasMoreProjects = nextIdx < projectsToSync.length;
            if (hasMoreProjects && projectsProcessedThisRun >= MAX_PROJECTS_PER_CONTINUATION) {
                workflow_1.log.info('[FullOrchestration] Continuing as new workflow to reset history', {
                    processedThisRun: projectsProcessedThisRun,
                    totalProcessed: result.projectResults.length,
                    remaining: projectsToSync.length - nextIdx,
                    nextIndex: nextIdx,
                });
                await (0, workflow_1.continueAsNew)({
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
            await (0, workflow_1.sleep)('500 milliseconds');
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
        workflow_1.log.info('[FullOrchestration] Sync complete', {
            projects: result.projectsProcessed,
            issues: result.issuesSynced,
            duration: `${(result.durationMs / 1000).toFixed(2)}s`,
            errors: result.errors.length,
        });
        return result;
    }
    catch (error) {
        result.durationMs = Date.now() - startTime;
        result.errors.push(error instanceof Error ? error.message : String(error));
        workflow_1.log.error('[FullOrchestration] Sync failed', {
            error: result.errors[result.errors.length - 1],
        });
        throw error;
    }
}
// ============================================================
// SCHEDULED SYNC WORKFLOW
// ============================================================
async function ScheduledSyncWorkflow(input) {
    const { intervalMinutes, maxIterations = Infinity, syncOptions = {} } = input;
    let iteration = 0;
    workflow_1.log.info('[ScheduledSync] Starting scheduled sync', {
        intervalMinutes,
        maxIterations,
    });
    while (iteration < maxIterations) {
        iteration++;
        workflow_1.log.info(`[ScheduledSync] Running iteration ${iteration}`);
        try {
            await (0, workflow_1.executeChild)(FullOrchestrationWorkflow, {
                workflowId: `full-sync-scheduled-${Date.now()}`,
                args: [syncOptions],
            });
        }
        catch (error) {
            workflow_1.log.error('[ScheduledSync] Sync iteration failed', {
                iteration,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        workflow_1.log.info(`[ScheduledSync] Sleeping for ${intervalMinutes} minutes`);
        await (0, workflow_1.sleep)(`${intervalMinutes} minutes`);
    }
    workflow_1.log.info('[ScheduledSync] Completed all iterations');
}
//# sourceMappingURL=full-orchestration.js.map