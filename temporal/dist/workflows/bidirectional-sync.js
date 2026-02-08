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
exports.HulyWebhookChangeWorkflow = exports.VibeSSEChangeWorkflow = exports.BeadsFileChangeWorkflow = void 0;
exports.BidirectionalSyncWorkflow = BidirectionalSyncWorkflow;
exports.SyncFromVibeWorkflow = SyncFromVibeWorkflow;
exports.SyncFromHulyWorkflow = SyncFromHulyWorkflow;
exports.SyncFromBeadsWorkflow = SyncFromBeadsWorkflow;
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
const { getVibeProjectId } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 3,
    },
});
const { persistIssueSyncState } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '60 seconds',
    retry: {
        initialInterval: '1 second',
        backoffCoefficient: 2,
        maximumInterval: '20 seconds',
        maximumAttempts: 3,
    },
});
function extractHulyIdentifierFromDescription(description) {
    if (!description)
        return null;
    const match = description.match(/(?:Synced from Huly|Huly Issue):\s*([A-Z]+-\d+)/i);
    return match ? match[1] : null;
}
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
        let persistenceIdentifier = null;
        if (source === 'huly') {
            persistenceIdentifier = issueData.id;
        }
        else if (source === 'beads') {
            persistenceIdentifier = linkedIds?.hulyId || result.results.huly?.id || null;
        }
        else if (source === 'vibe') {
            persistenceIdentifier =
                linkedIds?.hulyId ||
                    result.results.huly?.id ||
                    extractHulyIdentifierFromDescription(issueData.description);
        }
        if (persistenceIdentifier) {
            await persistIssueSyncState({
                identifier: persistenceIdentifier,
                projectIdentifier: context.projectIdentifier,
                title: issueData.title,
                description: issueData.description,
                status: issueData.status,
                hulyId: source === 'huly' ? issueData.id : undefined,
                vibeTaskId: source === 'vibe' ? issueData.id : result.results.vibe?.id || linkedIds?.vibeId,
                beadsIssueId: source === 'beads' ? issueData.id : result.results.beads?.id || linkedIds?.beadsId,
                hulyModifiedAt: source === 'huly' ? issueData.modifiedAt : undefined,
                vibeModifiedAt: source === 'vibe' ? issueData.modifiedAt : undefined,
                beadsModifiedAt: source === 'beads' ? issueData.modifiedAt : undefined,
                vibeStatus: source === 'vibe' ? issueData.status : undefined,
                beadsStatus: source === 'beads' ? issueData.status : undefined,
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
    // Determine Huly ID - either from linkedIds or extract from task description
    let hulyId = linkedIds?.hulyId;
    if (!hulyId && issueData.description) {
        // Extract from description: "Synced from Huly: PROJ-123" or "Huly Issue: PROJ-123"
        const hulyIdMatch = issueData.description.match(/(?:Synced from Huly|Huly Issue):\s*([A-Z]+-\d+)/i);
        if (hulyIdMatch) {
            hulyId = hulyIdMatch[1];
            workflow_1.log.info(`[syncFromVibe] Extracted hulyId from description: ${hulyId}`);
        }
    }
    // Vibe → Huly
    if (hulyId) {
        results.huly = await syncVibeToHuly({
            vibeTask: issueData,
            hulyIdentifier: hulyId,
            context,
        });
    }
    else {
        workflow_1.log.warn(`[syncFromVibe] No hulyId found for Vibe task ${issueData.id}, skipping Huly sync`);
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
    const hasComparableTargets = (source !== 'huly' && !!linkedIds.hulyId) ||
        (source !== 'vibe' && !!linkedIds.vibeId) ||
        (source !== 'beads' && !!linkedIds.beadsId && !!context.gitRepoPath);
    // Fast-path: if no comparable linked target exists, avoid extra reads.
    if (!hasComparableTargets) {
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
// ============================================================
// RE-EXPORTS FROM EVENT-SYNC MODULE
// ============================================================
var event_sync_1 = require("./event-sync");
Object.defineProperty(exports, "BeadsFileChangeWorkflow", { enumerable: true, get: function () { return event_sync_1.BeadsFileChangeWorkflow; } });
Object.defineProperty(exports, "VibeSSEChangeWorkflow", { enumerable: true, get: function () { return event_sync_1.VibeSSEChangeWorkflow; } });
Object.defineProperty(exports, "HulyWebhookChangeWorkflow", { enumerable: true, get: function () { return event_sync_1.HulyWebhookChangeWorkflow; } });
//# sourceMappingURL=bidirectional-sync.js.map