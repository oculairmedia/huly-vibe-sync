import path from 'path';

type NullableNumber = number | null | undefined;

function appRootModule(modulePath: string): string {
  return path.join(process.cwd(), modulePath);
}

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
  parentVibeId?: string | null;
  parentBeadsId?: string | null;
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

type CreateSyncDatabaseFn = (dbPath: string) => any;
type ComputeIssueContentHashFn = (input: {
  title: string;
  description: string;
  status: string;
  priority: string;
}) => string;

let createSyncDatabaseCached: CreateSyncDatabaseFn | null = null;
let computeIssueContentHashCached: ComputeIssueContentHashFn | null = null;
let dbInstance: any = null;
let dbInitPromise: Promise<any> | null = null;
let isDbClosed = false;

export async function getDb(): Promise<any> {
  if (dbInstance && !isDbClosed) {
    return dbInstance;
  }

  if (dbInitPromise) {
    return dbInitPromise;
  }

  dbInitPromise = (async () => {
    if (!createSyncDatabaseCached) {
      const databaseModule = await import(appRootModule('lib/database.js'));
      createSyncDatabaseCached = databaseModule.createSyncDatabase;
    }

    if (!computeIssueContentHashCached) {
      const utilsModule = await import(appRootModule('lib/database/utils.js'));
      computeIssueContentHashCached = utilsModule.computeIssueContentHash;
    }

    dbInstance = createSyncDatabaseCached!(resolveDbPath());
    isDbClosed = false;
    return dbInstance;
  })();

  try {
    return await dbInitPromise;
  } finally {
    dbInitPromise = null;
  }
}

async function closeDb(): Promise<void> {
  if (!dbInstance || isDbClosed) {
    return;
  }

  try {
    dbInstance.close();
  } catch {
  } finally {
    isDbClosed = true;
    dbInstance = null;
  }
}

/** Reset DB singleton — for testing only */
export async function resetDb(): Promise<void> {
  await closeDb();
  dbInitPromise = null;
}

process.on('exit', () => {
  if (dbInstance && !isDbClosed) {
    try {
      dbInstance.close();
    } catch {
    } finally {
      isDbClosed = true;
      dbInstance = null;
    }
  }
});

process.on('SIGTERM', () => {
  void closeDb().finally(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  void closeDb().finally(() => {
    process.exit(0);
  });
});

function normalizeModifiedAt(value: NullableNumber): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value)) return null;
  return Number(value);
}

function defaultHulyId(identifier: string): string | null {
  return /^[A-Z]+-\d+$/i.test(identifier) ? identifier : null;
}

export interface IssueSyncTimestamps {
  huly_modified_at: number | null;
  vibe_modified_at: number | null;
  beads_modified_at: number | null;
}

export async function getIssueSyncTimestamps(input: {
  identifier: string;
}): Promise<IssueSyncTimestamps | null> {
  const db = await getDb();
  const issue = db.getIssue(input.identifier);
  if (!issue) return null;

  return {
    huly_modified_at: normalizeModifiedAt(issue.huly_modified_at),
    vibe_modified_at: normalizeModifiedAt(issue.vibe_modified_at),
    beads_modified_at: normalizeModifiedAt(issue.beads_modified_at),
  };
}

export async function hasBeadsIssueChanged(input: {
  hulyIdentifier: string;
  title: string;
  description?: string;
  status: string;
}): Promise<boolean> {
  try {
    const db = await getDb();
    const existing = db.getIssue(input.hulyIdentifier);
    if (!existing) return true;

    const storedHash = existing.content_hash;
    if (!storedHash) return true;

    const newHash = computeIssueContentHashCached!({
      title: input.title,
      description: input.description || '',
      status: input.status,
      priority: '',
    });

    return newHash !== storedHash;
  } catch {
    return true;
  }
}

export async function getIssueSyncState(input: {
  hulyIdentifier: string;
}): Promise<{ status?: string; beadsStatus?: string } | null> {
  const db = await getDb();
  const issue = db.getIssue(input.hulyIdentifier);
  if (!issue) return null;
  return { status: issue.status, beadsStatus: issue.beads_status };
}

export async function getIssueSyncStateBatch(input: {
  hulyIdentifiers: string[];
}): Promise<Record<string, { status?: string; beadsStatus?: string }>> {
  const db = await getDb();
  const result: Record<string, { status?: string; beadsStatus?: string }> = {};
  for (const id of input.hulyIdentifiers) {
    const issue = db.getIssue(id);
    if (issue) {
      result[id] = { status: issue.status, beadsStatus: issue.beads_status };
    }
  }
  return result;
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

  const db = await getDb();

  let updated = 0;
  let failed = 0;
  const errors: Array<{ identifier: string; error: string }> = [];

  for (const issue of issues) {
    try {
      if (!issue.identifier || !issue.projectIdentifier) {
        throw new Error('identifier and projectIdentifier are required');
      }

      const existing = db.getIssue(issue.identifier);

      db.upsertIssue({
        identifier: issue.identifier,
        project_identifier: issue.projectIdentifier,
        huly_id: issue.hulyId || existing?.huly_id || defaultHulyId(issue.identifier),
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
        parent_vibe_id: issue.parentVibeId ?? existing?.parent_vibe_id ?? null,
        parent_beads_id: issue.parentBeadsId ?? existing?.parent_beads_id ?? null,
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
}
