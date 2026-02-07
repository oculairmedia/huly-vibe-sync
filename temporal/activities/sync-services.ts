/**
 * Sync Service Activities for Temporal
 *
 * These activities use pure TypeScript clients for Vibe, Huly, and Beads.
 * Provides proper error handling for Temporal retry classification.
 *
 * This is the production-ready implementation using native TypeScript SDKs.
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
  mapBeadsStatusToVibe,
  mapBeadsStatusToHuly,
} from '../lib';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface HulyIssue {
  identifier: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  modifiedOn?: number;
  parentIssue?: string;
  subIssues?: string[];
}

export interface VibeTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  updated_at?: string;
}

export interface BeadsIssue {
  id: string;
  title: string;
  status: string;
  priority?: number;
  description?: string;
  labels?: string[];
}

export interface SyncContext {
  projectIdentifier: string;
  vibeProjectId: string;
  gitRepoPath?: string;
}

export interface SyncActivityResult {
  success: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
  created?: boolean;
  updated?: boolean;
}

function extractParentIdentifierFromDescription(
  description?: string
): string | null | undefined {
  if (!description) return undefined;

  const match = description.match(
    /(?:Huly Parent(?: Issue)?|Parent Huly Issue):\s*([A-Z]+-\d+|none|null|top-?level)/i
  );

  if (!match) return undefined;
  const value = match[1].trim();
  if (/^(none|null|top-?level)$/i.test(value)) {
    return null;
  }

  return value.toUpperCase();
}

// ============================================================
// VIBE SYNC ACTIVITIES
// ============================================================

/**
 * Create or update a Vibe task from a Huly issue
 */
export async function syncIssueToVibe(input: {
  issue: HulyIssue;
  context: SyncContext;
  existingTaskId?: string;
  operation: 'create' | 'update';
}): Promise<SyncActivityResult> {
  const { issue, context, existingTaskId, operation } = input;

  console.log(`[Temporal:Vibe] ${operation} task for ${issue.identifier}`);

  try {
    const vibeClient = createVibeClient(process.env.VIBE_API_URL);
    const vibeStatus = mapHulyStatusToVibe(issue.status);

    const result = await vibeClient.syncFromHuly(
      context.vibeProjectId,
      {
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        parentIssue: issue.parentIssue,
      },
      vibeStatus,
      existingTaskId
    );

    if (result.skipped) {
      console.log(`[Temporal:Vibe] Skipped ${issue.identifier} - already exists`);
      return { success: true, skipped: true, id: result.task?.id };
    }

    if (result.created) {
      console.log(`[Temporal:Vibe] Created task for ${issue.identifier}: ${result.task?.id}`);
      return { success: true, created: true, id: result.task?.id };
    }

    if (result.updated) {
      console.log(`[Temporal:Vibe] Updated task for ${issue.identifier}: ${result.task?.id}`);
      return { success: true, updated: true, id: result.task?.id };
    }

    return { success: true, id: result.task?.id };
  } catch (error) {
    return handleSyncError(error, 'Vibe');
  }
}

// ============================================================
// HULY SYNC ACTIVITIES
// ============================================================

/**
 * Update a Huly issue from Vibe task changes
 */
export async function syncTaskToHuly(input: {
  task: VibeTask;
  hulyIdentifier: string;
  context: SyncContext;
}): Promise<SyncActivityResult> {
  const { task, hulyIdentifier } = input;

  console.log(`[Temporal:Huly] Updating ${hulyIdentifier} from Vibe task ${task.id}`);

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);
    const hulyStatus = mapVibeStatusToHuly(task.status);

    const result = await hulyClient.syncStatusFromVibe(hulyIdentifier, hulyStatus);

    if (!result.success) {
      throw new Error(result.error || 'Failed to update Huly issue');
    }

    const desiredParent = extractParentIdentifierFromDescription(task.description);
    if (desiredParent !== undefined) {
      const currentIssue = await hulyClient.getIssue(hulyIdentifier);
      const parentValue = (currentIssue as { parentIssue?: unknown } | null)?.parentIssue ?? null;
      const currentParent =
        typeof parentValue === 'string'
          ? parentValue
          : parentValue && typeof parentValue === 'object' && 'identifier' in parentValue
            ? ((parentValue as { identifier?: string }).identifier || null)
            : null;

      if (currentParent !== desiredParent) {
        await hulyClient.setParentIssue(hulyIdentifier, desiredParent);
        console.log(
          `[Temporal:Huly] Updated parent for ${hulyIdentifier}: ${currentParent || 'top-level'} -> ${desiredParent || 'top-level'}`
        );
      }
    }

    console.log(`[Temporal:Huly] Updated ${hulyIdentifier} status to ${hulyStatus}`);
    return { success: true, id: hulyIdentifier, updated: true };
  } catch (error) {
    return handleSyncError(error, 'Huly');
  }
}

