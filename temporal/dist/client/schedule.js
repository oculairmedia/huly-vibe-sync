"use strict";
/**
 * Schedule Management Client Functions
 *
 * Start, stop, and manage scheduled sync workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduledSync = startScheduledSync;
exports.getActiveScheduledSync = getActiveScheduledSync;
exports.stopScheduledSync = stopScheduledSync;
exports.restartScheduledSync = restartScheduledSync;
exports.isScheduledSyncActive = isScheduledSyncActive;
const connection_1 = require("./connection");
/**
 * Start a scheduled sync workflow
 *
 * This replaces setInterval-based scheduling with a durable workflow.
 * The workflow runs forever (or until maxIterations), executing syncs at intervals.
 */
async function startScheduledSync(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `scheduled-sync-${Date.now()}`;
    const handle = await client.workflow.start('ScheduledSyncWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Started scheduled sync: ${workflowId} (every ${input.intervalMinutes} minutes)`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Get active scheduled sync workflow
 *
 * Returns the currently running scheduled sync workflow if any.
 */
async function getActiveScheduledSync() {
    const client = await (0, connection_1.getClient)();
    for await (const workflow of client.workflow.list({
        query: `WorkflowType = 'ScheduledSyncWorkflow' AND ExecutionStatus = 'Running'`,
    })) {
        return {
            workflowId: workflow.workflowId,
            status: workflow.status.name,
            startTime: workflow.startTime,
        };
    }
    return null;
}
/**
 * Stop a running scheduled sync workflow
 *
 * Sends a cancel signal to gracefully stop the workflow.
 */
async function stopScheduledSync(workflowId) {
    const client = await (0, connection_1.getClient)();
    // If no workflowId provided, find the active one
    let targetWorkflowId = workflowId;
    if (!targetWorkflowId) {
        const active = await getActiveScheduledSync();
        if (!active) {
            console.log('[Temporal] No active scheduled sync to stop');
            return false;
        }
        targetWorkflowId = active.workflowId;
    }
    try {
        const handle = client.workflow.getHandle(targetWorkflowId);
        await handle.cancel();
        console.log(`[Temporal] Stopped scheduled sync: ${targetWorkflowId}`);
        return true;
    }
    catch (error) {
        console.error(`[Temporal] Failed to stop scheduled sync: ${error}`);
        return false;
    }
}
/**
 * Restart scheduled sync with new interval
 *
 * Stops the current scheduled sync and starts a new one with updated parameters.
 */
async function restartScheduledSync(input) {
    // Stop existing schedule first
    await stopScheduledSync();
    // Start new schedule
    return startScheduledSync(input);
}
/**
 * Check if a scheduled sync is currently active
 */
async function isScheduledSyncActive() {
    const active = await getActiveScheduledSync();
    return active !== null;
}
//# sourceMappingURL=schedule.js.map