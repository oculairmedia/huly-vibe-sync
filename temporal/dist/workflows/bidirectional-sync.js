"use strict";
/**
 * Bidirectional Sync Workflows
 *
 * Full bidirectional sync between Huly, Vibe, and Beads.
 * "Most recent change wins" conflict resolution.
 *
 * When any system updates:
 * - Vibe updates → sync to Huly + Beads
 * - Beads updates → sync to Huly + Vibe
 * - Huly updates → sync to Vibe + Beads
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BidirectionalSyncWorkflow = BidirectionalSyncWorkflow;
exports.SyncFromVibeWorkflow = SyncFromVibeWorkflow;
exports.SyncFromHulyWorkflow = SyncFromHulyWorkflow;
exports.SyncFromBeadsWorkflow = SyncFromBeadsWorkflow;
exports.BeadsFileChangeWorkflow = BeadsFileChangeWorkflow;
exports.VibeSSEChangeWorkflow = VibeSSEChangeWorkflow;
exports.HulyWebhookChangeWorkflow = HulyWebhookChangeWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { syncVibeToHuly, syncVibeToBeads, syncBeadsToHuly, syncBeadsToVibe, syncHulyToVibe, syncHulyToBeads, getVibeTask, getHulyIssue, getBeadsIssue, commitBeadsChanges, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 5,
        nonRetryableErrorTypes: ['ValidationError', 'NotFoundError', 'ConflictError'],
    },
});
const { fetchBeadsIssues, getVibeProjectId } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 3,
    },
});
const { resolveGitRepoPath } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 seconds',
    retry: {
        initialInterval: '1 second',
        backoffCoefficient: 2,
        maximumInterval: '5 seconds',
        maximumAttempts: 2,
    },
});
// ============================================================
// MAIN BIDIRECTIONAL SYNC WORKFLOW
// ============================================================
/**
 * BidirectionalSyncWorkflow
 *
 * Syncs changes from one system to the other two.
 * Uses "most recent wins" for conflict resolution.
 */
