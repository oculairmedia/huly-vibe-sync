"use strict";
/**
 * Orchestration Activities — Letta, Metrics & Helpers
 *
 * Activities for Letta memory updates, metrics recording, and shared error handling.
 *
 * Supports two paths for building memory blocks:
 * 1. **SQL path** (preferred): Uses DoltQueryService to run pre-aggregated queries
 *    directly against the Dolt database, avoiding full issue array normalization.
 * 2. **Legacy array path**: Accepts raw/normalized issue arrays and passes them
 *    through the original builders (backward compatible with existing callers).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.disconnectAllPools = disconnectAllPools;
exports.updateLettaMemory = updateLettaMemory;
exports.recordSyncMetrics = recordSyncMetrics;
exports.handleOrchestratorError = handleOrchestratorError;
const activity_1 = require("@temporalio/activity");
const httpPool_1 = require("../lib/httpPool");
const memoryBuilders_1 = require("../lib/memoryBuilders");
const orchestration_git_1 = require("./orchestration-git");
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
// DOLT SQL BLOCK BUILDERS
// ============================================================
/**
 * Pool cache to prevent connection exhaustion.
 * Each gitRepoPath gets one shared DoltQueryService instance.
 */
const poolCache = new Map();
const POOL_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Get or create a cached DoltQueryService pool for a gitRepoPath.
 * Reuses existing connections instead of creating new pools on every call.
 */
async function getOrCreatePool(gitRepoPath) {
    const cached = poolCache.get(gitRepoPath);
    if (cached) {
        cached.lastUsed = Date.now();
        return cached.dolt;
    }
    const DoltQueryServiceClass = await (0, orchestration_git_1.getDoltQueryServiceClass)();
    const dolt = new DoltQueryServiceClass();
    await dolt.connect(gitRepoPath);
    poolCache.set(gitRepoPath, { dolt, lastUsed: Date.now() });
    console.log(`[Temporal:Orchestration] Created new pool for ${gitRepoPath}`);
    return dolt;
}
/**
 * Cleanup idle pools to prevent resource leaks.
 * Called periodically to disconnect stale connections.
 */
function cleanupIdlePools() {
    const now = Date.now();
    const toRemove = [];
    for (const [path, { dolt, lastUsed }] of poolCache) {
        if (now - lastUsed > POOL_IDLE_TIMEOUT_MS) {
            toRemove.push(path);
            dolt.disconnect().catch(() => {
                // ignore disconnect errors
            });
        }
    }
    for (const path of toRemove) {
        poolCache.delete(path);
        console.log(`[Temporal:Orchestration] Cleaned up idle pool for ${path}`);
    }
}
/**
 * Disconnect all cached pools (for graceful shutdown).
 */
async function disconnectAllPools() {
    const disconnects = [];
    for (const { dolt } of poolCache.values()) {
        disconnects.push(dolt.disconnect().catch(() => { }));
    }
    await Promise.allSettled(disconnects);
    poolCache.clear();
    console.log(`[Temporal:Orchestration] Disconnected all pools`);
}
// Run cleanup every minute
setInterval(cleanupIdlePools, 60000);
/**
 * Build all memory blocks from direct Dolt SQL queries.
 *
 * Connects to the Dolt server for the given repo, runs targeted aggregation
 * queries, and feeds pre-computed results to the SQL builder variants.
 *
 * @returns Array of { label, value } blocks, or null if SQL path fails
 */
