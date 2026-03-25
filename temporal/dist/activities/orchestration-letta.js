"use strict";
/**
 * Orchestration Activities — Letta, Metrics & Helpers
 *
 * Activities for Letta memory updates, metrics recording, and shared error handling.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateLettaMemory = updateLettaMemory;
exports.recordSyncMetrics = recordSyncMetrics;
exports.handleOrchestratorError = handleOrchestratorError;
const activity_1 = require("@temporalio/activity");
const httpPool_1 = require("../lib/httpPool");
const LettaMemoryBuilders_js_1 = require("../../lib/LettaMemoryBuilders.js");
// ============================================================
// LETTA MEMORY ACTIVITIES
// ============================================================
/**
 * Update Letta agent memory with project state from beads data
 */
async function updateLettaMemory(input) {
    const { agentId, project, issues, gitRepoPath, gitUrl } = input;
    console.log(`[Temporal:Orchestration] Updating Letta memory for agent ${agentId}`);
    try {
        const lettaUrl = process.env.LETTA_BASE_URL || process.env.LETTA_API_URL;
        const lettaPassword = process.env.LETTA_PASSWORD;
        if (!lettaUrl || !lettaPassword) {
            console.log('[Temporal:Orchestration] Letta not configured, skipping memory update');
            return { success: true };
        }
        // Build memory blocks using beads-aware builders
        const boardMetrics = (0, LettaMemoryBuilders_js_1.buildBoardMetrics)(issues);
        const projectMeta = (0, LettaMemoryBuilders_js_1.buildProjectMeta)(project, gitRepoPath || null, gitUrl || null);
        // Update memory blocks via Letta API
        const response = await (0, httpPool_1.pooledFetch)(`${lettaUrl}/v1/agents/${agentId}/memory`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${lettaPassword}`,
            },
            body: JSON.stringify({
                blocks: [
                    { label: 'board_metrics', value: JSON.stringify(boardMetrics) },
                    { label: 'project', value: JSON.stringify(projectMeta) },
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
// Note: buildBoardMetrics and buildProjectMeta have been moved to
// lib/LettaMemoryBuilders.js for consistency across the codebase.
// They are imported at the top of this file.
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