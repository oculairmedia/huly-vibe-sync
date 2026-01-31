"use strict";
/**
 * Data Reconciliation Workflows
 *
 * Runs periodic reconciliation to detect stale sync records.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataReconciliationWorkflow = DataReconciliationWorkflow;
exports.ScheduledReconciliationWorkflow = ScheduledReconciliationWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { reconcileSyncData } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '5 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 3,
    },
});
/**
 * DataReconciliationWorkflow
 */
async function DataReconciliationWorkflow(input = {}) {
    workflow_1.log.info('[Reconcile] Starting data reconciliation', { input });
    const result = await reconcileSyncData(input);
    workflow_1.log.info('[Reconcile] Completed data reconciliation', {
        success: result.success,
        staleVibe: result.staleVibe.length,
        staleBeads: result.staleBeads.length,
        action: result.action,
        dryRun: result.dryRun,
    });
    return result;
}
/**
 * ScheduledReconciliationWorkflow
 */
async function ScheduledReconciliationWorkflow(input) {
    const { intervalMinutes, maxIterations = Infinity, reconcileOptions = {} } = input;
    let iteration = 0;
    workflow_1.log.info('[ScheduledReconcile] Starting scheduled reconciliation', {
        intervalMinutes,
        maxIterations,
    });
    while (iteration < maxIterations) {
        iteration++;
        workflow_1.log.info(`[ScheduledReconcile] Running iteration ${iteration}`);
        try {
            await (0, workflow_1.executeChild)(DataReconciliationWorkflow, {
                workflowId: `reconcile-scheduled-${Date.now()}`,
                args: [reconcileOptions],
            });
        }
        catch (error) {
            workflow_1.log.error('[ScheduledReconcile] Reconciliation iteration failed', {
                iteration,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        workflow_1.log.info(`[ScheduledReconcile] Sleeping for ${intervalMinutes} minutes`);
        await (0, workflow_1.sleep)(`${intervalMinutes} minutes`);
    }
    workflow_1.log.info('[ScheduledReconcile] Completed all iterations');
}
//# sourceMappingURL=reconciliation.js.map