"use strict";
/**
 * Event-Triggered Sync Workflows
 *
 * Workflows triggered by external events (Beads file changes, Vibe SSE, Huly webhooks).
 * These are durable replacements for in-memory event callbacks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BeadsFileChangeWorkflow = BeadsFileChangeWorkflow;
exports.VibeSSEChangeWorkflow = VibeSSEChangeWorkflow;
exports.HulyWebhookChangeWorkflow = HulyWebhookChangeWorkflow;
const workflow_1 = require("@temporalio/workflow");
const bidirectional_sync_1 = require("./bidirectional-sync");
const { syncBeadsToHuly, getBeadsIssue } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 5,
        nonRetryableErrorTypes: ['ValidationError', 'NotFoundError', 'ConflictError'],
    },
});
const { fetchBeadsIssues, resolveGitRepoPath } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 3,
    },
});
const { hasBeadsIssueChanged, persistIssueSyncState, getIssueSyncState } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '30 seconds',
    retry: {
        initialInterval: '1 second',
        backoffCoefficient: 2,
        maximumInterval: '10 seconds',
        maximumAttempts: 2,
    },
});
const { createBeadsIssueInHuly } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 5,
        nonRetryableErrorTypes: ['HulyValidationError'],
    },
});
// ============================================================
// BEADS FILE CHANGE WORKFLOW
// ============================================================
/**
 * Status hierarchy — higher rank = more advanced workflow state.
 * Beads→Huly sync must NEVER regress rank (e.g. In Progress → Backlog).
 * Handles both Huly and Beads status formats since the sync state DB
 * may store either depending on which path last wrote it.
 */
function getStatusRank(status) {
    switch (status) {
        // Huly statuses
        case 'Backlog':
            return 0;
        case 'Todo':
            return 1;
        case 'In Progress':
            return 2;
        case 'In Review':
            return 3;
        case 'Done':
        case 'Cancelled':
        case 'Canceled':
            return 4;
        // Beads statuses (stored when beads path last wrote sync state)
        case 'open':
            return 0;
        case 'in_progress':
            return 2;
        case 'closed':
            return 4;
        default:
            return -1; // Unknown — allow sync
    }
}
/**
 * Pure mapping of beads status → Huly status (duplicated from statusMapper
 * for Temporal workflow determinism — workflows can't import activity code).
 */
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
/**
 * BeadsFileChangeWorkflow - Triggered when .beads files change
 *
 * This workflow is the durable replacement for BeadsWatcher callbacks.
 * It fetches all Beads issues and syncs each one to Huly and Vibe.
 */
