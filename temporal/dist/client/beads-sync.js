"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleBeadsSync = scheduleBeadsSync;
exports.executeBeadsSync = executeBeadsSync;
exports.scheduleBatchBeadsSync = scheduleBatchBeadsSync;
exports.scheduleBeadsFileChange = scheduleBeadsFileChange;
exports.executeBeadsFileChange = executeBeadsFileChange;
const connection_1 = require("./connection");
async function scheduleBeadsSync(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `sync-beads-${input.context.projectIdentifier}-${input.beadsIssueId}-${Date.now()}`;
    const handle = await client.workflow.start('SyncFromBeadsWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Scheduled Beads sync: ${workflowId}`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
async function executeBeadsSync(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `sync-beads-${input.context.projectIdentifier}-${input.beadsIssueId}-${Date.now()}`;
    return await client.workflow.execute('SyncFromBeadsWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
async function scheduleBatchBeadsSync(inputs) {
    const results = [];
    for (const input of inputs) {
        try {
            const result = await scheduleBeadsSync(input);
            results.push(result);
        }
        catch (error) {
            console.error(`[Temporal] Failed to schedule Beads sync for ${input.beadsIssueId}:`, error);
        }
    }
    console.log(`[Temporal] Scheduled ${results.length}/${inputs.length} Beads syncs`);
    return results;
}
async function scheduleBeadsFileChange(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `beads-change-${input.projectIdentifier}-${Date.now()}`;
    const handle = await client.workflow.start('BeadsFileChangeWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Scheduled Beads file change workflow: ${workflowId}`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
async function executeBeadsFileChange(input) {
    const client = await (0, connection_1.getClient)();
    const workflowId = `beads-change-${input.projectIdentifier}-${Date.now()}`;
    return await client.workflow.execute('BeadsFileChangeWorkflow', {
        taskQueue: connection_1.TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
//# sourceMappingURL=beads-sync.js.map