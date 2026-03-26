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

import { ApplicationFailure } from '@temporalio/activity';
import { pooledFetch } from '../lib/httpPool';
import {
  buildBoardMetrics as buildBeadsBoardMetrics,
  buildProjectMeta as buildBeadsProjectMeta,
  buildBoardConfig as buildBeadsBoardConfig,
  buildHotspots as buildBeadsHotspots,
  buildBacklogSummary as buildBeadsBacklogSummary,
  buildRecentActivity as buildBeadsRecentActivity,
  buildComponentsSummary as buildBeadsComponentsSummary,
  buildBoardMetricsFromSQL,
  buildBacklogSummaryFromSQL,
  buildHotspotsFromSQL,
  buildComponentsSummaryFromSQL,
} from '../lib/memoryBuilders';
import { getDoltQueryServiceClass } from './orchestration-git';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/** Raw beads issue as returned by fetchBeadsIssues activity */
interface RawBeadsIssue {
  id: string;
  title: string;
  status: string;
  priority?: number;
  description?: string;
  labels?: string[];
  created_at?: string;
  updated_at?: string;
  issue_type?: string;
  assignee?: string;
  closed_at?: string;
  close_reason?: string;
}

/** Normalized issue format expected by LettaMemoryBuilders */
interface NormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  createdOn: number;
  modifiedOn: number;
  component: string | null;
  assignee: string | null;
  _beads: {
    raw_status: string;
    raw_priority: number;
    closed_at: string | null;
    close_reason: string | null;
  };
}

interface Project {
  name: string;
  identifier: string;
  description?: string;
  status?: string;
}

