"use strict";
/**
 * Issue Sync Client Functions
 *
 * Schedule and manage issue sync workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleIssueSync = scheduleIssueSync;
exports.executeIssueSync = executeIssueSync;
exports.scheduleBatchIssueSync = scheduleBatchIssueSync;
const connection_1 = require("./connection");
/**
 * Schedule an issue sync workflow (fire-and-forget)
 *
 * Syncs an issue across Huly, VibeKanban, and Beads atomically.
 * Returns immediately; workflow runs in background with retry.
 */
async function scheduleIssueSync(input) {
    const client = await (0, connection_1.getClient)();
    const identifier = input.issue.identifier || input.issue.title.substring(0, 20);
    const workflowId = `issue-sync-${input.operation}-${identifier}-${Date.now()}`;
    const handle = await client.workflow.start('IssueSyncWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Scheduled issue sync: ${workflowId}`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Execute an issue sync and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 * Use when you need to know if sync succeeded before continuing.
 */
async function executeIssueSync(input) {
    const client = await (0, connection_1.getClient)();
    const identifier = input.issue.identifier || input.issue.title.substring(0, 20);
    const workflowId = `issue-sync-${input.operation}-${identifier}-${Date.now()}`;
    const result = await client.workflow.execute('IssueSyncWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    return result;
}
/**
 * Schedule a batch issue sync workflow
 *
 * Syncs multiple issues in parallel with controlled concurrency.
 * Useful for full project syncs.
 */
async function scheduleBatchIssueSync(issues, maxParallel = 5) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `batch-issue-sync-${Date.now()}`;
    const handle = await client.workflow.start('BatchIssueSyncWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [{ issues, maxParallel }],
    });
    console.log(`[Temporal] Scheduled batch issue sync: ${workflowId} (${issues.length} issues)`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
//# sourceMappingURL=issue-sync.js.map