async function BeadsFileChangeWorkflow(input) {
    const { projectIdentifier, gitRepoPath, changedFiles } = input;
    workflow_1.log.info('[BeadsFileChange] Starting workflow', {
        project: projectIdentifier,
        fileCount: changedFiles.length,
        prefetchedIssues: input.beadsIssues?.length ?? 0,
    });
    const result = {
        success: false,
        issuesProcessed: 0,
        issuesSynced: 0,
        errors: [],
    };
    try {
        const beadsIssues = input.beadsIssues?.length
            ? input.beadsIssues
            : await fetchBeadsIssues({ gitRepoPath });
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
                    workflow_1.log.info('[BeadsFileChange] Creating Huly issue for unlinked beads issue', {
                        issueId: beadsIssue.id,
                        title: beadsIssue.title,
                    });
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
                            projectIdentifier,
                            vibeProjectId: input.vibeProjectId || '',
                            gitRepoPath,
                        },
                    });
                    if (createResult.created) {
                        workflow_1.log.info('[BeadsFileChange] Created Huly issue from beads', {
                            beadsId: beadsIssue.id,
                            hulyId: createResult.hulyIdentifier,
                        });
                        result.issuesSynced++;
                        if (createResult.hulyIdentifier) {
                            await persistIssueSyncState({
                                identifier: createResult.hulyIdentifier,
                                projectIdentifier,
                                title: beadsIssue.title,
                                description: beadsIssue.description,
                                status: beadsIssue.status,
                                beadsIssueId: beadsIssue.id,
                                beadsStatus: beadsIssue.status,
                                beadsModifiedAt: Date.now(),
                            });
                        }
                    }
                    else if (createResult.hulyIdentifier) {
                        workflow_1.log.info('[BeadsFileChange] Linked beads to existing Huly issue', {
                            beadsId: beadsIssue.id,
                            hulyId: createResult.hulyIdentifier,
                        });
                        result.issuesSynced++;
                        await persistIssueSyncState({
                            identifier: createResult.hulyIdentifier,
                            projectIdentifier,
                            title: beadsIssue.title,
                            description: beadsIssue.description,
                            status: beadsIssue.status,
                            beadsIssueId: beadsIssue.id,
                            beadsStatus: beadsIssue.status,
                            beadsModifiedAt: Date.now(),
                        });
                    }
                    else {
                        workflow_1.log.warn('[BeadsFileChange] Failed to create Huly issue', {
                            beadsId: beadsIssue.id,
                        });
                    }
                    await (0, workflow_1.sleep)('200ms');
                    continue;
                }
                const hulyIdentifier = hulyLabel.replace('huly:', '');
                const syncedState = await getIssueSyncState({ hulyIdentifier });
                if (!syncedState) {
                    // First time seeing this issue — record baseline, don't sync
                    await persistIssueSyncState({
                        identifier: hulyIdentifier,
                        projectIdentifier,
                        title: beadsIssue.title,
                        description: beadsIssue.description,
                        status: beadsStatusToHuly(beadsIssue.status, beadsIssue.labels || []),
                        beadsIssueId: beadsIssue.id,
                        beadsStatus: beadsIssue.status,
                        beadsModifiedAt: Date.now(),
                    });
                    result.issuesSynced++;
                    continue;
                }
                const changed = await hasBeadsIssueChanged({
                    hulyIdentifier,
                    title: beadsIssue.title,
                    description: beadsIssue.description,
                    status: beadsIssue.status,
                });
                if (!changed) {
                    result.issuesSynced++;
                    continue;
                }
                // Status hierarchy guard: never regress Huly status to a lower rank
                const targetHulyStatus = beadsStatusToHuly(beadsIssue.status, beadsIssue.labels || []);
                const currentRank = getStatusRank(syncedState.status);
                const targetRank = getStatusRank(targetHulyStatus);
                if (currentRank >= 0 && targetRank < currentRank) {
                    workflow_1.log.info('[BeadsFileChange] Skipping: would regress Huly status', {
                        issueId: beadsIssue.id,
                        hulyId: hulyIdentifier,
                        currentStatus: syncedState.status,
                        targetStatus: targetHulyStatus,
                        beadsStatus: beadsIssue.status,
                    });
                    result.issuesSynced++;
                    continue;
                }
                workflow_1.log.info('[BeadsFileChange] Syncing Beads→Huly', {
                    beadsId: beadsIssue.id,
                    hulyId: hulyIdentifier,
                    beadsStatus: beadsIssue.status,
                });
                const syncResult = await syncBeadsToHuly({
                    beadsIssue: {
                        id: beadsIssue.id,
                        title: beadsIssue.title,
                        description: beadsIssue.description,
                        status: beadsIssue.status,
                        modifiedAt: Date.now(),
                    },
                    hulyIdentifier,
                    context: {
                        projectIdentifier,
                        vibeProjectId: '',
                        gitRepoPath,
                    },
                });
                if (syncResult.success) {
                    workflow_1.log.info('[BeadsFileChange] Synced to Huly', {
                        beadsId: beadsIssue.id,
                        hulyId: hulyIdentifier,
                    });
                    result.issuesSynced++;
                }
                else {
                    workflow_1.log.warn('[BeadsFileChange] Sync to Huly failed', {
                        beadsId: beadsIssue.id,
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
/** @deprecated VibeKanban removed */
async function VibeSSEChangeWorkflow(input) {
    workflow_1.log.warn('[VibeSSEChange] VK disabled, skipping');
    return {
        success: true,
        tasksProcessed: 0,
        tasksSynced: 0,
        errors: [],
    };
}
/**
 * HulyWebhookChangeWorkflow - Triggered by Huly webhook events
 *
 * This workflow is the durable replacement for HulyWebhookHandler callbacks.
 * It processes Huly change notifications and syncs to Vibe/Beads.
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
    const issueMap = new Map();
    for (const change of issueChanges) {
        const key = change.data?.identifier || change.id;
        if (!key)
            continue;
        const existing = issueMap.get(key);
        if (!existing || (change.modifiedOn ?? 0) > (existing.modifiedOn ?? 0)) {
            issueMap.set(key, change);
        }
    }
    const dedupedChanges = Array.from(issueMap.values());
    if (dedupedChanges.length < issueChanges.length) {
        workflow_1.log.info('[HulyWebhookChange] Deduplicated issues', {
            before: issueChanges.length,
            after: dedupedChanges.length,
        });
    }
    result.issuesProcessed = dedupedChanges.length;
    for (const change of dedupedChanges) {
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
            const syncResult = await (0, workflow_1.executeChild)(bidirectional_sync_1.SyncFromHulyWorkflow, {
                args: [
                    {
                        hulyIdentifier: issueId,
                        context: {
                            projectIdentifier,
                            vibeProjectId: '',
                            gitRepoPath,
                        },
                    },
                ],
                workflowId: `huly-webhook-sync-${issueId}`,
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
            await (0, workflow_1.sleep)('500ms');
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
//# sourceMappingURL=event-sync.js.map