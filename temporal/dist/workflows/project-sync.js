"use strict";
/**
 * Project Sync Workflow
 *
 * Handles syncing a single project with continueAsNew for large issue counts.
 * This prevents workflow history overflow for projects with many issues.
 *
 * Multi-phase execution: init → phase1 → phase2 → phase3 → phase3b → phase3c → done
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectSyncWorkflow = ProjectSyncWorkflow;
const workflow_1 = require("@temporalio/workflow");
const agent_provisioning_1 = require("./agent-provisioning");
// ============================================================
// ACTIVITY PROXIES
// ============================================================
const { ensureVibeProject, fetchProjectData, initializeBeads, fetchBeadsIssues } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 3,
    },
});
const { syncIssueToBeads, syncBeadsToHulyBatch, createBeadsIssueInHuly, commitBeadsToGit } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 5,
        nonRetryableErrorTypes: ['HulyValidationError', 'VibeValidationError'],
    },
});
const { persistIssueSyncState, persistIssueSyncStateBatch, getIssueSyncStateBatch } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '60 seconds',
    retry: {
        initialInterval: '1 second',
        backoffCoefficient: 2,
        maximumInterval: '20 seconds',
        maximumAttempts: 3,
    },
});
const { checkAgentExists, updateProjectAgent } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '60 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '30 seconds',
        maximumAttempts: 3,
    },
});
function getStatusRank(status) {
    switch (status) {
        case 'Backlog':
        case 'open':
            return 0;
        case 'Todo':
            return 1;
        case 'In Progress':
        case 'in_progress':
            return 2;
        case 'In Review':
            return 3;
        case 'Done':
        case 'Cancelled':
        case 'Canceled':
        case 'closed':
            return 4;
        default:
            return -1;
    }
}
function beadsStatusToHuly(beadsStatus, labels = []) {
    const hasLabel = (label) => labels.includes(label);
    switch (beadsStatus) {
        case 'open':
            return hasLabel('huly:Todo') ? 'Todo' : 'Backlog';
        case 'in_progress':
            return hasLabel('huly:In Review') ? 'In Review' : 'In Progress';
        case 'blocked':
            return 'In Progress';
        case 'deferred':
            return 'Backlog';
        case 'closed':
            return hasLabel('huly:Canceled') ? 'Canceled' : 'Done';
        default:
            return 'Backlog';
    }
}
function extractGitRepoPath(description) {
    if (!description)
        return null;
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
            if (path.startsWith('/'))
                return path;
        }
    }
    return null;
}
// Maximum issues to process before calling continueAsNew
const MAX_ISSUES_PER_CONTINUATION = 100;
/**
 * ProjectSyncWorkflow
 *
 * Handles syncing a single project with continueAsNew for large issue counts.
 * This prevents workflow history overflow for projects like LTSEL with 990 issues.
 */