async function BidirectionalSyncWorkflow(input) {
    const { source, issueData, context, linkedIds } = input;
    workflow_1.log.info(`[BidirectionalSync] Starting: ${source} → others`, {
        issueId: issueData.id,
        title: issueData.title,
        modifiedAt: issueData.modifiedAt,
    });
    const result = {
        success: false,
        source,
        results: {},
    };
    try {
        // Check for conflicts with linked issues
        const conflictCheck = await checkForConflicts(source, issueData, linkedIds, context);
        if (conflictCheck.hasConflict && !conflictCheck.sourceWins) {
            // Another system has a more recent change - skip this sync
            workflow_1.log.info(`[BidirectionalSync] Skipping - ${conflictCheck.winner} has newer data`, {
                sourceTimestamp: issueData.modifiedAt,
                winnerTimestamp: conflictCheck.winnerTimestamp,
            });
            result.success = true;
            result.conflictResolution = {
                winner: conflictCheck.winner,
                winnerTimestamp: conflictCheck.winnerTimestamp,
                loserTimestamp: issueData.modifiedAt,
            };
            return result;
        }
        // Sync to other systems based on source
        switch (source) {
            case 'vibe':
                result.results = await syncFromVibe(issueData, context, linkedIds);
                break;
            case 'huly':
                result.results = await syncFromHuly(issueData, context, linkedIds);
                break;
            case 'beads':
                result.results = await syncFromBeads(issueData, context, linkedIds);
                break;
        }
        // Commit Beads changes if we synced to Beads
        if (result.results.beads?.success && context.gitRepoPath) {
            await commitBeadsChanges({
                gitRepoPath: context.gitRepoPath,
                message: `Sync from ${source}: ${issueData.title}`,
            });
        }
        result.success = true;
        workflow_1.log.info(`[BidirectionalSync] Complete: ${source} → others`, {
            huly: result.results.huly?.success,
            vibe: result.results.vibe?.success,
            beads: result.results.beads?.success,
        });
        return result;
    }
    catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        workflow_1.log.error(`[BidirectionalSync] Failed`, { error: result.error });
        throw error;
    }
}
// ============================================================
// SYNC FROM EACH SOURCE
// ============================================================
async function syncFromVibe(issueData, context, linkedIds) {
    const results = {};
    // Vibe → Huly
    if (linkedIds?.hulyId) {
        results.huly = await syncVibeToHuly({
            vibeTask: issueData,
            hulyIdentifier: linkedIds.hulyId,
            context,
        });
    }
    // Vibe → Beads
    if (context.gitRepoPath) {
        results.beads = await syncVibeToBeads({
            vibeTask: issueData,
            existingBeadsId: linkedIds?.beadsId,
            context,
        });
    }
    return results;
}
async function syncFromHuly(issueData, context, linkedIds) {
    const results = {};
    // Huly → Vibe
    results.vibe = await syncHulyToVibe({
        hulyIssue: issueData,
        existingVibeId: linkedIds?.vibeId,
        context,
    });
    // Huly → Beads
    if (context.gitRepoPath) {
        results.beads = await syncHulyToBeads({
            hulyIssue: issueData,
            existingBeadsId: linkedIds?.beadsId,
            context,
        });
    }
    return results;
}
async function syncFromBeads(issueData, context, linkedIds) {
    const results = {};
    // Beads → Huly
    if (linkedIds?.hulyId) {
        results.huly = await syncBeadsToHuly({
            beadsIssue: issueData,
            hulyIdentifier: linkedIds.hulyId,
            context,
        });
    }
    // Beads → Vibe
    if (linkedIds?.vibeId) {
        results.vibe = await syncBeadsToVibe({
            beadsIssue: issueData,
            vibeTaskId: linkedIds.vibeId,
            context,
        });
    }
    return results;
}
async function checkForConflicts(source, issueData, linkedIds, context) {
    if (!linkedIds) {
        return { hasConflict: false, sourceWins: true };
    }
    const timestamps = [
        { system: source, timestamp: issueData.modifiedAt },
    ];
    // Get timestamps from other systems
    try {
        if (source !== 'huly' && linkedIds.hulyId) {
            const hulyIssue = await getHulyIssue({ identifier: linkedIds.hulyId });
            if (hulyIssue?.modifiedOn) {
                timestamps.push({ system: 'huly', timestamp: hulyIssue.modifiedOn });
            }
        }
        if (source !== 'vibe' && linkedIds.vibeId) {
            const vibeTask = await getVibeTask({ taskId: linkedIds.vibeId });
            if (vibeTask?.updated_at) {
                timestamps.push({
                    system: 'vibe',
                    timestamp: new Date(vibeTask.updated_at).getTime(),
                });
            }
        }
        if (source !== 'beads' && linkedIds.beadsId && context.gitRepoPath) {
            const beadsIssue = await getBeadsIssue({
                issueId: linkedIds.beadsId,
                gitRepoPath: context.gitRepoPath,
            });
            if (beadsIssue?.updated_at) {
                timestamps.push({
                    system: 'beads',
                    timestamp: new Date(beadsIssue.updated_at).getTime(),
                });
            }
        }
    }
    catch (error) {
        // If we can't get timestamps, proceed with sync (source wins)
        workflow_1.log.warn(`[ConflictCheck] Error getting timestamps, proceeding with sync`, {
            error: error instanceof Error ? error.message : String(error),
        });
        return { hasConflict: false, sourceWins: true };
    }
    // Find the most recent change
    timestamps.sort((a, b) => b.timestamp - a.timestamp);
    const winner = timestamps[0];
    if (winner.system === source) {
        return { hasConflict: false, sourceWins: true };
    }
    // Check if difference is significant (> 1 second to avoid race conditions)
    const timeDiff = winner.timestamp - issueData.modifiedAt;
    if (timeDiff > 1000) {
        return {
            hasConflict: true,
            sourceWins: false,
            winner: winner.system,
            winnerTimestamp: winner.timestamp,
        };
    }
    // Close timestamps - source wins (first come, first served)
    return { hasConflict: false, sourceWins: true };
}
// ============================================================
// CONVENIENCE WORKFLOWS
// ============================================================
/**
 * SyncFromVibeWorkflow - Triggered when Vibe task changes
 */
