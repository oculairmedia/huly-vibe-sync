"use strict";
/**
 * Reconciliation Client Functions
 *
 * Schedule and manage data reconciliation workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeDataReconciliation = executeDataReconciliation;
exports.startScheduledReconciliation = startScheduledReconciliation;
exports.getActiveScheduledReconciliation = getActiveScheduledReconciliation;
exports.stopScheduledReconciliation = stopScheduledReconciliation;
const connection_1 = require("./connection");
async function executeDataReconciliation(input = {}) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `reconcile-${Date.now()}`;
    return await client.workflow.execute('DataReconciliationWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
async function startScheduledReconciliation(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `scheduled-reconcile-${Date.now()}`;
    const handle = await client.workflow.start('ScheduledReconciliationWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Started scheduled reconciliation: ${workflowId} (every ${input.intervalMinutes} minutes)`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
async function getActiveScheduledReconciliation() {
    const client = await (0, connection_1.getClient)();
    for await (const workflow of client.workflow.list({
        query: `WorkflowType = 'ScheduledReconciliationWorkflow' AND ExecutionStatus = 'Running'`,
    })) {
        return {
            workflowId: workflow.workflowId,
            status: workflow.status.name,
            startTime: workflow.startTime,
        };
    }
    return null;
}
async function stopScheduledReconciliation(workflowId) {
    const client = await (0, connection_1.getClient)();
    let targetWorkflowId = workflowId;
    if (!targetWorkflowId) {
        const active = await getActiveScheduledReconciliation();
        if (!active) {
            console.log('[Temporal] No active scheduled reconciliation to stop');
            return false;
        }
        targetWorkflowId = active.workflowId;
    }
    try {
        const handle = client.workflow.getHandle(targetWorkflowId);
        await handle.cancel();
        console.log(`[Temporal] Stopped scheduled reconciliation: ${targetWorkflowId}`);
        return true;
    }
    catch (error) {
        console.error(`[Temporal] Failed to stop scheduled reconciliation: ${error}`);
        return false;
    }
}
//# sourceMappingURL=reconciliation.js.map