// ============================================================
// BEADS SYNC ACTIVITIES
// ============================================================

/**
 * Sync a Huly issue to Beads
 */
export async function syncIssueToBeads(input: {
  issue: HulyIssue;
  context: SyncContext;
  existingBeadsIssues: BeadsIssue[];
}): Promise<SyncActivityResult> {
  const { issue, context, existingBeadsIssues } = input;

  if (!context.gitRepoPath) {
    return { success: true, skipped: true };
  }

  // DEDUPLICATION: Check if issue with same title already exists in Beads
  const normalizedTitle = issue.title.trim().toLowerCase();
  const existingByTitle = existingBeadsIssues.find(
    b => b.title.trim().toLowerCase() === normalizedTitle
  );
  if (existingByTitle) {
    console.log(
      `[Temporal:Beads] Skipped ${issue.identifier} - duplicate title exists as ${existingByTitle.id}`
    );
    return { success: true, skipped: true, id: existingByTitle.id };
  }

  console.log(`[Temporal:Beads] Syncing ${issue.identifier} to Beads`);

  try {
    const beadsClient = createBeadsClient(context.gitRepoPath);

    // Initialize Beads if needed
    if (!beadsClient.isInitialized()) {
      await beadsClient.initialize();
    }

    const beadsStatus = mapHulyStatusToBeadsSimple(issue.status);
    const beadsPriority = mapHulyPriorityToBeads(issue.priority);

    const result = await beadsClient.syncFromHuly(
      {
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
      },
      beadsStatus,
      beadsPriority
    );

    if (result.skipped) {
      console.log(`[Temporal:Beads] Skipped ${issue.identifier} - already synced`);
      return { success: true, skipped: true, id: result.issue?.id };
    }

    if (result.created) {
      console.log(`[Temporal:Beads] Created issue for ${issue.identifier}: ${result.issue?.id}`);
      return { success: true, created: true, id: result.issue?.id };
    }

    if (result.updated) {
      console.log(`[Temporal:Beads] Updated issue for ${issue.identifier}: ${result.issue?.id}`);
      return { success: true, updated: true, id: result.issue?.id };
    }

    return { success: true, id: result.issue?.id };
  } catch (error) {
    // Beads errors are non-fatal - log but don't fail workflow
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[Temporal:Beads] Non-fatal error: ${errorMsg}`);
    return { success: true, skipped: true, error: errorMsg };
  }
}

/**
 * Sync Beads changes back to Huly
 */
export async function syncBeadsToHuly(input: {
  beadsIssue: BeadsIssue;
  hulyIdentifier: string;
  context: SyncContext;
}): Promise<SyncActivityResult> {
  const { beadsIssue, hulyIdentifier } = input;

  console.log(`[Temporal:Beads→Huly] Syncing ${beadsIssue.id} to ${hulyIdentifier}`);

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);

    // Map Beads status to Huly status
    // Note: We'd need labels from the Beads issue for accurate mapping
    const hulyStatus =
      beadsIssue.status === 'closed'
        ? 'Done'
        : beadsIssue.status === 'in_progress'
          ? 'In Progress'
          : 'Backlog';

    const result = await hulyClient.syncStatusFromVibe(hulyIdentifier, hulyStatus);

    if (!result.success) {
      throw new Error(result.error || 'Failed to update Huly issue');
    }

    console.log(`[Temporal:Beads→Huly] Updated ${hulyIdentifier} from Beads`);
    return { success: true, id: hulyIdentifier, updated: true };
  } catch (error) {
    return handleSyncError(error, 'Beads→Huly');
  }
}

export async function syncBeadsToHulyBatch(input: {
  beadsIssues: Array<{
    beadsId: string;
    hulyIdentifier: string;
    status: string;
  }>;
  context: SyncContext;
}): Promise<{
  success: boolean;
  updated: number;
  failed: number;
  errors: Array<{ identifier: string; error: string }>;
}> {
  const { beadsIssues } = input;

  if (beadsIssues.length === 0) {
    return { success: true, updated: 0, failed: 0, errors: [] };
  }

  console.log(`[Temporal:Beads→Huly] Batch syncing ${beadsIssues.length} issues`);

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);

    const updates = beadsIssues.map(issue => ({
      identifier: issue.hulyIdentifier,
      changes: { status: mapBeadsStatusToHuly(issue.status) },
    }));

    console.log(`[Temporal:Beads→Huly] Syncing ${updates.length} issues in batches of 25`);

    let totalUpdated = 0;
    let totalFailed = 0;
    const allErrors: Array<{ identifier: string; error: string }> = [];

    const BATCH_SIZE = 25;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      console.log(
        `[Temporal:Beads→Huly] Batch ${Math.floor(i / BATCH_SIZE) + 1}: updating ${batch.length} issues`
      );

      try {
        const result = await hulyClient.bulkUpdateIssues({ updates: batch });

        totalUpdated += result.succeeded.length;
        totalFailed += result.failed.length;
        allErrors.push(...result.failed);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Temporal:Beads→Huly] Bulk update failed: ${errorMsg}`);
        totalFailed += batch.length;
        for (const entry of batch) {
          allErrors.push({ identifier: entry.identifier, error: errorMsg });
        }
      }
    }

    console.log(
      `[Temporal:Beads→Huly] Batch complete: ${totalUpdated} updated, ${totalFailed} failed`
    );

    return {
      success: totalFailed === 0,
      updated: totalUpdated,
      failed: totalFailed,
      errors: allErrors,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      updated: 0,
      failed: beadsIssues.length,
      errors: beadsIssues.map(i => ({ identifier: i.hulyIdentifier, error: errorMsg })),
    };
  }
}

