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
exports.scheduleFullSync = scheduleFullSync;
exports.executeFullSync = executeFullSync;
exports.getFullSyncProgress = getFullSyncProgress;
exports.cancelFullSync = cancelFullSync;
exports.startScheduledSync = startScheduledSync;
exports.listSyncWorkflows = listSyncWorkflows;
exports.getActiveScheduledSync = getActiveScheduledSync;
exports.stopScheduledSync = stopScheduledSync;
exports.restartScheduledSync = restartScheduledSync;
exports.isScheduledSyncActive = isScheduledSyncActive;
exports.startAgentProvisioning = startAgentProvisioning;
exports.executeAgentProvisioning = executeAgentProvisioning;
exports.getProvisioningProgress = getProvisioningProgress;
exports.cancelProvisioning = cancelProvisioning;
exports.provisionSingleAgent = provisionSingleAgent;
exports.cleanupFailedProvisions = cleanupFailedProvisions;
exports.scheduleBeadsSync = scheduleBeadsSync;
exports.executeBeadsSync = executeBeadsSync;
exports.scheduleBatchBeadsSync = scheduleBatchBeadsSync;
exports.scheduleBeadsFileChange = scheduleBeadsFileChange;
exports.executeBeadsFileChange = executeBeadsFileChange;
exports.scheduleVibeSSEChange = scheduleVibeSSEChange;
exports.executeVibeSSEChange = executeVibeSSEChange;
exports.scheduleHulyWebhookChange = scheduleHulyWebhookChange;
exports.executeHulyWebhookChange = executeHulyWebhookChange;
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
// ============================================================================
// Full Orchestration Workflows (replaces SyncOrchestrator)
// ============================================================================
/**
 * Schedule a full orchestration sync (fire-and-forget)
 *
 * This replaces the legacy SyncOrchestrator.syncHulyToVibe() function.
 * Runs as a durable Temporal workflow with automatic retry.
 */
