/**
 * Issue Sync Activities for Temporal
 *
 * These activities handle cross-system issue synchronization
 * with proper error typing for Temporal's retry policies.
 */

import { ApplicationFailure } from '@temporalio/activity';

// Configuration from environment
const HULY_API_URL = process.env.HULY_API_URL || 'http://localhost:3458/api';
const VIBE_API_URL = process.env.VIBE_API_URL || 'http://localhost:3105/api';
const TIMEOUT = 30000;

// Types
export interface IssueData {
  id?: string;
  identifier?: string;  // e.g., "HVSYN-123"
  title: string;
  description?: string;
  status: string;
  priority?: string;
  projectId: string;
  projectIdentifier?: string;
  hulyId?: string;
  vibeId?: string;
  beadsId?: string;
  modifiedAt?: number;
}

export interface SyncResult {
  success: boolean;
  systemId?: string;
  error?: string;
}

export interface IssueSyncInput {
  issue: IssueData;
  operation: 'create' | 'update' | 'delete';
  source: 'huly' | 'vibe' | 'beads';
}

// Status mapping between systems
const STATUS_HULY_TO_VIBE: Record<string, string> = {
  'Backlog': 'todo',
  'Todo': 'todo',
  'In Progress': 'inprogress',
  'In Review': 'inreview',
  'Done': 'done',
  'Canceled': 'cancelled',
};

const STATUS_VIBE_TO_HULY: Record<string, string> = {
  'todo': 'Todo',
  'inprogress': 'In Progress',
  'inreview': 'In Review',
  'done': 'Done',
  'cancelled': 'Canceled',
};

/**
 * Sync issue to Huly
 */
export async function syncToHuly(input: IssueSyncInput): Promise<SyncResult> {
  const { issue, operation } = input;

  console.log(`[Huly Activity] ${operation} issue: ${issue.identifier || issue.title}`);

  try {
    if (operation === 'create') {
      const response = await fetch(`${HULY_API_URL}/tools/create_issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arguments: {
            project: issue.projectIdentifier,
            title: issue.title,
            description: issue.description || '',
            status: issue.status,
            priority: issue.priority || 'NoPriority',
          }
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      });

      if (!response.ok) {
        await handleHttpError(response, 'Huly', 'create');
      }

      const result = await response.json() as { identifier?: string; id?: string };
      console.log(`[Huly Activity] Created issue: ${result.identifier || result.id}`);

      return { success: true, systemId: result.identifier || result.id };
    }

    if (operation === 'update') {
      // Update status
      const statusResponse = await fetch(`${HULY_API_URL}/tools/update_issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arguments: {
            issue: issue.identifier,
            field: 'status',
            value: issue.status,
          }
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      });

      if (!statusResponse.ok) {
        await handleHttpError(statusResponse, 'Huly', 'update status');
      }

      console.log(`[Huly Activity] Updated issue: ${issue.identifier}`);
      return { success: true, systemId: issue.identifier };
    }

    return { success: true };

  } catch (error) {
    return handleActivityError(error, 'Huly');
  }
}

/**
 * Sync issue to VibeKanban
 */
export async function syncToVibe(input: IssueSyncInput): Promise<SyncResult> {
  const { issue, operation } = input;

  console.log(`[Vibe Activity] ${operation} task: ${issue.identifier || issue.title}`);

  try {
    const vibeStatus = STATUS_HULY_TO_VIBE[issue.status] || 'todo';

    if (operation === 'create') {
      const response = await fetch(`${VIBE_API_URL}/projects/${issue.projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: issue.title,
          description: issue.description || '',
          status: vibeStatus,
          hulyRef: issue.identifier,
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      });

      if (!response.ok) {
        await handleHttpError(response, 'Vibe', 'create');
      }

      const result = await response.json() as { id?: string };
      console.log(`[Vibe Activity] Created task: ${result.id}`);

      return { success: true, systemId: result.id };
    }

    if (operation === 'update' && issue.vibeId) {
      const response = await fetch(`${VIBE_API_URL}/tasks/${issue.vibeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: vibeStatus,
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      });

      if (!response.ok) {
        await handleHttpError(response, 'Vibe', 'update');
      }

      console.log(`[Vibe Activity] Updated task: ${issue.vibeId}`);
      return { success: true, systemId: issue.vibeId };
    }

    return { success: true };

  } catch (error) {
    return handleActivityError(error, 'Vibe');
  }
}