async function SyncFromVibeWorkflow(input) {
    const vibeTask = await getVibeTask({ taskId: input.vibeTaskId });
    if (!vibeTask) {
        throw workflow_1.ApplicationFailure.nonRetryable(`Vibe task not found: ${input.vibeTaskId}`, 'NotFoundError');
    }
    return BidirectionalSyncWorkflow({
        source: 'vibe',
        issueData: {
            id: vibeTask.id,
            title: vibeTask.title,
            description: vibeTask.description,
            status: vibeTask.status,
            modifiedAt: vibeTask.updated_at ? new Date(vibeTask.updated_at).getTime() : Date.now(),
        },
        context: input.context,
        linkedIds: {
            vibeId: vibeTask.id,
            ...input.linkedIds,
        },
    });
}
async function SyncFromHulyWorkflow(input) {
    const hulyIssue = await getHulyIssue({ identifier: input.hulyIdentifier });
    if (!hulyIssue) {
        throw workflow_1.ApplicationFailure.nonRetryable(`Huly issue not found: ${input.hulyIdentifier}`, 'NotFoundError');
    }
    let vibeProjectId = input.context.vibeProjectId;
    if (!vibeProjectId) {
        vibeProjectId = (await getVibeProjectId(input.context.projectIdentifier)) || '';
        if (!vibeProjectId) {
            workflow_1.log.warn('[SyncFromHuly] No Vibe project found, skipping Vibe sync', {
                hulyProject: input.context.projectIdentifier,
            });
        }
    }
    return BidirectionalSyncWorkflow({
        source: 'huly',
        issueData: {
            id: hulyIssue.identifier,
            title: hulyIssue.title,
            description: hulyIssue.description,
            status: hulyIssue.status,
            priority: hulyIssue.priority,
            modifiedAt: hulyIssue.modifiedOn || Date.now(),
        },
        context: {
            ...input.context,
            vibeProjectId,
        },
        linkedIds: {
            hulyId: hulyIssue.identifier,
            ...input.linkedIds,
        },
    });
}
/**
 * SyncFromBeadsWorkflow - Triggered when Beads issue changes
 */
async function SyncFromBeadsWorkflow(input) {
    if (!input.context.gitRepoPath) {
        throw workflow_1.ApplicationFailure.nonRetryable('gitRepoPath required for Beads sync', 'ValidationError');
    }
    const beadsIssue = await getBeadsIssue({
        issueId: input.beadsIssueId,
        gitRepoPath: input.context.gitRepoPath,
    });
    if (!beadsIssue) {
        throw workflow_1.ApplicationFailure.nonRetryable(`Beads issue not found: ${input.beadsIssueId}`, 'NotFoundError');
    }
    return BidirectionalSyncWorkflow({
        source: 'beads',
        issueData: {
            id: beadsIssue.id,
            title: beadsIssue.title,
            description: beadsIssue.description,
            status: beadsIssue.status,
            priority: beadsIssue.priority?.toString(),
            modifiedAt: beadsIssue.updated_at ? new Date(beadsIssue.updated_at).getTime() : Date.now(),
        },
        context: input.context,
        linkedIds: {
            beadsId: beadsIssue.id,
            ...input.linkedIds,
        },
    });
}
/**
 * BeadsFileChangeWorkflow - Triggered when .beads files change
 *
 * This workflow is the durable replacement for BeadsWatcher callbacks.
 * It fetches all Beads issues and syncs each one to Huly and Vibe.
 *
 * Benefits over in-memory callback:
 * - Durable: survives crashes and restarts
 * - Retryable: automatic retry with exponential backoff
 * - Observable: visible in Temporal UI
 * - Resumable: picks up where it left off after failure
 */
