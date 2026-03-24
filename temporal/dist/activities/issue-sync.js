"use strict";
/**
 * Issue Sync Activities for Temporal
 *
 * These activities handle cross-system issue synchronization
 * with proper error typing for Temporal's retry policies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncToHuly = syncToHuly;
exports.syncToVibe = syncToVibe;
exports.syncToBeads = syncToBeads;
exports.updateLettaMemory = updateLettaMemory;
exports.compensateHulyCreate = compensateHulyCreate;
exports.compensateVibeCreate = compensateVibeCreate;
exports.compensateBeadsCreate = compensateBeadsCreate;
const activity_1 = require("@temporalio/activity");
const lib_1 = require("../lib");
const VIBE_API_URL = process.env.VIBE_API_URL || 'http://localhost:3105/api';
const VIBESYNC_API_URL = process.env.VIBESYNC_API_URL || 'http://localhost:3456';
const TIMEOUT = 30000;
function getVibeClient() {
    return (0, lib_1.createVibeClient)(process.env.VIBE_API_URL || VIBE_API_URL, { timeout: TIMEOUT });
}
function getVibeSyncClient() {
    return (0, lib_1.createVibeSyncClient)(process.env.VIBESYNC_API_URL || VIBESYNC_API_URL, {
        timeout: TIMEOUT,
    });
}
// Status mapping between systems
const STATUS_HULY_TO_VIBE = {
    Backlog: 'todo',
    Todo: 'todo',
    'In Progress': 'inprogress',
    'In Review': 'inreview',
    Done: 'done',
    Canceled: 'cancelled',
};
const STATUS_VIBE_TO_HULY = {
    todo: 'Todo',
    inprogress: 'In Progress',
    inreview: 'In Review',
    done: 'Done',
    cancelled: 'Canceled',
};
async function syncToHuly(_input) {
    console.warn('[Huly Activity] Huly sync removed — returning no-op');
    return { success: true, skipped: true };
}
/**
 * Sync issue to VibeKanban
 */
async function syncToVibe(input) {
    const { issue, operation } = input;
    console.log(`[Vibe Activity] ${operation} task: ${issue.identifier || issue.title}`);
    try {
        const vibeStatus = STATUS_HULY_TO_VIBE[issue.status] || 'todo';
        if (operation === 'create') {
            const result = await getVibeClient().createTask(issue.projectId, {
                title: issue.title,
                description: issue.description || '',
                status: vibeStatus,
                hulyRef: issue.identifier,
            });
            console.log(`[Vibe Activity] Created task: ${result.id}`);
            return { success: true, systemId: result.id };
        }
        if (operation === 'update' && issue.vibeId) {
            await getVibeClient().updateTask(issue.vibeId, { status: vibeStatus });
            console.log(`[Vibe Activity] Updated task: ${issue.vibeId}`);
            return { success: true, systemId: issue.vibeId };
        }
        return { success: true };
    }
    catch (error) {
        return handleActivityError(error, 'Vibe');
    }
}
/**
 * Sync issue to Beads (via CLI)
 * Note: In atomic workflow mode, failures are fatal and retried by Temporal.
 */
async function syncToBeads(input) {
    const { issue, operation } = input;
    console.log(`[Beads Activity] ${operation} issue: ${issue.identifier || issue.title}`);
    const BEADS_SYNC_ENABLED = process.env.BEADS_SYNC_ENABLED === 'true';
    if (!BEADS_SYNC_ENABLED) {
        console.log(`[Beads Activity] Beads sync disabled, skipping`);
        return { success: true };
    }
    try {
        const result = await getVibeSyncClient().syncBeads({
            projectId: issue.projectId,
        });
        const workflowId = result.results?.[0]?.workflowId;
        console.log(`[Beads Activity] Synced: ${workflowId || 'ok'}`);
        return { success: true, systemId: workflowId };
    }
    catch (error) {
        return handleActivityError(error, 'Beads');
    }
}
/**
 * Update Letta agent memory with sync result
 */
async function updateLettaMemory(input) {
    // Re-use the existing Letta activity
    // This is optional - only runs if agentId is provided
    if (!input.agentId) {
        return { success: true };
    }
    console.log(`[Letta Activity] Updating memory for agent: ${input.agentId}`);
    // For now, just log - the main Letta memory update happens in the orchestrator
    // after the full sync completes
    return { success: true };
}
async function compensateHulyCreate(_input) {
    console.warn('[Huly Activity] Huly compensation removed — returning no-op');
    return { success: true, skipped: true };
}
/**
 * Best-effort compensation: delete newly created Vibe task.
 */
async function compensateVibeCreate(input) {
    if (!input.vibeId)
        return { success: true, skipped: true };
    try {
        await getVibeClient().deleteTask(input.vibeId);
        return { success: true };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
/**
 * Best-effort compensation: remove newly created Beads issue.
 * Uses optional VibeSync endpoint if available.
 */
async function compensateBeadsCreate(input) {
    if (!input.beadsId)
        return { success: true, skipped: true };
    try {
        await getVibeSyncClient().deleteBeads({ beadsId: input.beadsId });
        return { success: true };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
/**
 * Handle HTTP errors with proper Temporal error classification
 */
async function handleHttpError(response, system, operation) {
    const status = response.status;
    let errorDetail = '';
    try {
        const errorBody = await response.text();
        errorDetail = errorBody.substring(0, 500);
    }
    catch {
        errorDetail = response.statusText;
    }
    if (status === 404) {
        throw activity_1.ApplicationFailure.nonRetryable(`${system} not found: ${errorDetail}`, `${system}NotFoundError`);
    }
    if (status === 400 || status === 422) {
        throw activity_1.ApplicationFailure.nonRetryable(`${system} validation error: ${errorDetail}`, `${system}ValidationError`);
    }
    if (status >= 500) {
        throw activity_1.ApplicationFailure.retryable(`${system} server error ${status}: ${errorDetail}`, `${system}ServerError`);
    }
    throw activity_1.ApplicationFailure.nonRetryable(`${system} HTTP ${status}: ${errorDetail}`, `${system}APIError`);
}
/**
 * Handle activity errors with proper classification
 */
function handleActivityError(error, system) {
    if (error instanceof activity_1.ApplicationFailure) {
        throw error;
    }
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes('timeout') || message.includes('aborted')) {
            throw activity_1.ApplicationFailure.retryable(`${system} timeout: ${error.message}`, `${system}TimeoutError`);
        }
        if (message.includes('fetch') ||
            message.includes('network') ||
            message.includes('econnrefused')) {
            throw activity_1.ApplicationFailure.retryable(`${system} network error: ${error.message}`, `${system}NetworkError`);
        }
        if (message.includes('500') || message.includes('502') || message.includes('503')) {
            throw activity_1.ApplicationFailure.retryable(`${system} server error: ${error.message}`, `${system}ServerError`);
        }
    }
    throw activity_1.ApplicationFailure.retryable(`${system} unexpected error: ${error instanceof Error ? error.message : String(error)}`, `${system}Error`);
}
//# sourceMappingURL=issue-sync.js.map