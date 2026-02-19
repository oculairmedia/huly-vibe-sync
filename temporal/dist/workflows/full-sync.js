"use strict";
/**
 * Full Sync Workflows
 *
 * These workflows orchestrate the complete sync process
 * using the existing service implementations wrapped as activities.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncSingleIssueWorkflow = SyncSingleIssueWorkflow;
exports.SyncProjectWorkflow = SyncProjectWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Proxy activities with appropriate retry policies
const { syncIssueToBeads, syncBeadsToHuly, commitBeadsToGit } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 5,
        nonRetryableErrorTypes: ['HulyValidationError', 'BeadsValidationError'],
    },
});
/**
 * SyncSingleIssueWorkflow
 *
 * Syncs a single Huly issue to Vibe and Beads atomically.
 * Use this for real-time sync on issue changes.
 */
async function SyncSingleIssueWorkflow(input) {
    const { issue, context, existingBeadsIssues = [] } = input;
    const syncToBeads = input.syncToBeads !== false;
    workflow_1.log.info(`[SyncSingleIssue] Starting: ${issue.identifier}`, {
        project: context.projectIdentifier,
        toBeads: syncToBeads,
    });
    const result = { success: false };
    try {
        if (syncToBeads && context.gitRepoPath) {
            result.beadsResult = await syncIssueToBeads({
                issue,
                context,
                existingBeadsIssues,
            });
        }
        result.success = true;
        workflow_1.log.info(`[SyncSingleIssue] Complete: ${issue.identifier}`, {
            beads: result.beadsResult?.success,
        });
        return result;
    }
    catch (error) {
        result.success = false;
        result.error = error instanceof Error ? error.message : String(error);
        workflow_1.log.error(`[SyncSingleIssue] Failed: ${issue.identifier}`, {
            error: result.error,
        });
        throw error;
    }
}
/**
 * SyncProjectWorkflow
 *
 * Syncs an entire project's issues in parallel batches.
 * Use this for initial sync or full reconciliation.
 */
async function SyncProjectWorkflow(input) {
    const { issues, context, batchSize = 5, commitAfterSync = true } = input;
    workflow_1.log.info(`[SyncProject] Starting: ${context.projectIdentifier}`, {
        issueCount: issues.length,
        batchSize,
    });
    const results = [];
    let synced = 0;
    let failed = 0;
    // Process issues in batches
    for (let i = 0; i < issues.length; i += batchSize) {
        const batch = issues.slice(i, i + batchSize);
        workflow_1.log.info(`[SyncProject] Processing batch ${Math.floor(i / batchSize) + 1}`, {
            batchSize: batch.length,
        });
        // Process batch in parallel
        const batchPromises = batch.map(issueInput => SyncSingleIssueWorkflow({
            ...issueInput,
            context,
        }).catch(error => ({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        })));
        const batchResults = await Promise.all(batchPromises);
        for (const result of batchResults) {
            results.push(result);
            if (result.success) {
                synced++;
            }
            else {
                failed++;
            }
        }
    }
    // Commit Beads changes to git
    if (commitAfterSync && context.gitRepoPath) {
        workflow_1.log.info(`[SyncProject] Committing Beads changes`);
        await commitBeadsToGit({
            context,
            message: `Sync ${synced} issues from VibeSync`,
        });
    }
    workflow_1.log.info(`[SyncProject] Complete: ${context.projectIdentifier}`, {
        synced,
        failed,
        total: issues.length,
    });
    return {
        success: failed === 0,
        total: issues.length,
        synced,
        failed,
        results,
    };
}
//# sourceMappingURL=full-sync.js.map