async function scheduleFullSync(input = {}) {
    const client = await getClient();
    const workflowId = input.projectIdentifier
        ? `full-sync-${input.projectIdentifier}-${Date.now()}`
        : `full-sync-all-${Date.now()}`;
    const handle = await client.workflow.start('FullOrchestrationWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Scheduled full sync: ${workflowId}`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Execute a full sync and wait for result
 *
 * Blocks until the workflow completes.
 */
async function executeFullSync(input = {}) {
    const client = await getClient();
    const workflowId = input.projectIdentifier
        ? `full-sync-${input.projectIdentifier}-${Date.now()}`
        : `full-sync-all-${Date.now()}`;
    return await client.workflow.execute('FullOrchestrationWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
/**
 * Get progress of a running full sync workflow
 */
async function getFullSyncProgress(workflowId) {
    try {
        const client = await getClient();
        const handle = client.workflow.getHandle(workflowId);
        return await handle.query('progress');
    }
    catch {
        return null;
    }
}
/**
 * Cancel a running full sync workflow
 */
async function cancelFullSync(workflowId) {
    const client = await getClient();
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal('cancel');
}
/**
 * Start a scheduled sync workflow
 *
 * This replaces setInterval-based scheduling with a durable workflow.
 * The workflow runs forever (or until maxIterations), executing syncs at intervals.
 */
async function startScheduledSync(input) {
    const client = await getClient();
    const workflowId = `scheduled-sync-${Date.now()}`;
    const handle = await client.workflow.start('ScheduledSyncWorkflow', {
        taskQueue: TASK_QUEUE,
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
 * List running sync workflows
 */
async function listSyncWorkflows(limit = 20) {
    const client = await getClient();
    const workflows = [];
    for await (const workflow of client.workflow.list({
        query: `WorkflowType = 'FullOrchestrationWorkflow' OR WorkflowType = 'ScheduledSyncWorkflow'`,
    })) {
        workflows.push({
            workflowId: workflow.workflowId,
            status: workflow.status.name,
            startTime: workflow.startTime,
            type: String(workflow.type) || 'unknown',
        });
        if (workflows.length >= limit)
            break;
    }
    return workflows;
}
// ============================================================================
// Schedule Management
// ============================================================================
/**
 * Get active scheduled sync workflow
 *
 * Returns the currently running scheduled sync workflow if any.
 */
async function getActiveScheduledSync() {
    const client = await getClient();
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
    const client = await getClient();
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
/**
 * Start agent provisioning workflow
 *
 * Creates Letta agents for Huly projects with fault tolerance and resume capability.
 */
async function startAgentProvisioning(input = {}) {
    const client = await getClient();
    const workflowId = `provision-agents-${Date.now()}`;
    const handle = await client.workflow.start('ProvisionAgentsWorkflow', {
        taskQueue: TASK_QUEUE,
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
    const client = await getClient();
    const workflowId = `provision-agents-${Date.now()}`;
    return await client.workflow.execute('ProvisionAgentsWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
/**
 * Get provisioning progress
 */
async function getProvisioningProgress(workflowId) {
    try {
        const client = await getClient();
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
    const client = await getClient();
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal('cancel');
}
/**
 * Provision a single agent
 */
async function provisionSingleAgent(input) {
    const client = await getClient();
    const workflowId = `provision-single-${input.projectIdentifier}-${Date.now()}`;
    return await client.workflow.execute('ProvisionSingleAgentWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
/**
 * Cleanup failed provisions
 */
async function cleanupFailedProvisions(projectIdentifiers) {
    const client = await getClient();
    const workflowId = `cleanup-provisions-${Date.now()}`;
    return await client.workflow.execute('CleanupFailedProvisionsWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ projectIdentifiers }],
    });
}
/**
 * Schedule a Beads sync workflow (fire-and-forget)
 *
 * Triggered when Beads files change. Syncs from Beads to Huly and Vibe.
 * Returns immediately; workflow runs in background with retry.
 */
async function scheduleBeadsSync(input) {
    const client = await getClient();
    const workflowId = `sync-beads-${input.context.projectIdentifier}-${input.beadsIssueId}-${Date.now()}`;
    const handle = await client.workflow.start('SyncFromBeadsWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Scheduled Beads sync: ${workflowId}`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Execute a Beads sync and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 */
async function executeBeadsSync(input) {
    const client = await getClient();
    const workflowId = `sync-beads-${input.context.projectIdentifier}-${input.beadsIssueId}-${Date.now()}`;
    return await client.workflow.execute('SyncFromBeadsWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
/**
 * Schedule batch Beads sync for multiple changed issues
 *
 * When multiple Beads issues change at once (e.g., git pull), this
 * schedules individual workflows for each changed issue.
 */
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
/**
 * Schedule a Beads file change workflow
 *
 * This is the main entry point for BeadsWatcher to trigger durable syncs.
 * When .beads files change, call this to sync all Beads issues.
 */
async function scheduleBeadsFileChange(input) {
    const client = await getClient();
    const workflowId = `beads-change-${input.projectIdentifier}-${Date.now()}`;
    const handle = await client.workflow.start('BeadsFileChangeWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Scheduled Beads file change workflow: ${workflowId}`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Execute a Beads file change workflow and wait for result
 */
async function executeBeadsFileChange(input) {
    const client = await getClient();
    const workflowId = `beads-change-${input.projectIdentifier}-${Date.now()}`;
    return await client.workflow.execute('BeadsFileChangeWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
/**
 * Schedule a Vibe SSE change workflow
 *
 * This is the main entry point for VibeEventWatcher to trigger durable syncs.
 * When Vibe SSE events indicate task changes, call this to sync to Huly.
 */
async function scheduleVibeSSEChange(input) {
    const client = await getClient();
    const workflowId = `vibe-sse-${input.vibeProjectId}-${Date.now()}`;
    const handle = await client.workflow.start('VibeSSEChangeWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
    console.log(`[Temporal] Scheduled Vibe SSE change workflow: ${workflowId}`);
    return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
    };
}
/**
 * Execute a Vibe SSE change workflow and wait for result
 */
async function executeVibeSSEChange(input) {
    const client = await getClient();
    const workflowId = `vibe-sse-${input.vibeProjectId}-${Date.now()}`;
    return await client.workflow.execute('VibeSSEChangeWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
// ============================================================
// HULY WEBHOOK CHANGE WORKFLOWS
// ============================================================
/**
 * Schedule a Huly webhook change workflow (fire and forget)
 *
 * Processes Huly webhook change events and syncs to Vibe/Beads.
 * Returns immediately after scheduling.
 */
async function scheduleHulyWebhookChange(input) {
    const client = await getClient();
    const workflowId = `huly-webhook-${input.type}-${Date.now()}`;
    const handle = await client.workflow.start('HulyWebhookChangeWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
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
    const client = await getClient();
    const workflowId = `huly-webhook-${input.type}-${Date.now()}`;
    return await client.workflow.execute('HulyWebhookChangeWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
    });
}
//# sourceMappingURL=client.js.map