export async function createBeadsIssueInHuly(input: {
  beadsIssue: BeadsIssue;
  context: SyncContext;
}): Promise<SyncActivityResult & { hulyIdentifier?: string }> {
  const { beadsIssue, context } = input;

  if (beadsIssue.labels?.some(l => l.startsWith('huly:'))) {
    console.log(`[Temporal:Beads→Huly] Skipping ${beadsIssue.id} - already has huly label`);
    return { success: true, skipped: true };
  }

  console.log(`[Temporal:Beads→Huly] Creating Huly issue for ${beadsIssue.id}`);

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);

    const existingIssue = await hulyClient.findIssueByTitle(
      context.projectIdentifier,
      beadsIssue.title
    );
    if (existingIssue) {
      console.log(
        `[Temporal:Beads→Huly] Found existing Huly issue ${existingIssue.identifier} for "${beadsIssue.title}"`
      );

      if (context.gitRepoPath) {
        try {
          const beadsClient = createBeadsClient(context.gitRepoPath);
          await beadsClient.addLabel(beadsIssue.id, `huly:${existingIssue.identifier}`);
          console.log(
            `[Temporal:Beads→Huly] Linked ${beadsIssue.id} to existing ${existingIssue.identifier}`
          );
        } catch (labelError) {
          console.warn(`[Temporal:Beads→Huly] Failed to add label: ${labelError}`);
        }
      }

      return {
        success: true,
        skipped: true,
        id: existingIssue.identifier,
        hulyIdentifier: existingIssue.identifier,
      };
    }

    const priorityMap: Record<number, string> = { 0: 'Urgent', 1: 'High', 2: 'Medium', 3: 'Low' };
    const hulyPriority = priorityMap[beadsIssue.priority ?? 2] || 'Medium';

    const hulyStatus =
      beadsIssue.status === 'closed'
        ? 'Done'
        : beadsIssue.status === 'in_progress'
          ? 'In Progress'
          : 'Backlog';

    const description = [beadsIssue.description || '', '', '---', `Beads Issue: ${beadsIssue.id}`]
      .join('\n')
      .trim();

    const result = (await hulyClient.createIssue(context.projectIdentifier, {
      title: beadsIssue.title,
      description,
      priority: hulyPriority,
      status: hulyStatus,
    })) as HulyIssue;

    if (!result?.identifier) {
      throw new Error('Failed to create Huly issue - no identifier returned');
    }

    console.log(`[Temporal:Beads→Huly] Created ${result.identifier} from ${beadsIssue.id}`);

    if (context.gitRepoPath) {
      try {
        const beadsClient = createBeadsClient(context.gitRepoPath);
        await beadsClient.addLabel(beadsIssue.id, `huly:${result.identifier}`);
        console.log(
          `[Temporal:Beads→Huly] Added huly:${result.identifier} label to ${beadsIssue.id}`
        );
      } catch (labelError) {
        console.warn(`[Temporal:Beads→Huly] Failed to update beads label: ${labelError}`);
      }
    }

    return {
      success: true,
      created: true,
      id: result.identifier,
      hulyIdentifier: result.identifier,
    };
  } catch (error) {
    return handleSyncError(error, 'Beads→Huly Create');
  }
}

