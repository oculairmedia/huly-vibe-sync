/**
 * Sync Service Activities for Temporal
 *
 * These activities use pure TypeScript clients for Vibe, Huly, and Beads.
 * Provides proper error handling for Temporal retry classification.
 *
 * This is the production-ready implementation using native TypeScript SDKs.
 */

import { ApplicationFailure } from '@temporalio/activity';
import path from 'path';
import {
  createHulyClient,
  createBeadsClient,
  mapHulyStatusToBeadsSimple,
  mapHulyPriorityToBeads,
  mapBeadsStatusToHuly,
} from '../lib';
import { findMappedIssueByBeadsId, findMappedIssueByTitle, normalizeTitle } from './huly-dedupe';

function appRootModule(modulePath: string): string {
  return path.join(process.cwd(), modulePath);
}

async function findExistingBeadsLink(
  projectIdentifier: string,
  hulyIdentifier: string,
  title?: string
): Promise<string | null> {
  try {
    const { createSyncDatabase } = await import(appRootModule('lib/database.js'));
    const dbPath = process.env.DB_PATH || '/opt/stacks/huly-vibe-sync/logs/sync-state.db';
    const db = createSyncDatabase(dbPath) as any;

    try {
      const mapped = db.getIssue?.(hulyIdentifier);
      if (mapped?.beads_issue_id) {
        return String(mapped.beads_issue_id);
      }

      if (title) {
        const rows = db.getProjectIssues?.(projectIdentifier) || [];
        const normalizedTitle = normalizeTitle(title);
        const byTitle = rows.find(
          (row: { title?: string; beads_issue_id?: string }) =>
            !!row?.beads_issue_id && normalizeTitle(row?.title || '') === normalizedTitle
        );
        if (byTitle?.beads_issue_id) {
          return String(byTitle.beads_issue_id);
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // Non-fatal - fallback to in-memory dedupe only
  }

  return null;
}

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

  const mappedBeadsId = await findExistingBeadsLink(
    context.projectIdentifier,
    issue.identifier,
    issue.title
  );
  if (mappedBeadsId) {
    console.log(`[Temporal:Beads] Skipped ${issue.identifier} - mapped as ${mappedBeadsId}`);
    return { success: true, skipped: true, id: mappedBeadsId };
  }

  // DEDUPLICATION: Check if issue with same title already exists in Beads
  const normalizedTitle = normalizeTitle(issue.title);
  const existingByTitle = existingBeadsIssues.find(
    b => normalizeTitle(b.title) === normalizedTitle
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
  beadsIssue: BeadsIssue & { description?: string; modifiedAt?: number };
  hulyIdentifier: string;
  context: SyncContext;
}): Promise<SyncActivityResult> {
  const { beadsIssue, hulyIdentifier } = input;

  console.log(`[Temporal:Beads→Huly] Syncing ${beadsIssue.id} to ${hulyIdentifier}`);

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);

    const patch: Record<string, string | undefined> = {};

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
      return { success: true, id: hulyIdentifier, updated: false };
    }

    await hulyClient.patchIssue(hulyIdentifier, patch);

    console.log(
      `[Temporal:Beads→Huly] Patched ${hulyIdentifier} (fields=${Object.keys(patch).join(',')})`
    );
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
    title?: string;
    description?: string;
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

    const FORWARD_STATUSES = ['in_progress', 'closed', 'blocked', 'deferred'];
    const updates = beadsIssues
      .map(issue => {
        const changes: Record<string, string> = {};
        if (FORWARD_STATUSES.includes(issue.status)) {
          changes.status = mapBeadsStatusToHuly(issue.status);
        }
        if (issue.title) {
          changes.title = issue.title;
        }
        if (issue.description !== undefined) {
          changes.description = issue.description;
        }
        return { identifier: issue.hulyIdentifier, changes };
      })
      .filter(u => Object.keys(u.changes).length > 0);

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

    const mappedByBeads = await findMappedIssueByBeadsId(context.projectIdentifier, beadsIssue.id);
    if (mappedByBeads) {
      return {
        success: true,
        skipped: true,
        id: mappedByBeads,
        hulyIdentifier: mappedByBeads,
      };
    }

    let existingIssue = null;
    const mappedByTitle = await findMappedIssueByTitle(context.projectIdentifier, beadsIssue.title);
    if (mappedByTitle) {
      existingIssue = await hulyClient.getIssue(mappedByTitle);
    }

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
