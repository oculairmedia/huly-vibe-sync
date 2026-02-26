/**
 * Shared Huly dedupe helpers for Temporal activities.
 *
 * Uses local sync DB mappings first to avoid expensive Huly API title scans.
 */

import path from 'path';

function appRootModule(modulePath: string): string {
  return path.join(process.cwd(), modulePath);
}

interface IssueRow {
  identifier?: string;
  huly_id?: string;
  beads_issue_id?: string;
  beads_status?: string;
  beads_modified_at?: number;
  title?: string;
}

const PROJECT_ISSUES_CACHE_TTL_MS = Number(process.env.TEMPORAL_DEDUPE_CACHE_TTL_MS || 15000);

interface ProjectIssueIndex {
  rows: IssueRow[];
  byBeadsId: Map<string, IssueRow>;
  byNormalizedTitle: Map<string, IssueRow>;
  byHulyIdentifier: Map<string, IssueRow>;
  expiresAt: number;
}

const projectIssuesCache = new Map<string, ProjectIssueIndex>();

// Module-level singleton DB connection
let createSyncDatabaseCached: any = null;
let dbInstance: any = null;
let isDbClosed = false;
let dbInitPromise: Promise<any> | null = null;

export function normalizeTitle(title: string): string {
  if (!title) return '';
  return title
    .trim()
    .toLowerCase()
    .replace(/^\[p[0-4]\]\s*/i, '')
    .replace(/^\[perf[^\]]*\]\s*/i, '')
    .replace(/^\[tier\s*\d+\]\s*/i, '')
    .replace(/^\[action\]\s*/i, '')
    .replace(/^\[bug\]\s*/i, '')
    .replace(/^\[fixed\]\s*/i, '')
    .replace(/^\[epic\]\s*/i, '')
    .replace(/^\[wip\]\s*/i, '')
    .trim();
}

function getHulyIdentifier(row: IssueRow): string | null {
  return (row.identifier || row.huly_id || null) ?? null;
}

function resolveDbPath(): string {
  return process.env.DB_PATH || '/opt/stacks/huly-vibe-sync/logs/sync-state.db';
}

async function getDb(): Promise<any> {
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

async function getProjectIssueIndex(projectIdentifier: string): Promise<ProjectIssueIndex> {
  const cached = projectIssuesCache.get(projectIdentifier);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const db = await getDb();
  const dbAny = db as any;
  const rows = (dbAny.getProjectIssues?.(projectIdentifier) || []) as IssueRow[];

  const byBeadsId = new Map<string, IssueRow>();
  const byNormalizedTitle = new Map<string, IssueRow>();
  const byHulyIdentifier = new Map<string, IssueRow>();

  for (const row of rows) {
    if (row.beads_issue_id) {
      byBeadsId.set(row.beads_issue_id, row);
    }
    const nt = normalizeTitle(row.title || '');
    if (nt) {
      byNormalizedTitle.set(nt, row);
    }
    const hid = getHulyIdentifier(row);
    if (hid) {
      byHulyIdentifier.set(hid, row);
    }
  }

  const index: ProjectIssueIndex = {
    rows,
    byBeadsId,
    byNormalizedTitle,
    byHulyIdentifier,
    expiresAt: Date.now() + PROJECT_ISSUES_CACHE_TTL_MS,
  };
  projectIssuesCache.set(projectIdentifier, index);
  return index;
}

export async function findMappedIssueByBeadsId(
  projectIdentifier: string,
  beadsIssueId: string
): Promise<string | null> {
  if (!projectIdentifier || !beadsIssueId) return null;

  const index = await getProjectIssueIndex(projectIdentifier);
  const match = index.byBeadsId.get(beadsIssueId);
  return match ? getHulyIdentifier(match) : null;
}

export async function getBeadsStatusForHulyIssue(
  projectIdentifier: string,
  hulyIdentifier: string
): Promise<{ beadsStatus: string; beadsModifiedAt: number } | null> {
  if (!projectIdentifier || !hulyIdentifier) return null;

  const index = await getProjectIssueIndex(projectIdentifier);
  const match = index.byHulyIdentifier.get(hulyIdentifier);
  if (!match?.beads_status) return null;

  return {
    beadsStatus: match.beads_status,
    beadsModifiedAt: match.beads_modified_at ?? 0,
  };
}

export async function findMappedIssueByTitle(
  projectIdentifier: string,
  title: string
): Promise<string | null> {
  if (!projectIdentifier || !title) return null;

  const target = normalizeTitle(title);
  if (!target) return null;

  const index = await getProjectIssueIndex(projectIdentifier);
  const match = index.byNormalizedTitle.get(target);
  return match ? getHulyIdentifier(match) : null;
}
