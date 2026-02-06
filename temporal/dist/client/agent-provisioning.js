"use strict";
/**
 * Agent Provisioning Client Functions
 *
 * Schedule and manage Letta agent provisioning workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAgentProvisioning = startAgentProvisioning;
exports.executeAgentProvisioning = executeAgentProvisioning;
exports.getProvisioningProgress = getProvisioningProgress;
exports.cancelProvisioning = cancelProvisioning;
exports.provisionSingleAgent = provisionSingleAgent;
exports.cleanupFailedProvisions = cleanupFailedProvisions;
const connection_1 = require("./connection");
/**
 * Start agent provisioning workflow
 *
 * Creates Letta agents for Huly projects with fault tolerance and resume capability.
 */
async function startAgentProvisioning(input = {}) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `provision-agents-${Date.now()}`;
    const handle = await client.workflow.start('ProvisionAgentsWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Started agent provisioning: ${workflowId}`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Execute agent provisioning and wait for completion
 */
async function executeAgentProvisioning(input = {}) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `provision-agents-${Date.now()}`;
    return await client.workflow.execute('ProvisionAgentsWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
/**
 * Get provisioning progress
 */
async function getProvisioningProgress(workflowId) {
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
 * Cancel a running provisioning workflow
 */
async function cancelProvisioning(workflowId) {
    const client = await (0, connection_1.getClient)();
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal('cancel');
}
/**
 * Provision a single agent
 */
async function provisionSingleAgent(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `provision-single-${input.projectIdentifier}-${Date.now()}`;
    return await client.workflow.execute('ProvisionSingleAgentWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
/**
 * Cleanup failed provisions
 */
async function cleanupFailedProvisions(projectIdentifiers) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `cleanup-provisions-${Date.now()}`;
    return await client.workflow.execute('CleanupFailedProvisionsWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [{ projectIdentifiers }],
    });
}
//# sourceMappingURL=agent-provisioning.js.map