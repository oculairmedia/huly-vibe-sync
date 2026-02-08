"use strict";
/**
 * Event Trigger Client Functions
 *
 * Schedule and manage Vibe SSE and Huly webhook change workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleVibeSSEChange = scheduleVibeSSEChange;
exports.executeVibeSSEChange = executeVibeSSEChange;
exports.scheduleHulyWebhookChange = scheduleHulyWebhookChange;
exports.executeHulyWebhookChange = executeHulyWebhookChange;
const client_1 = require("@temporalio/client");
const connection_1 = require("./connection");
/**
 * Schedule a Vibe SSE change workflow
 *
 * This is the main entry point for VibeEventWatcher to trigger durable syncs.
 * When Vibe SSE events indicate task changes, call this to sync to Huly.
 */
async function scheduleVibeSSEChange(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `vibe-sse-${input.vibeProjectId}`;
    try {
        const handle = await client.workflow.start('VibeSSEChangeWorkflow', {
            taskQueue: connection_1.TASK_QUEUE,
            workflowId,
            args: [input],
            workflowIdConflictPolicy: client_1.WorkflowIdConflictPolicy.USE_EXISTING,
            workflowIdReusePolicy: client_1.WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        });
        console.log(`[Temporal] Scheduled Vibe SSE change workflow: ${workflowId}`);
        return {
            workflowId: handle.workflowId,
            runId: handle.firstExecutionRunId,
        };
    }
    catch (error) {
        if (error instanceof client_1.WorkflowExecutionAlreadyStartedError) {
            console.log(`[Temporal] Workflow ${workflowId} already running, coalescing`);
            return { workflowId, runId: 'coalesced' };
        }
        throw error;
    }
}
/**
 * Execute a Vibe SSE change workflow and wait for result
 */
async function executeVibeSSEChange(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `vibe-sse-${input.vibeProjectId}`;
    try {
        return await client.workflow.execute('VibeSSEChangeWorkflow', {
            taskQueue: connection_1.TASK_QUEUE,
            workflowId,
            args: [input],
            workflowIdConflictPolicy: client_1.WorkflowIdConflictPolicy.USE_EXISTING,
            workflowIdReusePolicy: client_1.WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        });
    }
    catch (error) {
        if (error instanceof client_1.WorkflowExecutionAlreadyStartedError) {
            console.log(`[Temporal] Workflow ${workflowId} already running, coalescing`);
            // For execute, we need to wait for the existing workflow
            const handle = client.workflow.getHandle(workflowId);
            return await handle.result();
        }
        throw error;
    }
}
/**
 * Schedule a Huly webhook change workflow (fire and forget)
 *
 * Processes Huly webhook change events and syncs to Vibe/Beads.
 * Returns immediately after scheduling.
 */
async function scheduleHulyWebhookChange(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `huly-webhook-${input.type}`;
    try {
        const handle = await client.workflow.start('HulyWebhookChangeWorkflow', {
            taskQueue: connection_1.TASK_QUEUE,
            workflowId,
            args: [input],
            workflowIdConflictPolicy: client_1.WorkflowIdConflictPolicy.USE_EXISTING,
            workflowIdReusePolicy: client_1.WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        });
        console.log(`[Temporal] Scheduled Huly webhook change workflow: ${workflowId}`);
        return {
            workflowId: handle.workflowId,
            runId: handle.firstExecutionRunId,
        };
    }
    catch (error) {
        if (error instanceof client_1.WorkflowExecutionAlreadyStartedError) {
            console.log(`[Temporal] Workflow ${workflowId} already running, coalescing`);
            return { workflowId, runId: 'coalesced' };
        }
        throw error;
    }
}
/**
 * Execute a Huly webhook change workflow and wait for result
 */
async function executeHulyWebhookChange(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `huly-webhook-${input.type}`;
    try {
        return await client.workflow.execute('HulyWebhookChangeWorkflow', {
            taskQueue: connection_1.TASK_QUEUE,
            workflowId,
            args: [input],
            workflowIdConflictPolicy: client_1.WorkflowIdConflictPolicy.USE_EXISTING,
            workflowIdReusePolicy: client_1.WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        });
    }
    catch (error) {
        if (error instanceof client_1.WorkflowExecutionAlreadyStartedError) {
            console.log(`[Temporal] Workflow ${workflowId} already running, coalescing`);
            // For execute, we need to wait for the existing workflow
            const handle = client.workflow.getHandle(workflowId);
            return await handle.result();
        }
        throw error;
    }
}
//# sourceMappingURL=event-triggers.js.map