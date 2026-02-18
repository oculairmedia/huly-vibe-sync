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
const projectIssuesCache = new Map<string, { rows: IssueRow[]; expiresAt: number }>();

function normalizeTitle(title: string): string {
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

async function getProjectIssues(projectIdentifier: string): Promise<IssueRow[]> {
  const cached = projectIssuesCache.get(projectIdentifier);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rows;
  }

  const { createSyncDatabase } = await import(appRootModule('lib/database.js'));
  const dbPath = process.env.DB_PATH || '/opt/stacks/huly-vibe-sync/logs/sync-state.db';
  const db = createSyncDatabase(dbPath);

  try {
    const dbAny = db as any;
    const rows = (dbAny.getProjectIssues?.(projectIdentifier) || []) as IssueRow[];
    projectIssuesCache.set(projectIdentifier, {
      rows,
      expiresAt: Date.now() + PROJECT_ISSUES_CACHE_TTL_MS,
    });
    return rows;
  } finally {
    db.close();
  }
}

export async function findMappedIssueByBeadsId(
  projectIdentifier: string,
  beadsIssueId: string
): Promise<string | null> {
  if (!projectIdentifier || !beadsIssueId) return null;

  const rows = await getProjectIssues(projectIdentifier);
  const match = rows.find(r => r.beads_issue_id === beadsIssueId);
  return match ? getHulyIdentifier(match) : null;
}

export async function getBeadsStatusForHulyIssue(
  projectIdentifier: string,
  hulyIdentifier: string
): Promise<{ beadsStatus: string; beadsModifiedAt: number } | null> {
  if (!projectIdentifier || !hulyIdentifier) return null;

  const rows = await getProjectIssues(projectIdentifier);
  const match = rows.find(r => getHulyIdentifier(r) === hulyIdentifier);
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

  const rows = await getProjectIssues(projectIdentifier);
  const match = rows.find(r => normalizeTitle(r.title || '') === target);
  return match ? getHulyIdentifier(match) : null;
}
