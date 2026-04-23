"use strict";
/**
 * Full Sync Workflows
 *
 * Legacy workflows kept for backward compatibility.
 * Main orchestration now uses ProjectSyncWorkflow with a simplified pipeline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncSingleIssueWorkflow = SyncSingleIssueWorkflow;
exports.SyncProjectWorkflow = SyncProjectWorkflow;
const workflow_1 = require("@temporalio/workflow");
async function SyncSingleIssueWorkflow(input) {
    const { issue, context } = input;
    workflow_1.log.info(`[SyncSingleIssue] Starting: ${issue.identifier}`, {
        project: context.projectIdentifier,
    });
    return { success: true };
}
async function SyncProjectWorkflow(input) {
    const { issues, context } = input;
    workflow_1.log.info(`[SyncProject] Starting: ${context.projectIdentifier}`, {
        issueCount: issues.length,
    });
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