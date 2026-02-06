"use strict";
/**
 * Orchestration Activities — Letta, Metrics & Helpers
 *
 * Activities for Letta memory updates, metrics recording, and shared error handling.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateLettaMemory = updateLettaMemory;
exports.recordSyncMetrics = recordSyncMetrics;
exports.buildBoardMetrics = buildBoardMetrics;
exports.buildProjectMeta = buildProjectMeta;
exports.handleOrchestratorError = handleOrchestratorError;
const activity_1 = require("@temporalio/activity");
// ============================================================
// LETTA MEMORY ACTIVITIES
// ============================================================
/**
 * Update Letta agent memory with project state
 */
async function updateLettaMemory(input) {
    const { agentId, hulyProject, hulyIssues, vibeTasks } = input;
    console.log(`[Temporal:Orchestration] Updating Letta memory for agent ${agentId}`);
    try {
        const lettaUrl = process.env.LETTA_BASE_URL || process.env.LETTA_API_URL;
        const lettaPassword = process.env.LETTA_PASSWORD;
        if (!lettaUrl || !lettaPassword) {
            console.log('[Temporal:Orchestration] Letta not configured, skipping memory update');
            return { success: true };
        }
        // Build memory blocks
        const boardMetrics = buildBoardMetrics(hulyIssues, vibeTasks);
        const projectMeta = buildProjectMeta(hulyProject, hulyIssues);
        // Update memory blocks via Letta API
        const response = await fetch(`${lettaUrl}/v1/agents/${agentId}/memory`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${lettaPassword}`,
            },
            body: JSON.stringify({
                blocks: [
                    { label: 'board_metrics', value: boardMetrics },
                    { label: 'project', value: projectMeta },
                ],
            }),
        });
        if (!response.ok) {
            throw new Error(`Letta API error: ${response.status} ${response.statusText}`);
        }
        console.log(`[Temporal:Orchestration] Updated Letta memory for ${agentId}`);
        return { success: true };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Temporal:Orchestration] Letta memory update failed: ${errorMsg}`);
        // Non-fatal
        return { success: false, error: errorMsg };
    }
}
// ============================================================
// METRICS & RECORDING
// ============================================================
/**
 * Record sync completion metrics
 */
async function recordSyncMetrics(input) {
    const { projectsProcessed, issuesSynced, durationMs, errors } = input;
    console.log(`[Temporal:Orchestration] Sync complete`, {
        projects: projectsProcessed,
        issues: issuesSynced,
        duration: `${(durationMs / 1000).toFixed(2)}s`,
        errors,
    });
    // Could emit to metrics system here (Prometheus, etc.)
}
// ============================================================
// HELPER FUNCTIONS
// ============================================================
function buildBoardMetrics(hulyIssues, vibeTasks) {
    const statusCounts = {};
    for (const issue of hulyIssues) {
        const status = issue.status || 'Unknown';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
    return JSON.stringify({
        totalIssues: hulyIssues.length,
        totalTasks: vibeTasks.length,
        byStatus: statusCounts,
        lastUpdated: new Date().toISOString(),
    });
}
function buildProjectMeta(hulyProject, hulyIssues) {
    return JSON.stringify({
        identifier: hulyProject.identifier,
        name: hulyProject.name,
        issueCount: hulyIssues.length,
        lastSynced: new Date().toISOString(),
    });
}
function handleOrchestratorError(error, operation) {
    if (error instanceof activity_1.ApplicationFailure) {
        throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();
    // Non-retryable errors
    if (lowerMessage.includes('404') ||
        lowerMessage.includes('not found') ||
        lowerMessage.includes('401') ||
        lowerMessage.includes('403') ||
        lowerMessage.includes('validation')) {
        throw activity_1.ApplicationFailure.nonRetryable(`${operation} failed: ${message}`, 'OrchestratorValidationError');
    }
    // Retryable errors
    throw activity_1.ApplicationFailure.retryable(`${operation} failed: ${message}`, 'OrchestratorError');
}
//# sourceMappingURL=orchestration-letta.js.map