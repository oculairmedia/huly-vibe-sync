import path from 'path';

type NullableNumber = number | null | undefined;

export interface PersistIssueStateInput {
  identifier: string;
  projectIdentifier: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  hulyId?: string;
  vibeTaskId?: string;
  beadsIssueId?: string;
  hulyModifiedAt?: NullableNumber;
  vibeModifiedAt?: NullableNumber;
  beadsModifiedAt?: NullableNumber;
  vibeStatus?: string;
  beadsStatus?: string;
  parentHulyId?: string | null;
  subIssueCount?: number;
}

export interface PersistIssueStateBatchInput {
  issues: PersistIssueStateInput[];
}

export interface PersistIssueStateResult {
  success: boolean;
  updated: number;
  failed: number;
  errors: Array<{ identifier: string; error: string }>;
}

function resolveDbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), 'logs', 'sync-state.db');
}

function normalizeModifiedAt(value: NullableNumber): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value)) return null;
  return Number(value);
}

export async function persistIssueSyncState(
  input: PersistIssueStateInput
): Promise<PersistIssueStateResult> {
  return persistIssueSyncStateBatch({ issues: [input] });
}

export async function persistIssueSyncStateBatch(
  input: PersistIssueStateBatchInput
): Promise<PersistIssueStateResult> {
  const issues = input.issues || [];
  if (issues.length === 0) {
    return { success: true, updated: 0, failed: 0, errors: [] };
  }

  const { createSyncDatabase } = await import('../../lib/database.js');
  const db = createSyncDatabase(resolveDbPath()) as any;

  let updated = 0;
  let failed = 0;
  const errors: Array<{ identifier: string; error: string }> = [];

  try {
    for (const issue of issues) {
      try {
        if (!issue.identifier || !issue.projectIdentifier) {
          throw new Error('identifier and projectIdentifier are required');
        }

        const existing = db.getIssue(issue.identifier);

        db.upsertIssue({
          identifier: issue.identifier,
          project_identifier: issue.projectIdentifier,
          huly_id: issue.hulyId || existing?.huly_id || null,
          vibe_task_id: issue.vibeTaskId || existing?.vibe_task_id || null,
          beads_issue_id: issue.beadsIssueId || existing?.beads_issue_id || null,
          title: issue.title || existing?.title || issue.identifier,
          description: issue.description ?? existing?.description ?? '',
          status: issue.status || existing?.status || 'unknown',
          priority: issue.priority || existing?.priority || 'medium',
          huly_modified_at:
            normalizeModifiedAt(issue.hulyModifiedAt) ??
            normalizeModifiedAt(existing?.huly_modified_at),
          vibe_modified_at:
            normalizeModifiedAt(issue.vibeModifiedAt) ??
            normalizeModifiedAt(existing?.vibe_modified_at),
          beads_modified_at:
            normalizeModifiedAt(issue.beadsModifiedAt) ??
            normalizeModifiedAt(existing?.beads_modified_at),
          vibe_status: issue.vibeStatus || existing?.vibe_status || null,
          beads_status: issue.beadsStatus || existing?.beads_status || null,
          parent_huly_id: issue.parentHulyId ?? existing?.parent_huly_id ?? null,
          sub_issue_count: issue.subIssueCount ?? existing?.sub_issue_count ?? 0,
        });

        updated++;
      } catch (error) {
        failed++;
        errors.push({
          identifier: issue.identifier || 'unknown',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: failed === 0,
      updated,
      failed,
      errors,
    };
  } finally {
    db.close();
  }
}