async function BeadsFileChangeWorkflow(input) {
    const { projectIdentifier, gitRepoPath, changedFiles } = input;
    workflow_1.log.info('[BeadsFileChange] Starting workflow', {
        project: projectIdentifier,
        fileCount: changedFiles.length,
    });
    const result = {
        success: false,
        issuesProcessed: 0,
        issuesSynced: 0,
        errors: [],
    };
    try {
        // Fetch all Beads issues from the repository
        const beadsIssues = await fetchBeadsIssues({ gitRepoPath });
        if (beadsIssues.length === 0) {
            workflow_1.log.info('[BeadsFileChange] No Beads issues found');
            result.success = true;
            return result;
        }
        workflow_1.log.info('[BeadsFileChange] Found issues to sync', {
            count: beadsIssues.length,
        });
        result.issuesProcessed = beadsIssues.length;
        // For each Beads issue with a huly: label, sync status to Huly
        for (const beadsIssue of beadsIssues) {
            try {
                // Extract Huly identifier from labels (format: huly:PROJ-123)
                const hulyLabel = beadsIssue.labels?.find(l => l.startsWith('huly:'));
                if (!hulyLabel) {
                    workflow_1.log.info('[BeadsFileChange] Skipping issue without huly label', {
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
                    workflow_1.log.warn('[BeadsFileChange] Issue not found', { issueId: beadsIssue.id });
                    continue;
                }
                workflow_1.log.info('[BeadsFileChange] Syncing Beads→Huly', {
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
                    workflow_1.log.info('[BeadsFileChange] Synced to Huly', {
                        beadsId: fullIssue.id,
                        hulyId: hulyIdentifier,
                    });
                    result.issuesSynced++;
                }
                else {
                    workflow_1.log.warn('[BeadsFileChange] Sync to Huly failed', {
                        beadsId: fullIssue.id,
                        error: syncResult.error,
                    });
                    if (syncResult.error) {
                        result.errors.push({ issueId: beadsIssue.id, error: syncResult.error });
                    }
                }
                // Small delay between issues to avoid overwhelming APIs
                await (0, workflow_1.sleep)('200ms');
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                workflow_1.log.error('[BeadsFileChange] Failed to process issue', {
                    issueId: beadsIssue.id,
                    error: errorMsg,
                });
                result.errors.push({ issueId: beadsIssue.id, error: errorMsg });
            }
        }
        result.success = result.errors.length === 0;
        workflow_1.log.info('[BeadsFileChange] Workflow complete', {
            processed: result.issuesProcessed,
            synced: result.issuesSynced,
            errors: result.errors.length,
        });
        return result;
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        workflow_1.log.error('[BeadsFileChange] Workflow failed', { error: errorMsg });
        result.errors.push({ issueId: 'workflow', error: errorMsg });
        return result;
    }
}
/**
 * VibeSSEChangeWorkflow - Triggered by Vibe SSE events
 *
 * This workflow is the durable replacement for VibeEventWatcher callbacks.
 * It processes batch task changes from the SSE stream and syncs each to Huly.
 *
 * Benefits over in-memory callback:
 * - Durable: survives crashes and restarts
 * - Retryable: automatic retry with exponential backoff
 * - Observable: visible in Temporal UI
 * - Resumable: picks up where it left off after failure
 */
async function VibeSSEChangeWorkflow(input) {
    const { vibeProjectId, hulyProjectIdentifier, changedTaskIds } = input;
    workflow_1.log.info('[VibeSSEChange] Starting workflow', {
        vibeProject: vibeProjectId,
        hulyProject: hulyProjectIdentifier,
        taskCount: changedTaskIds.length,
    });
    const result = {
        success: false,
        tasksProcessed: 0,
        tasksSynced: 0,
        errors: [],
    };
    if (changedTaskIds.length === 0) {
        workflow_1.log.info('[VibeSSEChange] No tasks to process');
        result.success = true;
        return result;
    }
    result.tasksProcessed = changedTaskIds.length;
    // Build sync context
    const context = {
        projectIdentifier: hulyProjectIdentifier || '',
        vibeProjectId,
    };
    // Process each changed task
    for (const taskId of changedTaskIds) {
        try {
            // Get the task details from Vibe
            const vibeTask = await getVibeTask({ taskId });
            if (!vibeTask) {
                workflow_1.log.warn('[VibeSSEChange] Task not found', { taskId });
                result.errors.push({ taskId, error: 'Task not found' });
                continue;
            }
            workflow_1.log.info('[VibeSSEChange] Processing task', {
                taskId: vibeTask.id,
                title: vibeTask.title,
                status: vibeTask.status,
            });
            // Use SyncFromVibeWorkflow as child to handle the sync properly
            // This workflow handles linked ID lookup and bidirectional sync
            const syncResult = await (0, workflow_1.executeChild)(SyncFromVibeWorkflow, {
                args: [
                    {
                        vibeTaskId: taskId,
                        context,
                        // Note: linkedIds will be empty - sync relies on issue title matching
                        // or will be populated by the orchestrator's next sync cycle
                    },
                ],
                workflowId: `vibe-sse-sync-${vibeProjectId}-${taskId}-${Date.now()}`,
            });
            if (syncResult.success) {
                result.tasksSynced++;
                workflow_1.log.info('[VibeSSEChange] Task synced via SyncFromVibeWorkflow', {
                    taskId: vibeTask.id,
                    hulyResult: syncResult.results.huly,
                    beadsResult: syncResult.results.beads,
                });
            }
            else {
                workflow_1.log.warn('[VibeSSEChange] Task sync failed', {
                    taskId: vibeTask.id,
                    error: syncResult.error,
                });
                if (syncResult.error) {
                    result.errors.push({ taskId, error: syncResult.error });
                }
            }
            // Small delay between tasks to avoid overwhelming APIs
            await (0, workflow_1.sleep)('200ms');
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            workflow_1.log.error('[VibeSSEChange] Failed to process task', {
                taskId,
                error: errorMsg,
            });
            result.errors.push({ taskId, error: errorMsg });
        }
    }
    result.success = result.errors.length === 0;
    workflow_1.log.info('[VibeSSEChange] Workflow complete', {
        processed: result.tasksProcessed,
        synced: result.tasksSynced,
        errors: result.errors.length,
    });
    return result;
}
/**
 * HulyWebhookChangeWorkflow - Triggered by Huly webhook events
 *
 * This workflow is the durable replacement for HulyWebhookHandler callbacks.
 * It processes Huly change notifications and syncs to Vibe/Beads.
 *
 * Benefits over in-memory callback:
 * - Durable: survives crashes and restarts
 * - Retryable: automatic retry with exponential backoff
 * - Observable: visible in Temporal UI
 * - Resumable: picks up where it left off after failure
 */
async function HulyWebhookChangeWorkflow(input) {
    const { type, changes, timestamp } = input;
    workflow_1.log.info('[HulyWebhookChange] Starting workflow', {
        type,
        changeCount: changes.length,
        timestamp,
    });
    const result = {
        success: false,
        issuesProcessed: 0,
        issuesSynced: 0,
        errors: [],
    };
    if (changes.length === 0) {
        workflow_1.log.info('[HulyWebhookChange] No changes to process');
        result.success = true;
        return result;
    }
    // Filter to Issue class changes only
    const issueChanges = changes.filter(c => c.class === 'tracker:class:Issue');
    if (issueChanges.length === 0) {
        workflow_1.log.info('[HulyWebhookChange] No issue changes to process');
        result.success = true;
        return result;
    }
    result.issuesProcessed = issueChanges.length;
    // Process each issue change
    for (const change of issueChanges) {
        const issueId = change.data?.identifier || change.id;
        try {
            if (!issueId) {
                workflow_1.log.warn('[HulyWebhookChange] Change missing identifier', { change });
                result.errors.push({ issueId: 'unknown', error: 'Missing identifier' });
                continue;
            }
            workflow_1.log.info('[HulyWebhookChange] Processing issue', {
                identifier: issueId,
                status: change.data?.status,
                title: change.data?.title?.substring(0, 50),
            });
            // Extract project identifier from issue identifier (e.g., "PROJ-123" -> "PROJ")
            const projectIdentifier = issueId.split('-')[0];
            // Resolve gitRepoPath for Beads sync — non-blocking, null on failure
            let gitRepoPath;
            try {
                gitRepoPath = (await resolveGitRepoPath({ projectIdentifier })) || undefined;
            }
            catch (err) {
                workflow_1.log.warn('[HulyWebhookChange] gitRepoPath resolution failed, proceeding without Beads', {
                    projectIdentifier,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            const syncResult = await (0, workflow_1.executeChild)(SyncFromHulyWorkflow, {
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
                workflow_1.log.info('[HulyWebhookChange] Issue synced via SyncFromHulyWorkflow', {
                    identifier: issueId,
                    vibeResult: syncResult.results.vibe,
                    beadsResult: syncResult.results.beads,
                });
            }
            else {
                workflow_1.log.warn('[HulyWebhookChange] Issue sync failed', {
                    identifier: issueId,
                    error: syncResult.error,
                });
                if (syncResult.error) {
                    result.errors.push({ issueId, error: syncResult.error });
                }
            }
            // Small delay between issues to avoid overwhelming APIs
            await (0, workflow_1.sleep)('200ms');
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            workflow_1.log.error('[HulyWebhookChange] Failed to process issue', {
                issueId,
                error: errorMsg,
            });
            result.errors.push({ issueId: issueId || 'unknown', error: errorMsg });
        }
    }
    result.success = result.errors.length === 0;
    workflow_1.log.info('[HulyWebhookChange] Workflow complete', {
        processed: result.issuesProcessed,
        synced: result.issuesSynced,
        errors: result.errors.length,
    });
    return result;
}
//# sourceMappingURL=bidirectional-sync.js.map