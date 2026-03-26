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
const memoryBuilders_1 = require("../lib/memoryBuilders");
const PRIORITY_MAP = {
    0: 'urgent',
    1: 'high',
    2: 'medium',
    3: 'low',
    4: 'none',
};
/**
 * Normalize a raw beads issue into the format expected by LettaMemoryBuilders.
 * This ensures all builders get consistent data with _beads.raw_status etc.
 */
function normalizeIssue(raw) {
    return {
        id: raw.id,
        identifier: raw.id,
        title: raw.title || 'Untitled',
        description: raw.description || '',
        status: raw.status || 'open',
        priority: PRIORITY_MAP[raw.priority ?? 4] || 'none',
        createdOn: raw.created_at ? new Date(raw.created_at).getTime() : Date.now(),
        modifiedOn: raw.updated_at ? new Date(raw.updated_at).getTime() : Date.now(),
        component: raw.issue_type || null,
        assignee: raw.assignee || null,
        _beads: {
            raw_status: raw.status || 'open',
            raw_priority: raw.priority ?? 4,
            closed_at: raw.closed_at || null,
            close_reason: raw.close_reason || null,
        },
    };
}
// ============================================================
// LETTA MEMORY ACTIVITIES
// ============================================================
/**
 * Update Letta agent memory with project state from beads data.
 *
 * Builds ALL memory blocks (board_metrics, project, board_config, hotspots,
 * backlog_summary, recent_activity, components) and upserts them via the
 * Letta block modify API.
 */
async function updateLettaMemory(input) {
    const { agentId, project, issues, gitRepoPath, gitUrl, activityData } = input;
    console.log(`[Temporal:Orchestration] Updating Letta memory for agent ${agentId} (${issues.length} issues)`);
    try {
        const lettaUrl = process.env.LETTA_BASE_URL || process.env.LETTA_API_URL;
        const lettaPassword = process.env.LETTA_PASSWORD;
        if (!lettaUrl || !lettaPassword) {
            console.log('[Temporal:Orchestration] Letta not configured, skipping memory update');
            return { success: true };
        }
        // Normalize issues if they're raw beads format (no _beads field)
        const normalized = issues.map((issue) => issue._beads ? issue : normalizeIssue(issue));
        // Build ALL memory blocks using beads-aware builders (async due to ESM bridge)
        const blocks = [
            { label: 'board_metrics', value: JSON.stringify(await (0, memoryBuilders_1.buildBoardMetrics)(normalized), null, 2) },
            { label: 'project', value: JSON.stringify(await (0, memoryBuilders_1.buildProjectMeta)(project, gitRepoPath || null, gitUrl || null), null, 2) },
            { label: 'board_config', value: JSON.stringify(await (0, memoryBuilders_1.buildBoardConfig)(), null, 2) },
            { label: 'hotspots', value: JSON.stringify(await (0, memoryBuilders_1.buildHotspots)(normalized), null, 2) },
            { label: 'backlog_summary', value: JSON.stringify(await (0, memoryBuilders_1.buildBacklogSummary)(normalized), null, 2) },
            { label: 'components', value: JSON.stringify(await (0, memoryBuilders_1.buildComponentsSummary)(normalized), null, 2) },
        ];
        // Add recent_activity if activity data provided
        if (activityData) {
            blocks.push({
                label: 'recent_activity',
                value: JSON.stringify(await (0, memoryBuilders_1.buildRecentActivity)(activityData), null, 2),
            });
        }
        // Fetch existing blocks from agent to get block IDs
        const agentResp = await (0, httpPool_1.pooledFetch)(`${lettaUrl}/v1/agents/${agentId}`, {
            headers: { Authorization: `Bearer ${lettaPassword}` },
        });
        if (!agentResp.ok) {
            throw new Error(`Failed to fetch agent: ${agentResp.status} ${agentResp.statusText}`);
        }
        const agentData = await agentResp.json();
        const existingBlocks = agentData?.memory?.blocks || [];
        const blockMap = new Map(existingBlocks.map((b) => [b.label, b]));
        // Upsert each block
        let updatedCount = 0;
        let skippedCount = 0;
        for (const block of blocks) {
            const existing = blockMap.get(block.label);
            if (existing) {
                // Skip if content unchanged
                if (existing.value === block.value) {
                    skippedCount++;
                    continue;
                }
                // Update existing block via PATCH /v1/blocks/{id}
                const resp = await (0, httpPool_1.pooledFetch)(`${lettaUrl}/v1/blocks/${existing.id}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${lettaPassword}`,
                    },
                    body: JSON.stringify({ value: block.value }),
                });
                if (!resp.ok) {
                    console.warn(`[Temporal:Orchestration] Failed to update block "${block.label}": ${resp.status}`);
                    continue;
                }
                updatedCount++;
            }
            else {
                // Create new block and attach to agent
                const createResp = await (0, httpPool_1.pooledFetch)(`${lettaUrl}/v1/blocks`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${lettaPassword}`,
                    },
                    body: JSON.stringify({ label: block.label, value: block.value }),
                });
                if (!createResp.ok) {
                    console.warn(`[Temporal:Orchestration] Failed to create block "${block.label}": ${createResp.status}`);
                    continue;
                }
                const newBlock = await createResp.json();
                // Attach block to agent
                const attachResp = await (0, httpPool_1.pooledFetch)(`${lettaUrl}/v1/agents/${agentId}/core-memory/blocks/attach/${newBlock.id}`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${lettaPassword}` },
                });
                if (!attachResp.ok) {
                    console.warn(`[Temporal:Orchestration] Failed to attach block "${block.label}": ${attachResp.status}`);
                    continue;
                }
                updatedCount++;
            }
        }
        console.log(`[Temporal:Orchestration] Updated ${updatedCount} blocks, skipped ${skippedCount} unchanged for ${agentId}`);
        return { success: true, blocksUpdated: updatedCount };
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