export async function createBeadsIssueInVibe(input: {
  beadsIssue: BeadsIssue;
  context: SyncContext;
}): Promise<SyncActivityResult & { vibeTaskId?: string }> {
  const { beadsIssue, context } = input;

  if (beadsIssue.labels?.some(l => l.startsWith('vibe:'))) {
    console.log(`[Temporal:Beads→Vibe] Skipping ${beadsIssue.id} - already has vibe label`);
    return { success: true, skipped: true };
  }

  console.log(`[Temporal:Beads→Vibe] Creating Vibe task for ${beadsIssue.id}`);

  try {
    const vibeClient = createVibeClient(process.env.VIBE_API_URL);
    const vibeStatus = mapBeadsStatusToVibe(beadsIssue.status);

    const result = await vibeClient.syncFromBeads(
      context.vibeProjectId,
      {
        id: beadsIssue.id,
        title: beadsIssue.title,
        description: beadsIssue.description,
        status: beadsIssue.status,
      },
      vibeStatus
    );

    if (result.skipped) {
      console.log(`[Temporal:Beads→Vibe] Skipped ${beadsIssue.id} - already exists`);
      return { success: true, skipped: true, id: result.task?.id, vibeTaskId: result.task?.id };
    }

    if (result.created && result.task) {
      console.log(`[Temporal:Beads→Vibe] Created task ${result.task.id} from ${beadsIssue.id}`);

      if (context.gitRepoPath) {
        try {
          const beadsClient = createBeadsClient(context.gitRepoPath);
          await beadsClient.addLabel(beadsIssue.id, `vibe:${result.task.id}`);
          console.log(
            `[Temporal:Beads→Vibe] Added vibe:${result.task.id} label to ${beadsIssue.id}`
          );
        } catch (labelError) {
          console.warn(`[Temporal:Beads→Vibe] Failed to add label: ${labelError}`);
        }
      }

      return { success: true, created: true, id: result.task.id, vibeTaskId: result.task.id };
    }

    if (result.updated && result.task) {
      console.log(`[Temporal:Beads→Vibe] Updated task ${result.task.id} from ${beadsIssue.id}`);
      return { success: true, updated: true, id: result.task.id, vibeTaskId: result.task.id };
    }

    return { success: true, skipped: true };
  } catch (error) {
    return handleSyncError(error, 'Beads→Vibe Create');
  }
}

export interface BatchSyncResult {
  success: boolean;
  stats: { total: number; created: number; updated: number; skipped: number };
  results: Array<{
    beadsId: string;
    vibeTaskId?: string;
    created: boolean;
    updated: boolean;
    skipped: boolean;
  }>;
}

