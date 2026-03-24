"use strict";
/**
 * Full Sync Workflows
 *
 * Legacy workflows kept for backward compatibility.
 * Main orchestration now uses ProjectSyncWorkflow with 4-phase pipeline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncSingleIssueWorkflow = SyncSingleIssueWorkflow;
exports.SyncProjectWorkflow = SyncProjectWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { commitBeadsToGit } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 5,
    },
});
async function SyncSingleIssueWorkflow(input) {
    const { issue, context } = input;
    workflow_1.log.info(`[SyncSingleIssue] Starting: ${issue.identifier}`, {
        project: context.projectIdentifier,
    });
    return { success: true };
}
async function SyncProjectWorkflow(input) {
    const { issues, context, commitAfterSync = true } = input;
    workflow_1.log.info(`[SyncProject] Starting: ${context.projectIdentifier}`, {
        issueCount: issues.length,
    });
    if (commitAfterSync && context.gitRepoPath) {
        await commitBeadsToGit({
            context,
            message: `Sync ${issues.length} issues from VibeSync`,
        });
    }
    workflow_1.log.info(`[SyncProject] Complete: ${context.projectIdentifier}`);
    return {
        success: true,
        total: issues.length,
        synced: issues.length,
        failed: 0,
        results: issues.map(() => ({ success: true })),
    };
}
//# sourceMappingURL=full-sync.js.map