async function buildBlocksFromSQL(gitRepoPath, project, gitUrl, sinceCommit) {
    let dolt = null;
    try {
        dolt = await getOrCreatePool(gitRepoPath);
        // Run batched SQL queries: 3 queries instead of 6
        const [boardAndComponentStats, hotspots, openByPriority] = await Promise.all([
            // Query 1: Combined board metrics + components (single GROUP BY)
            dolt.getBoardAndComponentStats(),
            // Query 2: All hotspot categories in one UNION query
            dolt.getHotspots(),
            // Query 3: Backlog summary (already optimized)
            dolt.getOpenByPriority(),
        ]);
        // Split boardAndComponentStats into status counts and type stats
        const statusCountsMap = new Map();
        const typeStatsRows = [];
        for (const row of boardAndComponentStats) {
            const status = row.status;
            const issueType = row.issue_type;
            const count = Number(row.cnt);
            // Aggregate by status for board_metrics
            statusCountsMap.set(status, (statusCountsMap.get(status) || 0) + count);
            // Keep per-type breakdowns for components
            typeStatsRows.push({ issue_type: issueType, status, count });
        }
        const statusCounts = Array.from(statusCountsMap.entries()).map(([status, count]) => ({
            status,
            count,
        }));
        // Split hotspots by type
        const blockedRows = hotspots.filter((r) => r.hotspot_type === 'blocked');
        const agingWipRows = hotspots.filter((r) => r.hotspot_type === 'aging_wip');
        const highPriorityRows = hotspots.filter((r) => r.hotspot_type === 'high_priority');
        // Build blocks from pre-aggregated data
        const blocks = [
            {
                label: 'board_metrics',
                value: JSON.stringify(await (0, memoryBuilders_1.buildBoardMetricsFromSQL)(statusCounts), null, 2),
            },
            {
                label: 'project',
                value: JSON.stringify(await (0, memoryBuilders_1.buildProjectMeta)(project, gitRepoPath || null, gitUrl || null), null, 2),
            },
            {
                label: 'board_config',
                value: JSON.stringify(await (0, memoryBuilders_1.buildBoardConfig)(), null, 2),
            },
            {
                label: 'hotspots',
                value: JSON.stringify(await (0, memoryBuilders_1.buildHotspotsFromSQL)({
                    blocked: blockedRows,
                    agingWip: agingWipRows,
                    highPriority: highPriorityRows,
                }), null, 2),
            },
            {
                label: 'backlog_summary',
                value: JSON.stringify(await (0, memoryBuilders_1.buildBacklogSummaryFromSQL)(openByPriority), null, 2),
            },
            {
                label: 'components',
                value: JSON.stringify(await (0, memoryBuilders_1.buildComponentsSummaryFromSQL)(typeStatsRows), null, 2),
            },
        ];
        // recent_activity via Dolt time-travel diff
        try {
            const doltActivityData = await dolt.getRecentActivityFromDolt(24);
            blocks.push({
                label: 'recent_activity',
                value: JSON.stringify(await (0, memoryBuilders_1.buildRecentActivityFromSQL)(doltActivityData), null, 2),
            });
        }
        catch (diffError) {
            console.warn(`[Temporal:Orchestration] Dolt diff for recent_activity failed: ${diffError}`);
            // Non-fatal: skip recent_activity block
        }
        console.log(`[Temporal:Orchestration] Built ${blocks.length} blocks from Dolt SQL`);
        return blocks;
    }
    catch (error) {
        console.warn(`[Temporal:Orchestration] SQL block build failed: ${error}`);
        return null;
    }
    // NOTE: Pool is shared and cached — do not disconnect here
}
// ============================================================
// LEGACY ARRAY-BASED BLOCK BUILDERS
// ============================================================
/**
 * Build all memory blocks from an issue array (original path).
 * Normalizes issues, then passes to the array-based builders.
 */
async function buildBlocksFromArray(issues, project, gitRepoPath, gitUrl, activityData) {
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
    return blocks;
}
// ============================================================
// LETTA MEMORY ACTIVITIES
// ============================================================
/**
 * Update Letta agent memory with project state from beads data.
 *
 * Supports two modes:
 * 1. **SQL mode** (gitRepoPath provided, issues omitted or empty): Builds blocks
 *    directly from Dolt SQL aggregations — more efficient, no issue array needed.
 * 2. **Legacy array mode** (issues provided): Normalizes and loops over the array
 *    using the original builders.
 *
 * When gitRepoPath is provided, the SQL path is attempted first. If it fails
 * (e.g. Dolt server not running), falls back to the array path if issues are
 * available.
 *
 * Builds ALL memory blocks (board_metrics, project, board_config, hotspots,
 * backlog_summary, recent_activity, components) and upserts them via the
 * Letta block modify API.
 */
async function updateLettaMemory(input) {
    const { agentId, project, issues, gitRepoPath, gitUrl, activityData, sinceCommit } = input;
    const issueCount = issues?.length ?? 0;
    const mode = gitRepoPath ? 'sql' : 'array';
    console.log(`[Temporal:Orchestration] Updating Letta memory for agent ${agentId}` +
        ` (mode=${mode}, issues=${issueCount}, gitRepoPath=${gitRepoPath || 'none'})`);
    try {
        const lettaUrl = process.env.LETTA_BASE_URL || process.env.LETTA_API_URL;
        const lettaPassword = process.env.LETTA_PASSWORD;
        if (!lettaUrl || !lettaPassword) {
            console.log('[Temporal:Orchestration] Letta not configured, skipping memory update');
            return { success: true };
        }
        // Build blocks: try SQL path first if gitRepoPath available, fallback to array
        let blocks = null;
        if (gitRepoPath) {
            blocks = await buildBlocksFromSQL(gitRepoPath, project, gitUrl, sinceCommit);
        }
        if (!blocks) {
            // Fallback to legacy array path
            if (issues && issues.length > 0) {
                blocks = await buildBlocksFromArray(issues, project, gitRepoPath, gitUrl, activityData);
            }
            else {
                // No SQL path and no issues — build with empty array for baseline blocks
                blocks = await buildBlocksFromArray([], project, gitRepoPath, gitUrl, activityData);
            }
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