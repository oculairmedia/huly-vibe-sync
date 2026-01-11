"use strict";
/**
 * Temporal Client for VibeSync
 *
 * Helper functions to trigger and monitor Temporal workflows
 * from VibeSync's existing code.
 *
 * Usage:
 *   import { scheduleMemoryUpdate, scheduleBatchMemoryUpdate } from './temporal/client';
 *
 *   // Single update
 *   await scheduleMemoryUpdate({
 *     agentId: 'agent-xxx',
 *     blockLabel: 'board_metrics',
 *     newValue: '{"issues": 10}',
 *     source: 'vibesync-sync',
 *   });
 *
 *   // Batch update
 *   await scheduleBatchMemoryUpdate([
 *     { agentId: 'agent-1', blockLabel: 'board_metrics', newValue: '...' },
 *     { agentId: 'agent-2', blockLabel: 'board_metrics', newValue: '...' },
 *   ]);
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleMemoryUpdate = scheduleMemoryUpdate;
exports.scheduleBatchMemoryUpdate = scheduleBatchMemoryUpdate;
exports.executeMemoryUpdate = executeMemoryUpdate;
exports.getWorkflowStatus = getWorkflowStatus;
exports.cancelWorkflow = cancelWorkflow;
exports.listRecentWorkflows = listRecentWorkflows;
exports.getFailedWorkflows = getFailedWorkflows;
exports.scheduleIssueSync = scheduleIssueSync;
exports.executeIssueSync = executeIssueSync;
exports.scheduleBatchIssueSync = scheduleBatchIssueSync;
exports.isTemporalEnabled = isTemporalEnabled;
exports.isTemporalAvailable = isTemporalAvailable;
exports.scheduleSingleIssueSync = scheduleSingleIssueSync;
exports.executeSingleIssueSync = executeSingleIssueSync;
exports.scheduleProjectSync = scheduleProjectSync;
exports.scheduleVibeToHulySync = scheduleVibeToHulySync;
const client_1 = require("@temporalio/client");
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'vibesync-queue';
let clientInstance = null;
/**
 * Get or create the Temporal client instance
 */
async function getClient() {
    if (!clientInstance) {
        const connection = await client_1.Connection.connect({
            address: TEMPORAL_ADDRESS,
        });
        clientInstance = new client_1.Client({ connection });
    }
    return clientInstance;
}
/**
 * Schedule a single memory update workflow
 *
 * Returns immediately after scheduling. The workflow runs
 * in the background with automatic retry.
 */
async function scheduleMemoryUpdate(input) {
    const client = await getClient();
    const workflowId = `memory-update-${input.agentId}-${input.blockLabel}-${Date.now()}`;
    const handle = await client.workflow.start('MemoryUpdateWorkflow', {
        taskQueue: TASK_QUEUE,
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
    const client = await getClient();
    const workflowId = `batch-memory-update-${Date.now()}`;
    const input = {
        updates,
        source: source || 'vibesync-batch',
    };
    const handle = await client.workflow.start('BatchMemoryUpdateWorkflow', {
        taskQueue: TASK_QUEUE,
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
    const client = await getClient();
    const workflowId = `memory-update-${input.agentId}-${input.blockLabel}-${Date.now()}`;
    const result = await client.workflow.execute('MemoryUpdateWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
    return result;
}
/**
 * Get the status of a running workflow
 */
async function getWorkflowStatus(workflowId) {
    const client = await getClient();
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
    const client = await getClient();
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal('cancel');
}
/**
 * List recent memory update workflows
 */
async function listRecentWorkflows(limit = 20) {
    const client = await getClient();
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
    const client = await getClient();
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
// ============================================================================
// Issue Sync Workflows
// ============================================================================
/**
 * Schedule an issue sync workflow (fire-and-forget)
 *
 * Syncs an issue across Huly, VibeKanban, and Beads atomically.
 * Returns immediately; workflow runs in background with retry.
 */
async function scheduleIssueSync(input) {
    const client = await getClient();
    const identifier = input.issue.identifier || input.issue.title.substring(0, 20);
    const workflowId = `issue-sync-${input.operation}-${identifier}-${Date.now()}`;
    const handle = await client.workflow.start('IssueSyncWorkflow', {
        taskQueue: TASK_QUEUE,
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
 * Execute an issue sync and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 * Use when you need to know if sync succeeded before continuing.
 */
async function executeIssueSync(input) {
    const client = await getClient();
    const identifier = input.issue.identifier || input.issue.title.substring(0, 20);
    const workflowId = `issue-sync-${input.operation}-${identifier}-${Date.now()}`;
    const result = await client.workflow.execute('IssueSyncWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
    return result;
}
/**
 * Schedule a batch issue sync workflow
 *
 * Syncs multiple issues in parallel with controlled concurrency.
 * Useful for full project syncs.
 */
async function scheduleBatchIssueSync(issues, maxParallel = 5) {
    const client = await getClient();
    const workflowId = `batch-issue-sync-${Date.now()}`;
    const handle = await client.workflow.start('BatchIssueSyncWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ issues, maxParallel }],
    });
    console.log(`[Temporal] Scheduled batch issue sync: ${workflowId} (${issues.length} issues)`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Check if Temporal is enabled via feature flag
 */
function isTemporalEnabled() {
    return process.env.USE_TEMPORAL_SYNC === 'true';
}
/**
 * Check if Temporal is available (can connect)
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
// ============================================================================
// Full Sync Workflows (using existing services)
// ============================================================================
/**
 * Schedule a single issue sync using existing services
 *
 * This is the recommended way to sync issues - it uses the battle-tested
 * service implementations wrapped in Temporal for durability.
 */
async function scheduleSingleIssueSync(input) {
    const client = await getClient();
    const workflowId = `sync-issue-${input.issue.identifier}-${Date.now()}`;
    const handle = await client.workflow.start('SyncSingleIssueWorkflow', {
        taskQueue: TASK_QUEUE,
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
    const client = await getClient();
    const workflowId = `sync-issue-${input.issue.identifier}-${Date.now()}`;
    return await client.workflow.execute('SyncSingleIssueWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
/**
 * Schedule a full project sync
 */
async function scheduleProjectSync(input) {
    const client = await getClient();
    const workflowId = `sync-project-${input.context.projectIdentifier}-${Date.now()}`;
    const handle = await client.workflow.start('SyncProjectWorkflow', {
        taskQueue: TASK_QUEUE,
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
 * Schedule Vibe→Huly sync (Phase 2)
 */
async function scheduleVibeToHulySync(input) {
    const client = await getClient();
    const workflowId = `sync-vibe-huly-${input.hulyIdentifier}-${Date.now()}`;
    const handle = await client.workflow.start('SyncVibeToHulyWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
//# sourceMappingURL=client.js.map