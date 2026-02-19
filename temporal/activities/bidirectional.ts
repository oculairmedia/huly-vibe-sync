/**
 * Bidirectional Sync Activities
 *
 * Activities for syncing between Huly, Vibe, and Beads in all directions.
 * Each activity handles one direction of sync.
 */

import { ApplicationFailure } from '@temporalio/activity';
import {
  createHulyClient,
  createBeadsClient,
  mapHulyStatusToBeadsSimple,
  mapHulyPriorityToBeads,
  mapBeadsStatusToHuly,
} from '../lib';

// ============================================================
// TYPES
// ============================================================

interface SyncContext {
  projectIdentifier: string;
  gitRepoPath?: string;
}

interface IssueData {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  modifiedAt?: number;
}

interface SyncResult {
  success: boolean;
  id?: string;
  skipped?: boolean;
  created?: boolean;
  updated?: boolean;
  error?: string;
}

// ============================================================
// GET ISSUE ACTIVITIES (for conflict resolution)
// ============================================================

export async function getHulyIssue(input: { identifier: string }): Promise<{
  identifier: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  modifiedOn?: number;
} | null> {
  try {
    const client = createHulyClient(process.env.HULY_API_URL);
    return await client.getIssue(input.identifier);
  } catch {
    return null;
  }
}

export async function getBeadsIssue(input: { issueId: string; gitRepoPath: string }): Promise<{
  id: string;
  title: string;
  description?: string;
  status: string;
  priority?: number;
  updated_at?: string;
} | null> {
  try {
    const client = createBeadsClient(input.gitRepoPath);
    return await client.getIssue(input.issueId);
  } catch {
    return null;
  }
}

// ============================================================
// HULY → BEADS
// ============================================================

export async function syncHulyToBeads(input: {
  hulyIssue: IssueData;
  existingBeadsId?: string;
  context: SyncContext;
}): Promise<SyncResult> {
  const { hulyIssue, existingBeadsId, context } = input;

  if (!context.gitRepoPath) {
    return { success: true, skipped: true };
  }

  console.log(`[Sync] Huly → Beads: ${hulyIssue.id}`);

  try {
    const client = createBeadsClient(context.gitRepoPath);
    const beadsStatus = mapHulyStatusToBeadsSimple(hulyIssue.status);
    const beadsPriority = mapHulyPriorityToBeads(hulyIssue.priority);

    if (existingBeadsId) {
      const updated = await client.updateStatus(existingBeadsId, beadsStatus);
      console.log(`[Sync] Huly → Beads: Updated ${existingBeadsId}`);
      return { success: true, id: updated.id, updated: true };
    }

    // Check for existing by title
    const existing = await client.findByTitle(hulyIssue.title);
    if (existing) {
      if (existing.status !== beadsStatus) {
        const updated = await client.updateStatus(existing.id, beadsStatus);
        console.log(`[Sync] Huly → Beads: Found and updated ${updated.id}`);
        return { success: true, id: updated.id, updated: true };
      }
      return { success: true, id: existing.id, skipped: true };
    }

    // Create new issue
    const issue = await client.createIssue({
      title: hulyIssue.title,
      description: hulyIssue.description
        ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.id}`
        : `Synced from Huly: ${hulyIssue.id}`,
      status: beadsStatus,
      priority: beadsPriority,
      labels: [`huly:${hulyIssue.id}`],
    });

    console.log(`[Sync] Huly → Beads: Created ${issue.id}`);
    return { success: true, id: issue.id, created: true };
  } catch (error) {
    // Beads errors non-fatal
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[Sync] Huly → Beads: Non-fatal error: ${errorMsg}`);
    return { success: true, skipped: true, error: errorMsg };
  }
}

// ============================================================
// BEADS → OTHER SYSTEMS
// ============================================================

/**
 * Sync Beads issue to Huly
 */
export async function syncBeadsToHuly(input: {
  beadsIssue: IssueData;
  hulyIdentifier: string;
  context: SyncContext;
}): Promise<SyncResult> {
  const { beadsIssue, hulyIdentifier } = input;

  console.log(`[Sync] Beads → Huly: ${beadsIssue.id} → ${hulyIdentifier}`);

  try {
    const client = createHulyClient(process.env.HULY_API_URL);

    const patch: Record<string, string | undefined> = {};

    // Only sync status for intentional state changes, never for 'open' (default)
    const FORWARD_STATUSES = ['in_progress', 'closed', 'blocked', 'deferred'];
    if (FORWARD_STATUSES.includes(beadsIssue.status)) {
      patch.status = mapBeadsStatusToHuly(beadsIssue.status);
    }

    if (beadsIssue.title) {
      patch.title = beadsIssue.title;
    }
    if (beadsIssue.description !== undefined) {
      patch.description = beadsIssue.description;
    }

    if (Object.keys(patch).length === 0) {
      console.log(`[Sync] Beads → Huly: Skipping ${hulyIdentifier} (no actionable changes)`);
      return { success: true, id: hulyIdentifier, updated: false };
    }

    await client.patchIssue(hulyIdentifier, patch);

    console.log(
      `[Sync] Beads → Huly: Patched ${hulyIdentifier} (fields=${Object.keys(patch).join(',')})`
    );
    return { success: true, id: hulyIdentifier, updated: true };
  } catch (error) {
    return handleError(error, 'Beads→Huly');
  }
}

// ============================================================
// UTILITY ACTIVITIES
// ============================================================

/**
 * Commit Beads changes to git
 */
export async function commitBeadsChanges(input: {
  gitRepoPath: string;
  message: string;
}): Promise<SyncResult> {
  try {
    const client = createBeadsClient(input.gitRepoPath);

    if (!client.hasUncommittedChanges()) {
      return { success: true, skipped: true };
    }

    const committed = await client.commitChanges(input.message);
    return { success: true, updated: committed };
  } catch (error) {
    // Git errors non-fatal
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[Sync] Git commit: Non-fatal error: ${errorMsg}`);
    return { success: true, skipped: true, error: errorMsg };
  }
}

// ============================================================
// ERROR HANDLING
// ============================================================

function handleError(error: unknown, direction: string): never {
  if (error instanceof ApplicationFailure) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  // Non-retryable: validation, not found, auth errors
  if (
    lowerMessage.includes('404') ||
    lowerMessage.includes('not found') ||
    lowerMessage.includes('400') ||
    lowerMessage.includes('422') ||
    lowerMessage.includes('validation') ||
    lowerMessage.includes('deserialize') ||
    lowerMessage.includes('401') ||
    lowerMessage.includes('403')
  ) {
    throw ApplicationFailure.nonRetryable(`${direction} error: ${message}`, 'ValidationError');
  }

  // Retryable: server errors, timeouts, network
  if (
    lowerMessage.includes('500') ||
    lowerMessage.includes('502') ||
    lowerMessage.includes('503') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('network')
  ) {
    throw ApplicationFailure.retryable(`${direction} error: ${message}`, 'ServerError');
  }

  // Default: retryable
  throw ApplicationFailure.retryable(`${direction} error: ${message}`, 'SyncError');
}
