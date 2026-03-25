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
} from '../../lib/LettaMemoryBuilders.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

interface BeadsIssue {
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

// ============================================================
// LETTA MEMORY ACTIVITIES
// ============================================================

/**
 * Update Letta agent memory with project state from beads data
 */
export async function updateLettaMemory(input: {
  agentId: string;
  project: Project;
  issues: BeadsIssue[];
  gitRepoPath?: string;
  gitUrl?: string;
}): Promise<{ success: boolean; error?: string }> {
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
    const boardMetrics = buildBeadsBoardMetrics(issues);
    const projectMeta = buildBeadsProjectMeta(project, gitRepoPath || null, gitUrl || null);

    // Update memory blocks via Letta API
    const response = await pooledFetch(`${lettaUrl}/v1/agents/${agentId}/memory`, {
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
