/**
 * Orchestration Activities — Letta, Metrics & Helpers
 *
 * Activities for Letta memory updates, metrics recording, and shared error handling.
 */

import { ApplicationFailure } from '@temporalio/activity';
import type { HulyProject, HulyIssue } from './orchestration';

// ============================================================
// LETTA MEMORY ACTIVITIES
// ============================================================

/**
 * Update Letta agent memory with project state
 */
export async function updateLettaMemory(input: {
  agentId: string;
  hulyProject: HulyProject;
  hulyIssues: HulyIssue[];
  gitRepoPath?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { agentId, hulyProject, hulyIssues } = input;

  console.log(`[Temporal:Orchestration] Updating Letta memory for agent ${agentId}`);

  try {
    const lettaUrl = process.env.LETTA_BASE_URL || process.env.LETTA_API_URL;
    const lettaPassword = process.env.LETTA_PASSWORD;

    if (!lettaUrl || !lettaPassword) {
      console.log('[Temporal:Orchestration] Letta not configured, skipping memory update');
      return { success: true };
    }

    // Build memory blocks
    const boardMetrics = buildBoardMetrics(hulyIssues);
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

export function buildBoardMetrics(hulyIssues: HulyIssue[]): string {
  const statusCounts: Record<string, number> = {};

  for (const issue of hulyIssues) {
    const status = issue.status || 'Unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  return JSON.stringify({
    totalIssues: hulyIssues.length,
    byStatus: statusCounts,
    lastUpdated: new Date().toISOString(),
  });
}

export function buildProjectMeta(hulyProject: HulyProject, hulyIssues: HulyIssue[]): string {
  return JSON.stringify({
    identifier: hulyProject.identifier,
    name: hulyProject.name,
    issueCount: hulyIssues.length,
    lastSynced: new Date().toISOString(),
  });
}

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
