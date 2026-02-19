/**
 * Bidirectional Sync Activities
 *
 * Activities for syncing between Huly, Vibe, and Beads in all directions.
 * Each activity handles one direction of sync.
 */

import { ApplicationFailure } from '@temporalio/activity';
import {
  createVibeClient,
  createHulyClient,
  createBeadsClient,
  mapHulyStatusToVibe,
  mapVibeStatusToHuly,
  mapHulyStatusToBeadsSimple,
  mapHulyPriorityToBeads,
  mapBeadsStatusToHuly,
  mapBeadsStatusToVibe,
} from '../lib';
import { getBeadsStatusForHulyIssue } from './huly-dedupe';

// ============================================================
// TYPES
// ============================================================

interface SyncContext {
  projectIdentifier: string;
  vibeProjectId: string;
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

export async function getVibeTask(input: { taskId: string }): Promise<{
  id: string;
  title: string;
  description?: string;
  status: string;
  updated_at?: string;
} | null> {
  try {
    const client = createVibeClient(process.env.VIBE_API_URL);
    return await client.getTask(input.taskId);
  } catch {
    return null;
  }
}

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
// VIBE → OTHER SYSTEMS
// ============================================================

/**
 * Sync Vibe task to Huly
 */
export async function syncVibeToHuly(input: {
  vibeTask: IssueData;
  hulyIdentifier: string;
  context: SyncContext;
}): Promise<SyncResult> {
  const { vibeTask, hulyIdentifier, context } = input;

  console.log(`[Sync] Vibe → Huly: ${vibeTask.id} → ${hulyIdentifier}`);

  try {
    const hulyStatus = mapVibeStatusToHuly(vibeTask.status);

    // Conflict resolution: beads "closed" wins over stale Vibe status.
    // When Phase 3b sets Huly to Done (from beads closed), Vibe SSE fires
    // and tries to revert Huly back to the stale Vibe status. Block that.
    const beadsState = await getBeadsStatusForHulyIssue(context.projectIdentifier, hulyIdentifier);
    if (beadsState) {
      const beadsHulyStatus = mapBeadsStatusToHuly(beadsState.beadsStatus);
      if (beadsHulyStatus === 'Done' && hulyStatus !== 'Done') {
        console.log(
          `[Sync] Vibe → Huly: Skipped ${hulyIdentifier} — beads says closed, Vibe says ${vibeTask.status}. Beads wins.`
        );
        return { success: true, id: hulyIdentifier, skipped: true };
      }
    }

    const client = createHulyClient(process.env.HULY_API_URL);
    await client.updateIssue(hulyIdentifier, 'status', hulyStatus);

    console.log(`[Sync] Vibe → Huly: Updated ${hulyIdentifier} to ${hulyStatus}`);
    return { success: true, id: hulyIdentifier, updated: true };
  } catch (error) {
    return handleError(error, 'Vibe→Huly');
  }
}

/**
 * Sync Vibe task to Beads
 */
export async function syncVibeToBeads(input: {
  vibeTask: IssueData;
  existingBeadsId?: string;
  context: SyncContext;
}): Promise<SyncResult> {
  const { vibeTask, existingBeadsId, context } = input;

  if (!context.gitRepoPath) {
    return { success: true, skipped: true };
  }

  console.log(`[Sync] Vibe → Beads: ${vibeTask.id}`);

  try {
    const client = createBeadsClient(context.gitRepoPath);

    // Map Vibe status to Beads status
    const beadsStatus =
      vibeTask.status === 'done' || vibeTask.status === 'cancelled'
        ? 'closed'
        : vibeTask.status === 'inprogress' || vibeTask.status === 'inreview'
          ? 'in_progress'
          : 'open';

    if (existingBeadsId) {
      const updated = await client.updateStatus(existingBeadsId, beadsStatus);
      console.log(`[Sync] Vibe → Beads: Updated ${existingBeadsId}`);
      return { success: true, id: updated.id, updated: true };
    }

    // Create new Beads issue
    const issue = await client.createIssue({
      title: vibeTask.title,
      description: vibeTask.description
        ? `${vibeTask.description}\n\n---\nVibe Task: ${vibeTask.id}`
        : `Synced from Vibe: ${vibeTask.id}`,
      status: beadsStatus,
      labels: [`vibe:${vibeTask.id}`],
    });

    console.log(`[Sync] Vibe → Beads: Created ${issue.id}`);
    return { success: true, id: issue.id, created: true };
  } catch (error) {
    // Beads errors non-fatal
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[Sync] Vibe → Beads: Non-fatal error: ${errorMsg}`);
    return { success: true, skipped: true, error: errorMsg };
  }
}

// ============================================================
// HULY → OTHER SYSTEMS
// ============================================================

/**
 * Sync Huly issue to Vibe
 */
export async function syncHulyToVibe(input: {
  hulyIssue: IssueData;
  existingVibeId?: string;
  context: SyncContext;
}): Promise<SyncResult> {
  const { hulyIssue, existingVibeId, context } = input;

  if (!context.vibeProjectId) {
    console.log(`[Sync] Huly → Vibe: Skipping ${hulyIssue.id} - no Vibe project`);
    return { success: true, skipped: true };
  }

  console.log(`[Sync] Huly → Vibe: ${hulyIssue.id}`);

  try {
    const client = createVibeClient(process.env.VIBE_API_URL);
    const vibeStatus = mapHulyStatusToVibe(hulyIssue.status);

    if (existingVibeId) {
      await client.updateTask(existingVibeId, 'status', vibeStatus);
      console.log(`[Sync] Huly → Vibe: Updated ${existingVibeId} to ${vibeStatus}`);
      return { success: true, id: existingVibeId, updated: true };
    }

    // Check for existing task by Huly ID
    const existing = await client.findTaskByHulyId(context.vibeProjectId, hulyIssue.id);
    if (existing) {
      await client.updateTask(existing.id, 'status', vibeStatus);
      console.log(`[Sync] Huly → Vibe: Found and updated ${existing.id}`);
      return { success: true, id: existing.id, updated: true };
    }

    // Create new task
    const task = await client.createTask(context.vibeProjectId, {
      title: hulyIssue.title,
      description: hulyIssue.description
        ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.id}`
        : `Synced from Huly: ${hulyIssue.id}`,
      status: vibeStatus,
    });

