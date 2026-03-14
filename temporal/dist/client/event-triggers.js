"use strict";
/**
 * Event Trigger Client Functions
 *
 * Schedule and manage Huly webhook change workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleHulyWebhookChange = scheduleHulyWebhookChange;
exports.executeHulyWebhookChange = executeHulyWebhookChange;
const client_1 = require("@temporalio/client");
const connection_1 = require("./connection");
function buildWebhookWorkflowId(input) {
    const timestamp = Date.parse(input.timestamp);
    const suffix = Number.isFinite(timestamp) ? timestamp : Date.now();
    return `huly-webhook-${input.type}-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
}
/**
 * Schedule a Huly webhook change workflow (fire and forget)
 *
 * Processes Huly webhook change events and syncs to Beads.
 * Returns immediately after scheduling.
 */
async function scheduleHulyWebhookChange(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = buildWebhookWorkflowId(input);
    const handle = await client.workflow.start('HulyWebhookChangeWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
        workflowIdReusePolicy: client_1.WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    });
    console.log(`[Temporal] Scheduled Huly webhook change workflow: ${workflowId}`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Execute a Huly webhook change workflow and wait for result
 */
async function executeHulyWebhookChange(input) {
    const client = await (0, connection_1.getClient)();
    return await client.workflow.execute('HulyWebhookChangeWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId: buildWebhookWorkflowId(input),
        args: [input],
        workflowIdReusePolicy: client_1.WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    });
}
//# sourceMappingURL=event-triggers.js.map