const PRIORITY_MAP: Record<number, string> = {
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
function normalizeIssue(raw: RawBeadsIssue): NormalizedIssue {
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
 * Build all memory blocks from direct Dolt SQL queries.
 *
 * Connects to the Dolt server for the given repo, runs targeted aggregation
 * queries, and feeds pre-computed results to the SQL builder variants.
 *
 * @returns Array of { label, value } blocks, or null if SQL path fails
 */
async function buildBlocksFromSQL(
  gitRepoPath: string,
  project: Project,
  gitUrl?: string,
  sinceCommit?: string,
): Promise<Array<{ label: string; value: string }> | null> {
  let dolt: any = null;

  try {
    const DoltQueryServiceClass = await getDoltQueryServiceClass();
    dolt = new DoltQueryServiceClass();
    await dolt.connect(gitRepoPath);

    // Run SQL queries in parallel for efficiency
    const [statusCounts, openByPriority, blockedRows, agingWipRows, highPriorityRows, typeStatsRows] =
      await Promise.all([
        // board_metrics: status counts
        dolt.getStatusCounts(),

        // backlog_summary: open issues sorted by priority
        dolt.getOpenByPriority(),

        // hotspots — blocked: keyword search in title/description
        dolt.pool.execute(
          `SELECT id, title, status, description, updated_at, priority
           FROM issues
           WHERE (LOWER(title) LIKE '%blocked%'
              OR LOWER(title) LIKE '%blocker%'
              OR LOWER(title) LIKE '%waiting on%'
              OR LOWER(title) LIKE '%waiting for%'
              OR LOWER(title) LIKE '%stuck%'
              OR LOWER(description) LIKE '%blocked%'
              OR LOWER(description) LIKE '%blocker%'
              OR LOWER(description) LIKE '%waiting on%'
              OR LOWER(description) LIKE '%waiting for%'
              OR LOWER(description) LIKE '%stuck%')
             AND status != 'closed'
           LIMIT 10`
        ).then(([rows]: any) => rows),

        // hotspots — aging WIP: in-progress older than 7 days
        dolt.pool.execute(
          `SELECT id, title, status, updated_at, priority
           FROM issues
           WHERE status = 'in-progress'
             AND updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
           ORDER BY updated_at ASC
           LIMIT 10`
        ).then(([rows]: any) => rows),

        // hotspots — high priority open (priority 0=urgent, 1=high)
        dolt.pool.execute(
          `SELECT id, title, status, priority
           FROM issues
           WHERE status = 'open' AND priority <= 1
           ORDER BY priority ASC
           LIMIT 10`
        ).then(([rows]: any) => rows),

        // components: issue_type × status counts
        dolt.pool.execute(
          `SELECT issue_type, status, COUNT(*) AS count
           FROM issues
           GROUP BY issue_type, status`
        ).then(([rows]: any) => rows),
      ]);

    // Build blocks from pre-aggregated data
    const blocks: Array<{ label: string; value: string }> = [
      {
        label: 'board_metrics',
        value: JSON.stringify(await buildBoardMetricsFromSQL(statusCounts), null, 2),
      },
      {
        label: 'project',
        value: JSON.stringify(await buildBeadsProjectMeta(project, gitRepoPath || null, gitUrl || null), null, 2),
      },
      {
        label: 'board_config',
        value: JSON.stringify(await buildBeadsBoardConfig(), null, 2),
      },
      {
        label: 'hotspots',
        value: JSON.stringify(
          await buildHotspotsFromSQL({
            blocked: blockedRows,
            agingWip: agingWipRows,
            highPriority: highPriorityRows,
          }),
          null,
          2,
        ),
      },
      {
        label: 'backlog_summary',
        value: JSON.stringify(await buildBacklogSummaryFromSQL(openByPriority), null, 2),
      },
      {
        label: 'components',
        value: JSON.stringify(await buildComponentsSummaryFromSQL(typeStatsRows), null, 2),
      },
    ];

    // recent_activity via Dolt diff (if a sinceCommit was provided)
    if (sinceCommit) {
      try {
        const changes = await dolt.getRecentChanges(sinceCommit);
        const activityData = {
          since: sinceCommit,
          activities: changes.slice(0, 10).map((c: any) => ({
            type: c.diff_type === 'added' ? 'issue.created' : 'issue.updated',
            issue: c.to_id || c.from_id,
            title: c.to_title || c.from_title || '',
            status: c.to_status || c.from_status || '',
            timestamp: c.to_updated_at || c.from_updated_at || null,
          })),
          summary: {
            created: changes.filter((c: any) => c.diff_type === 'added').length,
            updated: changes.filter((c: any) => c.diff_type === 'modified').length,
            total: changes.length,
          },
          byStatus: {},
        };

        blocks.push({
          label: 'recent_activity',
          value: JSON.stringify(await buildBeadsRecentActivity(activityData), null, 2),
        });
      } catch (diffError) {
        console.warn(`[Temporal:Orchestration] Dolt diff for recent_activity failed: ${diffError}`);
        // Non-fatal: skip recent_activity block
      }
    }

    console.log(`[Temporal:Orchestration] Built ${blocks.length} blocks from Dolt SQL`);
    return blocks;
  } catch (error) {
    console.warn(`[Temporal:Orchestration] SQL block build failed: ${error}`);
    return null;
  } finally {
    if (dolt) {
      try {
        await dolt.disconnect();
      } catch {
        // ignore disconnect errors
      }
    }
  }
}

// ============================================================
// LEGACY ARRAY-BASED BLOCK BUILDERS
// ============================================================

/**
 * Build all memory blocks from an issue array (original path).
 * Normalizes issues, then passes to the array-based builders.
 */
async function buildBlocksFromArray(
  issues: RawBeadsIssue[] | NormalizedIssue[],
  project: Project,
  gitRepoPath?: string,
  gitUrl?: string,
  activityData?: any,
): Promise<Array<{ label: string; value: string }>> {
  // Normalize issues if they're raw beads format (no _beads field)
  const normalized: NormalizedIssue[] = issues.map((issue: any) =>
    issue._beads ? issue : normalizeIssue(issue as RawBeadsIssue)
  );

  // Build ALL memory blocks using beads-aware builders (async due to ESM bridge)
  const blocks: Array<{ label: string; value: string }> = [
    { label: 'board_metrics', value: JSON.stringify(await buildBeadsBoardMetrics(normalized), null, 2) },
    { label: 'project', value: JSON.stringify(await buildBeadsProjectMeta(project, gitRepoPath || null, gitUrl || null), null, 2) },
    { label: 'board_config', value: JSON.stringify(await buildBeadsBoardConfig(), null, 2) },
    { label: 'hotspots', value: JSON.stringify(await buildBeadsHotspots(normalized), null, 2) },
    { label: 'backlog_summary', value: JSON.stringify(await buildBeadsBacklogSummary(normalized), null, 2) },
    { label: 'components', value: JSON.stringify(await buildBeadsComponentsSummary(normalized), null, 2) },
  ];

  // Add recent_activity if activity data provided
  if (activityData) {
    blocks.push({
      label: 'recent_activity',
      value: JSON.stringify(await buildBeadsRecentActivity(activityData), null, 2),
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
export async function updateLettaMemory(input: {
  agentId: string;
  project: Project;
  issues?: RawBeadsIssue[] | NormalizedIssue[];
  gitRepoPath?: string;
  gitUrl?: string;
  activityData?: any;
  sinceCommit?: string;
}): Promise<{ success: boolean; error?: string; blocksUpdated?: number }> {
  const { agentId, project, issues, gitRepoPath, gitUrl, activityData, sinceCommit } = input;

  const issueCount = issues?.length ?? 0;
  const mode = gitRepoPath ? 'sql' : 'array';
  console.log(
    `[Temporal:Orchestration] Updating Letta memory for agent ${agentId}` +
    ` (mode=${mode}, issues=${issueCount}, gitRepoPath=${gitRepoPath || 'none'})`
  );

  try {
    const lettaUrl = process.env.LETTA_BASE_URL || process.env.LETTA_API_URL;
    const lettaPassword = process.env.LETTA_PASSWORD;

    if (!lettaUrl || !lettaPassword) {
      console.log('[Temporal:Orchestration] Letta not configured, skipping memory update');
      return { success: true };
    }

    // Build blocks: try SQL path first if gitRepoPath available, fallback to array
    let blocks: Array<{ label: string; value: string }> | null = null;

    if (gitRepoPath) {
      blocks = await buildBlocksFromSQL(gitRepoPath, project, gitUrl, sinceCommit);
    }

    if (!blocks) {
      // Fallback to legacy array path
      if (issues && issues.length > 0) {
        blocks = await buildBlocksFromArray(issues, project, gitRepoPath, gitUrl, activityData);
      } else {
        // No SQL path and no issues — build with empty array for baseline blocks
        blocks = await buildBlocksFromArray([], project, gitRepoPath, gitUrl, activityData);
      }
    }

    // Fetch existing blocks from agent to get block IDs
    const agentResp = await pooledFetch(`${lettaUrl}/v1/agents/${agentId}`, {
      headers: { Authorization: `Bearer ${lettaPassword}` },
    });

    if (!agentResp.ok) {
      throw new Error(`Failed to fetch agent: ${agentResp.status} ${agentResp.statusText}`);
    }

    const agentData = await agentResp.json() as any;
    const existingBlocks: Array<{ id: string; label: string; value: string }> =
      agentData?.memory?.blocks || [];
    const blockMap = new Map(existingBlocks.map((b: any) => [b.label, b]));

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
        const resp = await pooledFetch(`${lettaUrl}/v1/blocks/${existing.id}`, {
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
      } else {
        // Create new block and attach to agent
        const createResp = await pooledFetch(`${lettaUrl}/v1/blocks`, {
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

        const newBlock = await createResp.json() as any;

        // Attach block to agent
        const attachResp = await pooledFetch(
          `${lettaUrl}/v1/agents/${agentId}/core-memory/blocks/attach/${newBlock.id}`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${lettaPassword}` },
          }
        );

        if (!attachResp.ok) {
          console.warn(`[Temporal:Orchestration] Failed to attach block "${block.label}": ${attachResp.status}`);
          continue;
        }

        updatedCount++;
      }
    }

    console.log(
      `[Temporal:Orchestration] Updated ${updatedCount} blocks, skipped ${skippedCount} unchanged for ${agentId}`
    );
    return { success: true, blocksUpdated: updatedCount };
  } catch (error) {
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
export async function recordSyncMetrics(input: {
  projectsProcessed: number;
  issuesSynced: number;
  durationMs: number;
  errors: number;
}): Promise<void> {
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

export function handleOrchestratorError(error: unknown, operation: string): never {
  if (error instanceof ApplicationFailure) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  // Non-retryable errors
  if (
    lowerMessage.includes('404') ||
    lowerMessage.includes('not found') ||
    lowerMessage.includes('401') ||
    lowerMessage.includes('403') ||
    lowerMessage.includes('validation')
  ) {
    throw ApplicationFailure.nonRetryable(
      `${operation} failed: ${message}`,
      'OrchestratorValidationError'
    );
  }

  // Retryable errors
  throw ApplicationFailure.retryable(`${operation} failed: ${message}`, 'OrchestratorError');
}