async function ProjectSyncWorkflow(input) {
    const { hulyProject, vibeProjects, batchSize, enableBeads, enableLetta, dryRun, prefetchedIssues, prefetchedIssuesAreComplete = true, 
    // Continuation state
    _phase = 'init', _phase1Index = 0, _phase2Index = 0, _phase3Index = 0, _accumulatedResult, _vibeProjectId, _gitRepoPath, _beadsInitialized = false, _phase1UpdatedTasks = [], } = input;
    workflow_1.log.info(`[ProjectSync] Processing: ${hulyProject.identifier}`, {
        phase: _phase,
        phase1Index: _phase1Index,
        phase2Index: _phase2Index,
        phase3Index: _phase3Index,
    });
    // Initialize or restore result
    const result = _accumulatedResult || {
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
                        workflow_1.log.info(`[ProjectSync] Agent exists for ${hulyProject.identifier}, reconciling tools/memory: ${agentCheck.agentId}`);
                    }
                    else {
                        workflow_1.log.info(`[ProjectSync] Provisioning PM agent for ${hulyProject.identifier}...`);
                    }
                    const provisionResult = await (0, workflow_1.executeChild)(agent_provisioning_1.ProvisionSingleAgentWorkflow, {
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
                        workflow_1.log.info(`[ProjectSync] PM agent reconciled: ${provisionResult.agentId}`);
                    }
                    else if (!provisionResult.success) {
                        workflow_1.log.warn(`[ProjectSync] Agent provisioning failed: ${provisionResult.error}`);
                    }
                }
                catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    workflow_1.log.warn(`[ProjectSync] Agent provisioning failed, continuing sync: ${errorMsg}`);
                }
            }
            // Continue to phase1
            return await (0, workflow_1.continueAsNew)({
                ...input,
                _phase: 'phase1',
                _vibeProjectId: vibeProjectId,
                _gitRepoPath: gitRepoPath,
                _beadsInitialized: beadsInitialized,
                _accumulatedResult: result,
            });
        }
        let hulyIssues;
        if (prefetchedIssues && prefetchedIssues.length > 0) {
            hulyIssues = prefetchedIssues;
            workflow_1.log.info(`[ProjectSync] Using ${prefetchedIssues.length} prefetched issues`);
        }
        else {
            const projectData = await fetchProjectData({
                hulyProject,
                vibeProjectId: vibeProjectId,
            });
            hulyIssues = projectData.hulyIssues;
        }
        // PHASE 1: Huly → Vibe (SKIPPED — VibeKanban removed)
        if (_phase === 'phase1') {
            workflow_1.log.info(`[ProjectSync] Phase 1: Skipped (VK disabled) — ${hulyIssues.length} issues`);
            result.phase1.skipped = hulyIssues.length;
            return await (0, workflow_1.continueAsNew)({
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
        // PHASE 2: Vibe → Huly (SKIPPED — VibeKanban removed, vibeTasks always empty)
        if (_phase === 'phase2') {
            workflow_1.log.info(`[ProjectSync] Phase 2: Skipped (VK disabled)`);
            if (enableBeads && beadsInitialized && gitRepoPath) {
                return await (0, workflow_1.continueAsNew)({
                    ...input,
                    _phase: 'phase3',
                    _phase2Index: 0,
                    _vibeProjectId: vibeProjectId,
                    _gitRepoPath: gitRepoPath,
                    _beadsInitialized: beadsInitialized,
                    _accumulatedResult: result,
                    _phase1UpdatedTasks: Array.from(phase1UpdatedTasks),
                });
            }
            else {
                return await (0, workflow_1.continueAsNew)({
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
            workflow_1.log.info(`[ProjectSync] Phase 3: Beads sync (starting at ${_phase3Index})`);
            if (!result.phase3) {
                result.phase3 = { synced: 0, skipped: 0, errors: 0 };
            }
            let beadsIssues = await fetchBeadsIssues({ gitRepoPath: gitRepoPath });
            for (let i = _phase3Index; i < hulyIssues.length; i += effectiveBatchSize) {
                const batch = hulyIssues.slice(i, Math.min(i + effectiveBatchSize, hulyIssues.length));
                const seenTitles = new Set();
                const batchResults = [];
                const persistenceBatch = [];
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
                            vibeProjectId: vibeProjectId,
                            gitRepoPath: gitRepoPath,
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
                beadsIssues = await fetchBeadsIssues({ gitRepoPath: gitRepoPath });
                for (const r of batchResults) {
                    if (r.skipped)
                        result.phase3.skipped++;
                    else if (r.success)
                        result.phase3.synced++;
                    else
                        result.phase3.errors++;
                }
                issuesProcessedThisRun += batch.length;
                // Check if we need to continue as new
                const nextIndex = i + effectiveBatchSize;
                if (issuesProcessedThisRun >= MAX_ISSUES_PER_CONTINUATION &&
                    nextIndex < hulyIssues.length) {
                    workflow_1.log.info(`[ProjectSync] Phase 3 continuing as new at index ${nextIndex}`);
                    return await (0, workflow_1.continueAsNew)({
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
            if (!dryRun && result.phase3.synced > 0) {
                await commitBeadsToGit({
                    context: {
                        projectIdentifier: hulyProject.identifier,
                        vibeProjectId: vibeProjectId,
                        gitRepoPath: gitRepoPath,
                    },
                    message: `Sync from VibeSync: ${result.phase3.synced} issues`,
                });
            }
            return await (0, workflow_1.continueAsNew)({
                ...input,
                _phase: 'phase3b',
                _vibeProjectId: vibeProjectId,
                _gitRepoPath: gitRepoPath,
                _beadsInitialized: beadsInitialized,
                _accumulatedResult: result,
            });
        }
        if (_phase === 'phase3b') {
            workflow_1.log.info(`[ProjectSync] Phase 3b: Beads→Huly sync`);
            const beadsIssues = await fetchBeadsIssues({ gitRepoPath: gitRepoPath });
            let beadsSynced = 0;
            let beadsCreated = 0;
            let beadsSkipped = 0;
            if (dryRun) {
                beadsSkipped = beadsIssues.length;
            }
            else {
                const toSync = [];
                const toCreate = [];
                for (const beadsIssue of beadsIssues) {
                    const hulyLabels = beadsIssue.labels?.filter(l => l.startsWith('huly:')) ?? [];
                    if (hulyLabels.length > 0) {
                        for (const label of hulyLabels) {
                            toSync.push({
                                beadsId: beadsIssue.id,
                                hulyIdentifier: label.replace('huly:', ''),
                                status: beadsIssue.status,
                                title: beadsIssue.title,
                                description: beadsIssue.description,
                            });
                        }
                    }
                    else {
                        toCreate.push(beadsIssue);
                    }
                }
                if (toSync.length > 0) {
                    // Status hierarchy guard: filter out issues that would regress Huly status
                    const syncStateMap = await getIssueSyncStateBatch({
                        hulyIdentifiers: toSync.map(i => i.hulyIdentifier),
                    });
                    const safeToSync = toSync.filter(item => {
                        const current = syncStateMap[item.hulyIdentifier];
                        if (!current?.status)
                            return true;
                        const targetRank = getStatusRank(beadsStatusToHuly(item.status));
                        const currentRank = getStatusRank(current.status);
                        if (currentRank >= 0 && targetRank < currentRank) {
                            beadsSkipped++;
                            return false;
                        }
                        return true;
                    });
                    workflow_1.log.info(`[ProjectSync] Phase 3b: Batch syncing ${safeToSync.length} issues to Huly (${toSync.length - safeToSync.length} skipped as regressions)`);
                    try {
                        const batchResult = await syncBeadsToHulyBatch({
                            beadsIssues: safeToSync,
                            context: {
                                projectIdentifier: hulyProject.identifier,
                                vibeProjectId: vibeProjectId,
                                gitRepoPath: gitRepoPath,
                            },
                        });
                        beadsSynced = batchResult.updated;
                        beadsSkipped += batchResult.failed;
                        if (batchResult.errors.length > 0) {
                            workflow_1.log.warn(`[ProjectSync] Phase 3b batch errors`, {
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
                    }
                    catch (error) {
                        workflow_1.log.warn(`[ProjectSync] Phase 3b batch sync failed`, {
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
                                vibeProjectId: vibeProjectId,
                                gitRepoPath: gitRepoPath,
                            },
                        });
                        if (createResult.created) {
                            beadsCreated++;
                            workflow_1.log.info(`[ProjectSync] Created Huly issue ${createResult.hulyIdentifier} from ${beadsIssue.id}`);
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
                        else {
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
                    }
                    catch (error) {
                        workflow_1.log.warn(`[ProjectSync] Phase 3b create error for ${beadsIssue.id}`, {
                            error: error instanceof Error ? error.message : String(error),
                        });
                        beadsSkipped++;
                    }
                    await (0, workflow_1.sleep)('100ms');
                }
            }
            workflow_1.log.info(`[ProjectSync] Phase 3b complete`, {
                synced: beadsSynced,
                created: beadsCreated,
                skipped: beadsSkipped,
            });
            return await (0, workflow_1.continueAsNew)({
                ...input,
                _phase: 'phase3c',
                _vibeProjectId: vibeProjectId,
                _gitRepoPath: gitRepoPath,
                _beadsInitialized: beadsInitialized,
                _accumulatedResult: result,
            });
        }
        if (_phase === 'phase3c') {
            workflow_1.log.info(`[ProjectSync] Phase 3c: Skipped (VK disabled)`);
            return await (0, workflow_1.continueAsNew)({
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
            workflow_1.log.info(`[ProjectSync] Complete: ${hulyProject.identifier}`, {
                phase1: result.phase1,
                phase2: result.phase2,
                phase3: result.phase3,
            });
            return result;
        }
        // Should never reach here
        throw new Error(`Unknown phase: ${_phase}`);
    }
    catch (error) {
        // IMPORTANT: ContinueAsNew throws an exception that must be propagated
        if (error instanceof Error &&
            (error.name === 'ContinueAsNew' ||
                error.message.includes('Workflow continued as new') ||
                error.message.includes('continueAsNew'))) {
            throw error;
        }
        result.error = error instanceof Error ? error.message : String(error);
        workflow_1.log.error(`[ProjectSync] Failed: ${hulyProject.identifier}`, {
            error: result.error,
        });
        return result;
    }
}
//# sourceMappingURL=project-sync.js.map