    console.log(`[Sync] Huly → Vibe: Created ${task.id}`);
    return { success: true, id: task.id, created: true };
  } catch (error) {
    return handleError(error, 'Huly→Vibe');
  }
}

/**
 * Sync Huly issue to Beads
 */
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

    const hulyStatus = mapBeadsStatusToHuly(beadsIssue.status);

    const patch: Record<string, string | undefined> = { status: hulyStatus };

    if (beadsIssue.title) {
      patch.title = beadsIssue.title;
    }
    if (beadsIssue.description !== undefined) {
      patch.description = beadsIssue.description;
    }

    await client.patchIssue(hulyIdentifier, patch);

    console.log(
      `[Sync] Beads → Huly: Patched ${hulyIdentifier} (status=${hulyStatus}, fields=${Object.keys(patch).join(',')})`
    );
    return { success: true, id: hulyIdentifier, updated: true };
  } catch (error) {
    return handleError(error, 'Beads→Huly');
  }
}

/**
 * Sync Beads issue to Vibe
 */
export async function syncBeadsToVibe(input: {
  beadsIssue: IssueData;
  vibeTaskId: string;
  context: SyncContext;
}): Promise<SyncResult> {
  const { beadsIssue, vibeTaskId } = input;

  console.log(`[Sync] Beads → Vibe: ${beadsIssue.id} → ${vibeTaskId}`);

  try {
    const client = createVibeClient(process.env.VIBE_API_URL);

    // Map Beads status to Vibe
    const vibeStatus = mapBeadsStatusToVibe(beadsIssue.status);

    await client.updateTask(vibeTaskId, 'status', vibeStatus);

    console.log(`[Sync] Beads → Vibe: Updated ${vibeTaskId} to ${vibeStatus}`);
    return { success: true, id: vibeTaskId, updated: true };
  } catch (error) {
    return handleError(error, 'Beads→Vibe');
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