/**
 * Sync issue to Beads (via CLI)
 * Note: This runs shell commands, so it needs to run on a host with beads installed
 */
export async function syncToBeads(input: IssueSyncInput): Promise<SyncResult> {
  const { issue, operation } = input;

  console.log(`[Beads Activity] ${operation} issue: ${issue.identifier || issue.title}`);

  // Beads sync is more complex - it uses shell commands
  // For now, we'll make a REST call to a beads sync endpoint if available
  // or skip if beads sync is not configured

  const BEADS_SYNC_ENABLED = process.env.BEADS_SYNC_ENABLED === 'true';

  if (!BEADS_SYNC_ENABLED) {
    console.log(`[Beads Activity] Beads sync disabled, skipping`);
    return { success: true };
  }

  try {
    // Beads operations are handled by the main VibeSync service
    // We'll call its internal API to trigger beads sync
    const VIBESYNC_API = process.env.VIBESYNC_API_URL || 'http://localhost:3456';

    const response = await fetch(`${VIBESYNC_API}/api/beads/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation,
        issue: {
          identifier: issue.identifier,
          title: issue.title,
          status: issue.status,
          priority: issue.priority,
          projectPath: issue.projectId, // This should be the filesystem path
        }
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!response.ok) {
      // Beads sync failure is non-fatal - log and continue
      console.warn(`[Beads Activity] Sync failed but continuing: ${response.status}`);
      return { success: true }; // Don't fail the workflow for beads
    }

    const result = await response.json() as { beadsId?: string };
    console.log(`[Beads Activity] Synced: ${result.beadsId || 'ok'}`);

    return { success: true, systemId: result.beadsId };

  } catch (error) {
    // Beads failures are non-fatal
    console.warn(`[Beads Activity] Error (non-fatal): ${error instanceof Error ? error.message : error}`);
    return { success: true };
  }
}

/**
 * Update Letta agent memory with sync result
 */
export async function updateLettaMemory(input: {
  agentId: string;
  syncResult: {
    hulyId?: string;
    vibeId?: string;
    beadsId?: string;
    operation: string;
    timestamp: number;
  };
}): Promise<SyncResult> {
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

/**
 * Handle HTTP errors with proper Temporal error classification
 */
async function handleHttpError(response: Response, system: string, operation: string): Promise<never> {
  const status = response.status;
  let errorDetail = '';

  try {
    const errorBody = await response.text();
    errorDetail = errorBody.substring(0, 500);
  } catch {
    errorDetail = response.statusText;
  }

  if (status === 404) {
    throw ApplicationFailure.nonRetryable(
      `${system} not found: ${errorDetail}`,
      `${system}NotFoundError`
    );
  }

  if (status === 400 || status === 422) {
    throw ApplicationFailure.nonRetryable(
      `${system} validation error: ${errorDetail}`,
      `${system}ValidationError`
    );
  }

  if (status >= 500) {
    throw ApplicationFailure.retryable(
      `${system} server error ${status}: ${errorDetail}`,
      `${system}ServerError`
    );
  }

  throw ApplicationFailure.nonRetryable(
    `${system} HTTP ${status}: ${errorDetail}`,
    `${system}APIError`
  );
}

/**
 * Handle activity errors with proper classification
 */
function handleActivityError(error: unknown, system: string): never {
  if (error instanceof ApplicationFailure) {
    throw error;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('timeout') || message.includes('aborted')) {
      throw ApplicationFailure.retryable(
        `${system} timeout: ${error.message}`,
        `${system}TimeoutError`
      );
    }

    if (message.includes('fetch') || message.includes('network') || message.includes('econnrefused')) {
      throw ApplicationFailure.retryable(
        `${system} network error: ${error.message}`,
        `${system}NetworkError`
      );
    }

    if (message.includes('500') || message.includes('502') || message.includes('503')) {
      throw ApplicationFailure.retryable(
        `${system} server error: ${error.message}`,
        `${system}ServerError`
      );
    }
  }

  throw ApplicationFailure.retryable(
    `${system} unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    `${system}Error`
  );
}
