"use strict";
/**
 * Memory Update Client Functions
 *
 * Schedule and manage Letta memory update workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleMemoryUpdate = scheduleMemoryUpdate;
exports.scheduleBatchMemoryUpdate = scheduleBatchMemoryUpdate;
exports.executeMemoryUpdate = executeMemoryUpdate;
exports.getWorkflowStatus = getWorkflowStatus;
exports.cancelWorkflow = cancelWorkflow;
exports.listRecentWorkflows = listRecentWorkflows;
exports.getFailedWorkflows = getFailedWorkflows;
const connection_1 = require("./connection");
/**
 * Schedule a single memory update workflow
 *
 * Returns immediately after scheduling. The workflow runs
 * in the background with automatic retry.
 */
async function scheduleMemoryUpdate(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `memory-update-${input.agentId}-${input.blockLabel}-${Date.now()}`;
    const handle = await client.workflow.start('MemoryUpdateWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Scheduled memory update: ${workflowId}`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Schedule a batch memory update workflow
 *
 * All updates run in parallel with independent retry.
 */
async function scheduleBatchMemoryUpdate(updates, source) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `batch-memory-update-${Date.now()}`;
    const input = {
        updates,
        source: source || 'vibesync-batch',
    };
    const handle = await client.workflow.start('BatchMemoryUpdateWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Scheduled batch memory update: ${workflowId} (${updates.length} updates)`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Execute a memory update and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 * Use for synchronous flows where you need the result.
 */
async function executeMemoryUpdate(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `memory-update-${input.agentId}-${input.blockLabel}-${Date.now()}`;
    const result = await client.workflow.execute('MemoryUpdateWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    return result;
}
/**
 * Get the status of a running workflow
 */
async function getWorkflowStatus(workflowId) {
    const client = await (0, connection_1.getClient)();
    const handle = client.workflow.getHandle(workflowId);
    const description = await handle.describe();
    // Try to query the workflow for detailed status
    try {
        const queryResult = await handle.query('status');
        return {
            status: description.status.name,
            ...queryResult,
        };
    }
    catch {
        // Query not supported or workflow completed
        return {
            status: description.status.name,
        };
    }
}
/**
 * Cancel a running workflow
 */
async function cancelWorkflow(workflowId) {
    const client = await (0, connection_1.getClient)();
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal('cancel');
}
/**
 * List recent memory update workflows
 */
async function listRecentWorkflows(limit = 20) {
    const client = await (0, connection_1.getClient)();
    const workflows = [];
    // Query workflows with type filter
    for await (const workflow of client.workflow.list({
        query: `WorkflowType = 'MemoryUpdateWorkflow' OR WorkflowType = 'BatchMemoryUpdateWorkflow'`,
    })) {
        workflows.push({
            workflowId: workflow.workflowId,
            status: workflow.status.name,
            startTime: workflow.startTime,
        });
        if (workflows.length >= limit)
            break;
    }
    return workflows;
}
/**
 * Get failed workflows that need attention
 */
async function getFailedWorkflows() {
    const client = await (0, connection_1.getClient)();
    const failed = [];
    for await (const workflow of client.workflow.list({
        query: `ExecutionStatus = 'Failed' AND (WorkflowType = 'MemoryUpdateWorkflow' OR WorkflowType = 'BatchMemoryUpdateWorkflow')`,
    })) {
        failed.push({
            workflowId: workflow.workflowId,
            startTime: workflow.startTime,
            closeTime: workflow.closeTime,
        });
    }
    return failed;
}
//# sourceMappingURL=memory-update.js.map