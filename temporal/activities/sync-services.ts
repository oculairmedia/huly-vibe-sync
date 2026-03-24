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
import { createBeadsClient } from '../lib';

function normalizeTitle(title: string): string {
  return (title || '')
    .trim()
    .toLowerCase()
    .replace(/^\[.*?\]\s*/, '');
}

function mapHulyStatusToBeadsSimple(status: string): string {
  const map: Record<string, string> = {
    Backlog: 'open',
    Todo: 'open',
    'In Progress': 'in_progress',
    'In Review': 'open',
    Done: 'closed',
    Canceled: 'closed',
  };
  return map[status] || 'open';
}

function mapHulyPriorityToBeads(priority?: string): number {
  const map: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3, None: 4 };
  return map[priority || ''] ?? 2;
}

function appRootModule(modulePath: string): string {
  return path.join(process.cwd(), modulePath);
}

async function findExistingBeadsLink(
  projectIdentifier: string,
  hulyIdentifier: string,
  title?: string
): Promise<string | null> {
  try {
    const { getDb } = await import('./sync-database');
    const db = await getDb();

    const mapped = db.getIssue?.(hulyIdentifier);
    if (mapped?.beads_issue_id) {
      return String(mapped.beads_issue_id);
    }

    if (title) {
      const rows = db.getProjectIssues?.(projectIdentifier) || [];
      const normalizedTitle = normalizeTitle(title);
      for (const row of rows) {
        if (row?.beads_issue_id && normalizeTitle(row?.title || '') === normalizedTitle) {
          return String(row.beads_issue_id);
        }
      }
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
  const existingByTitle = existingBeadsIssues.find(b => {
    if (!b.title) return false;
    return normalizeTitle(b.title) === normalizedTitle;
  });
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

export async function syncBeadsToHuly(_input: {
  beadsIssue: BeadsIssue & { description?: string; modifiedAt?: number };
  hulyIdentifier: string;
  context: SyncContext;
}): Promise<SyncActivityResult> {
  console.warn('[Temporal:Beads→Huly] Huly sync removed — returning no-op');
  return { success: true, skipped: true };
}

export async function syncBeadsToHulyBatch(_input: {
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
  console.warn('[Temporal:Beads→Huly] Huly batch sync removed — returning no-op');
  return { success: true, updated: 0, failed: 0, errors: [] };
}

export async function createBeadsIssueInHuly(_input: {
  beadsIssue: BeadsIssue;
  context: SyncContext;
}): Promise<SyncActivityResult & { hulyIdentifier?: string }> {
  console.warn('[Temporal:Beads→Huly] Huly issue creation removed — returning no-op');
  return { success: true, skipped: true };
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
