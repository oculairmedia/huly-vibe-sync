/**
 * Orchestration Activities — Letta, Metrics & Helpers
 *
 * Activities for Letta memory updates, metrics recording, and shared error handling.
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
} from '../lib/memoryBuilders';

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
// LETTA MEMORY ACTIVITIES
// ============================================================

/**
 * Update Letta agent memory with project state from beads data.
 *
 * Builds ALL memory blocks (board_metrics, project, board_config, hotspots,
 * backlog_summary, recent_activity, components) and upserts them via the
 * Letta block modify API.
 */
export async function updateLettaMemory(input: {
  agentId: string;
  project: Project;
  issues: RawBeadsIssue[] | NormalizedIssue[];
  gitRepoPath?: string;
  gitUrl?: string;
  activityData?: any;
}): Promise<{ success: boolean; error?: string; blocksUpdated?: number }> {
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