/**
 * Batch sync beads issues to Vibe - O(1) lookups after single prefetch.
 * Replaces N individual createBeadsIssueInVibe calls with a single batch operation.
 */
export async function syncBeadsToVibeBatch(input: {
  beadsIssues: BeadsIssue[];
  context: SyncContext;
}): Promise<BatchSyncResult> {
  const { beadsIssues, context } = input;

  const issuesToSync = beadsIssues.filter(issue => !issue.labels?.some(l => l.startsWith('vibe:')));

  if (issuesToSync.length === 0) {
    console.log(`[Temporal:Beads→Vibe] All ${beadsIssues.length} issues already synced`);
    return {
      success: true,
      stats: { total: beadsIssues.length, created: 0, updated: 0, skipped: beadsIssues.length },
      results: beadsIssues.map(i => ({
        beadsId: i.id,
        created: false,
        updated: false,
        skipped: true,
      })),
    };
  }

  console.log(`[Temporal:Beads→Vibe] Batch syncing ${issuesToSync.length} issues to Vibe`);

  try {
    const vibeClient = createVibeClient(process.env.VIBE_API_URL);

    const batchInput = issuesToSync.map(issue => ({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      vibeStatus: mapBeadsStatusToVibe(issue.status),
    }));

    const { results: batchResults, stats } = await vibeClient.syncFromBeadsBatch(
      context.vibeProjectId,
      batchInput
    );

    const results = batchResults.map(r => ({
      beadsId: r.beadsId,
      vibeTaskId: r.task?.id,
      created: r.created,
      updated: r.updated,
      skipped: r.skipped,
    }));

    if (context.gitRepoPath) {
      const beadsClient = createBeadsClient(context.gitRepoPath);
      for (const r of results) {
        if (r.created && r.vibeTaskId) {
          try {
            await beadsClient.addLabel(r.beadsId, `vibe:${r.vibeTaskId}`);
          } catch (labelError) {
            console.warn(
              `[Temporal:Beads→Vibe] Failed to add label to ${r.beadsId}: ${labelError}`
            );
          }
        }
      }
    }

    console.log(
      `[Temporal:Beads→Vibe] Batch complete: ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped`
    );
    return { success: true, stats, results };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Temporal:Beads→Vibe] Batch sync failed: ${msg}`);
    return {
      success: false,
      stats: { total: issuesToSync.length, created: 0, updated: 0, skipped: 0 },
      results: [],
    };
  }
}

export async function commitBeadsToGit(input: {
  context: SyncContext;
  message?: string;
}): Promise<SyncActivityResult> {
  const { context, message } = input;

  if (!context.gitRepoPath) {
    return { success: true, skipped: true };
  }

  console.log(`[Temporal:Git] Committing Beads changes in ${context.gitRepoPath}`);

  try {
    const beadsClient = createBeadsClient(context.gitRepoPath);

    if (!beadsClient.isGitRepository()) {
      return { success: true, skipped: true };
    }

    if (!beadsClient.hasUncommittedChanges()) {
      console.log(`[Temporal:Git] No uncommitted Beads changes`);
      return { success: true, skipped: true };
    }

    const committed = await beadsClient.commitChanges(message || 'Sync from VibeSync');

    if (committed) {
      console.log(`[Temporal:Git] Committed Beads changes`);
      return { success: true };
    }

    return { success: true, skipped: true };
  } catch (error) {
    // Git errors are non-fatal
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[Temporal:Git] Non-fatal error: ${errorMsg}`);
    return { success: true, skipped: true, error: errorMsg };
  }
}

// ============================================================
// ERROR HANDLING
// ============================================================

/**
 * Handle sync errors with proper Temporal classification
 */
function handleSyncError(error: unknown, system: string): never {
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
    throw ApplicationFailure.nonRetryable(
      `${system} error: ${message}`,
      `${system}ValidationError`
    );
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
    throw ApplicationFailure.retryable(`${system} error: ${message}`, `${system}ServerError`);
  }

  // Default: retryable (safer)
  throw ApplicationFailure.retryable(`${system} error: ${message}`, `${system}Error`);
}
