"use strict";
/**
 * Temporal Workflow Triggers
 *
 * Helper functions for external services to trigger bidirectional sync workflows.
 * Used by: VibeEventWatcher, BeadsWatcher, HulyWebhookHandler
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTemporalAvailable = isTemporalAvailable;
exports.triggerSyncFromVibe = triggerSyncFromVibe;
exports.triggerSyncFromHuly = triggerSyncFromHuly;
exports.triggerSyncFromBeads = triggerSyncFromBeads;
exports.triggerBidirectionalSync = triggerBidirectionalSync;
exports.closeConnection = closeConnection;
const client_1 = require("@temporalio/client");
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'vibesync-queue';
let connection = null;
let client = null;
/**
 * Get or create Temporal client
 */
async function getClient() {
    if (client)
        return client;
    connection = await client_1.Connection.connect({
        address: TEMPORAL_ADDRESS,
    });
    client = new client_1.Client({ connection });
    return client;
}
/**
 * Check if Temporal is available
 */
async function isTemporalAvailable() {
    try {
        await getClient();
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Trigger sync when Vibe task changes
 */
async function triggerSyncFromVibe(vibeTaskId, context, linkedIds) {
    const temporal = await getClient();
    const workflowId = `sync-vibe-${vibeTaskId}-${Date.now()}`;
    await temporal.workflow.start('SyncFromVibeWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{
                vibeTaskId,
                context,
                linkedIds,
            }],
    });
    console.log(`[Temporal] Started SyncFromVibeWorkflow: ${workflowId}`);
    return { workflowId };
}
/**
 * Trigger sync when Huly issue changes
 */
async function triggerSyncFromHuly(hulyIdentifier, context, linkedIds) {
    const temporal = await getClient();
    const workflowId = `sync-huly-${hulyIdentifier}-${Date.now()}`;
    await temporal.workflow.start('SyncFromHulyWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{
                hulyIdentifier,
                context,
                linkedIds,
            }],
    });
    console.log(`[Temporal] Started SyncFromHulyWorkflow: ${workflowId}`);
    return { workflowId };
}
/**
 * Trigger sync when Beads issue changes
 */
async function triggerSyncFromBeads(beadsIssueId, context, linkedIds) {
    const temporal = await getClient();
    const workflowId = `sync-beads-${beadsIssueId}-${Date.now()}`;
    await temporal.workflow.start('SyncFromBeadsWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{
                beadsIssueId,
                context,
                linkedIds,
            }],
    });
    console.log(`[Temporal] Started SyncFromBeadsWorkflow: ${workflowId}`);
    return { workflowId };
}
/**
 * Trigger generic bidirectional sync
 */
async function triggerBidirectionalSync(source, issueData, context, linkedIds) {
    const temporal = await getClient();
    const workflowId = `sync-${source}-${issueData.id}-${Date.now()}`;
    await temporal.workflow.start('BidirectionalSyncWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{
                source,
                issueData,
                context,
                linkedIds,
            }],
    });
    console.log(`[Temporal] Started BidirectionalSyncWorkflow: ${workflowId}`);
    return { workflowId };
}
/**
 * Close the Temporal connection
 */
async function closeConnection() {
    if (connection) {
        await connection.close();
        connection = null;
        client = null;
    }
}
//# sourceMappingURL=trigger.js.map