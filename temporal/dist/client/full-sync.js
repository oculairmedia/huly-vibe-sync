"use strict";
/**
 * Full Sync Client Functions
 *
 * Schedule and manage full orchestration sync workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleSingleIssueSync = scheduleSingleIssueSync;
exports.executeSingleIssueSync = executeSingleIssueSync;
exports.scheduleProjectSync = scheduleProjectSync;
exports.scheduleFullSync = scheduleFullSync;
exports.executeFullSync = executeFullSync;
exports.getFullSyncProgress = getFullSyncProgress;
exports.cancelFullSync = cancelFullSync;
exports.listSyncWorkflows = listSyncWorkflows;
const connection_1 = require("./connection");
/**
 * Schedule a single issue sync using existing services
 *
 * This is the recommended way to sync issues - it uses the battle-tested
 * service implementations wrapped in Temporal for durability.
 */
async function scheduleSingleIssueSync(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `sync-issue-${input.issue.identifier}-${Date.now()}`;
    const handle = await client.workflow.start('SyncSingleIssueWorkflow', {
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
 * Execute a single issue sync and wait for result
 */
async function executeSingleIssueSync(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `sync-issue-${input.issue.identifier}-${Date.now()}`;
    return await client.workflow.execute('SyncSingleIssueWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
/**
 * Schedule a full project sync
 */
async function scheduleProjectSync(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `sync-project-${input.context.projectIdentifier}-${Date.now()}`;
    const handle = await client.workflow.start('SyncProjectWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Scheduled project sync: ${workflowId} (${input.issues.length} issues)`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Schedule a full orchestration sync (fire-and-forget)
 *
 * This replaces the legacy SyncOrchestrator.syncHulyToVibe() function.
 * Runs as a durable Temporal workflow with automatic retry.
 */
async function scheduleFullSync(input = {}) {
    const client = await (0, connection_1.getClient)();
    const workflowId = input.projectIdentifier
        ? `full-sync-${input.projectIdentifier}-${Date.now()}`
        : `full-sync-all-${Date.now()}`;
    const handle = await client.workflow.start('FullOrchestrationWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Scheduled full sync: ${workflowId}`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Execute a full sync and wait for result
 *
 * Blocks until the workflow completes.
 */
async function executeFullSync(input = {}) {
    const client = await (0, connection_1.getClient)();
    const workflowId = input.projectIdentifier
        ? `full-sync-${input.projectIdentifier}-${Date.now()}`
        : `full-sync-all-${Date.now()}`;
    return await client.workflow.execute('FullOrchestrationWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
/**
 * Get progress of a running full sync workflow
 */
async function getFullSyncProgress(workflowId) {
    try {
        const client = await (0, connection_1.getClient)();
        const handle = client.workflow.getHandle(workflowId);
        return await handle.query('progress');
    }
    catch {
        return null;
    }
}
/**
 * Cancel a running full sync workflow
 */
async function cancelFullSync(workflowId) {
    const client = await (0, connection_1.getClient)();
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal('cancel');
}
/**
 * List running sync workflows
 */
async function listSyncWorkflows(limit = 20) {
    const client = await (0, connection_1.getClient)();
    const workflows = [];
    for await (const workflow of client.workflow.list({
        query: `WorkflowType = 'FullOrchestrationWorkflow' OR WorkflowType = 'ScheduledSyncWorkflow'`,
    })) {
        workflows.push({
            workflowId: workflow.workflowId,
            status: workflow.status.name,
            startTime: workflow.startTime,
            type: String(workflow.type) || 'unknown',
        });
        if (workflows.length >= limit)
            break;
    }
    return workflows;
}
//# sourceMappingURL=full-sync.js.map