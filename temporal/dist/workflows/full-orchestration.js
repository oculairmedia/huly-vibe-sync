"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.progressQuery = exports.cancelSignal = void 0;
exports.FullOrchestrationWorkflow = FullOrchestrationWorkflow;
exports.ScheduledSyncWorkflow = ScheduledSyncWorkflow;
const workflow_1 = require("@temporalio/workflow");
const project_sync_1 = require("./project-sync");
// ============================================================
// ACTIVITY PROXIES
// ============================================================
const { fetchHulyProjects, fetchVibeProjects, fetchHulyIssuesBulk, recordSyncMetrics, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 3,
    },
});
const { checkAgentExists } = (0, workflow_1.proxyActivities)({
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
exports.cancelSignal = (0, workflow_1.defineSignal)('cancel');
exports.progressQuery = (0, workflow_1.defineQuery)('progress');
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
async function FullOrchestrationWorkflow(input = {}) {
    const { projectIdentifier, batchSize = 5, enableBeads = true, enableLetta = true, dryRun = false, circuitBreakerThreshold = 3, _continueIndex = 0, _accumulatedResults = [], _accumulatedErrors = [], _originalStartTime, _projectFailures = {}, } = input;
    const startTime = _originalStartTime || Date.now();
    let cancelled = false;
    const projectFailures = { ..._projectFailures };
    // Progress tracking
    const progress = {
        status: 'initializing',
        projectsTotal: 0,
        projectsCompleted: 0,
        issuesSynced: 0,
        errors: 0,
        startedAt: startTime,
        elapsedMs: 0,
    };
    // Set up signal and query handlers
    (0, workflow_1.setHandler)(exports.cancelSignal, () => {
        cancelled = true;
        progress.status = 'cancelled';
    });
    (0, workflow_1.setHandler)(exports.progressQuery, () => ({
        ...progress,
        elapsedMs: Date.now() - startTime,
    }));
    // Initialize result with accumulated data from previous continuations
    const result = {
        success: false,
        projectsProcessed: _accumulatedResults.length,
        issuesSynced: _accumulatedResults.reduce((sum, r) => sum + r.phase1.synced + r.phase2.synced + (r.phase3?.synced || 0), 0),
        durationMs: 0,
        errors: [..._accumulatedErrors],
        projectResults: [..._accumulatedResults],
    };
    try {
        workflow_1.log.info('[FullOrchestration] Starting full sync', {
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
        workflow_1.log.info('[FullOrchestration] Fetched projects', {
            huly: hulyProjects.length,
            vibe: vibeProjects.length,
        });
        // Filter to specific project if requested
        let projectsToSync = hulyProjects;
        if (projectIdentifier) {
            projectsToSync = hulyProjects.filter(p => p.identifier === projectIdentifier || p.name === projectIdentifier);
            if (projectsToSync.length === 0) {
                throw new Error(`Project not found: ${projectIdentifier}`);
            }
        }
        progress.projectsTotal = projectsToSync.length;
        progress.projectsCompleted = _continueIndex;
        progress.status = 'syncing';
        // Bulk prefetch issues from all projects (7.4x faster than sequential)
        const projectIdentifiers = projectsToSync.map(p => p.identifier);
        let prefetchedIssuesByProject = {};
        try {
            prefetchedIssuesByProject = await fetchHulyIssuesBulk({
                projectIdentifiers,
                limit: 1000,
            });
            workflow_1.log.info('[FullOrchestration] Bulk prefetched issues', {
                projects: Object.keys(prefetchedIssuesByProject).length,
                totalIssues: Object.values(prefetchedIssuesByProject).reduce((sum, arr) => sum + arr.length, 0),
            });
        }
        catch (error) {
            workflow_1.log.warn('[FullOrchestration] Bulk prefetch failed, falling back to per-project fetch', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        // Track how many projects we process in this continuation
        let projectsProcessedThisRun = 0;
        // Process each project (starting from _continueIndex)
        for (let idx = _continueIndex; idx < projectsToSync.length; idx++) {
            const hulyProject = projectsToSync[idx];
            if (cancelled) {
                workflow_1.log.info('[FullOrchestration] Cancelled by signal');
                break;
            }
            progress.currentProject = hulyProject.identifier;
            // Circuit breaker: skip projects that have failed too many times
            const failureCount = projectFailures[hulyProject.identifier] || 0;
            if (failureCount >= circuitBreakerThreshold) {
                workflow_1.log.warn('[FullOrchestration] Circuit breaker: skipping project due to consecutive failures', {
                    project: hulyProject.identifier,
                    failureCount,
                    threshold: circuitBreakerThreshold,
                });
                // Record as skipped in results
                const skippedResult = {
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
            const projectResult = await (0, workflow_1.executeChild)(project_sync_1.ProjectSyncWorkflow, {
                workflowId: `project-sync-${hulyProject.identifier}-${Date.now()}`,
                args: [
                    {
                        hulyProject,
                        vibeProjects,
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
            }
            else {
                projectFailures[hulyProject.identifier] = 0;
            }
            projectsProcessedThisRun++;
            // Check if we need to continue as new (to prevent history overflow)
            const nextIdx = idx + 1;
            const hasMoreProjects = nextIdx < projectsToSync.length;
            if (hasMoreProjects && projectsProcessedThisRun >= MAX_PROJECTS_PER_CONTINUATION) {
                workflow_1.log.info('[FullOrchestration] Continuing as new workflow to reset history', {
                    processedThisRun: projectsProcessedThisRun,
                    totalProcessed: result.projectResults.length,
                    remaining: projectsToSync.length - nextIdx,
                    nextIndex: nextIdx,
                });
                // Continue as new with accumulated state
                await (0, workflow_1.continueAsNew)({
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
            await (0, workflow_1.sleep)('500 milliseconds');
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
/**
 * ScheduledSyncWorkflow
 *
 * Long-running workflow for periodic sync.
 * Replaces setInterval-based scheduling.
 */
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
            // Run full sync as child workflow
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
            // Continue to next iteration
        }
        // Wait for next interval
        workflow_1.log.info(`[ScheduledSync] Sleeping for ${intervalMinutes} minutes`);
        await (0, workflow_1.sleep)(`${intervalMinutes} minutes`);
    }
    workflow_1.log.info('[ScheduledSync] Completed all iterations');
}
//# sourceMappingURL=full-orchestration.js.map