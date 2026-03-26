/**
 * Orchestration Activities — Git & Beads
 *
 * Activities for git repo path resolution and Beads operations.
 */

import path from 'path';
import { createBeadsClient } from '../lib';
import { getDb } from './sync-database';

function appRootModule(modulePath: string): string {
  return path.join(process.cwd(), modulePath);
}

const GIT_PATH_CACHE_TTL_MS = Number(process.env.TEMPORAL_GIT_PATH_CACHE_TTL_MS || 30000);
const gitRepoPathCache = new Map<string, { value: string | null; expiresAt: number }>();

/**
 * Test-only helper to reset module-level cache between test runs.
 */
export function clearGitRepoPathCache(): void {
  gitRepoPathCache.clear();
}

function isFresh(expiresAt: number): boolean {
  return expiresAt > Date.now();
}

async function getGitRepoPathFromSyncDb(projectIdentifier: string): Promise<string | null> {
  try {
    const db = await getDb();
    const path =
      db.getProjectFilesystemPath?.(projectIdentifier) ||
      db.getProject?.(projectIdentifier)?.filesystem_path ||
      null;

    return typeof path === 'string' && path.startsWith('/') ? path : null;
  } catch (error) {
    console.warn(
      `[Temporal:Orchestration] sync DB gitRepoPath lookup failed for ${projectIdentifier}: ${error}`
    );
    return null;
  }
}

// ============================================================
// GIT REPO PATH RESOLUTION
// ============================================================

/**
 * Resolve git repo path for a Huly project by identifier.
 * Fetches the project from Huly API and extracts the filesystem path from its description.
 * Returns null (not throws) if project not found or no path configured.
 */
export async function resolveGitRepoPath(input: {
  projectIdentifier: string;
}): Promise<string | null> {
  const { projectIdentifier } = input;

  console.log(`[Temporal:Orchestration] Resolving gitRepoPath for project: ${projectIdentifier}`);

  try {
    const cached = gitRepoPathCache.get(projectIdentifier);
    if (cached && isFresh(cached.expiresAt)) {
      return cached.value;
    }

    const dbPath = await getGitRepoPathFromSyncDb(projectIdentifier);

    gitRepoPathCache.set(projectIdentifier, {
      value: dbPath,
      expiresAt: Date.now() + GIT_PATH_CACHE_TTL_MS,
    });

    if (dbPath) {
      console.log(
        `[Temporal:Orchestration] Resolved gitRepoPath from DB: ${dbPath} for ${projectIdentifier}`
      );
    } else {
      console.log(`[Temporal:Orchestration] No gitRepoPath in DB for ${projectIdentifier}`);
    }

    return dbPath;
  } catch (error) {
    console.warn(
      `[Temporal:Orchestration] resolveGitRepoPath failed for ${projectIdentifier}: ${error}`
    );
    return null;
  }
}

/**
 * Extract git repo path from Huly project description.
 * Supports: Filesystem:, Path:, Directory:, Location: (case-insensitive)
 */
export function extractGitRepoPath(input: { description?: string }): string | null {
  const { description } = input;

  if (!description) return null;

  const patterns = [
    /Filesystem:\s*([^\n]+)/i,
    /Path:\s*([^\n]+)/i,
    /Directory:\s*([^\n]+)/i,
    /Location:\s*([^\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const path = match[1].trim().replace(/[,;.]$/, '');
      if (path.startsWith('/')) {
        return path;
      }
    }
  }

  return null;
}

// ============================================================
// DOLT QUERY SERVICE LOADER
// ============================================================

/** Cached reference to the DoltQueryService class (lazy-loaded from ESM). */
let _DoltQueryServiceClass: any = null;

/**
 * Get the DoltQueryService class, lazy-loading it from the ESM module.
 * The class reference is cached after first load.
 *
 * @internal Exposed for test-time replacement via `setDoltQueryServiceClass`.
 */
export async function getDoltQueryServiceClass(): Promise<any> {
  if (!_DoltQueryServiceClass) {
    const mod = await import(appRootModule('lib/DoltQueryService.js'));
    _DoltQueryServiceClass = mod.DoltQueryService;
  }
  return _DoltQueryServiceClass;
}

/**
 * Override the DoltQueryService class (for testing).
 * Pass `null` to reset to lazy-loaded default.
 */
export function setDoltQueryServiceClass(cls: any): void {
  _DoltQueryServiceClass = cls;
}

// ============================================================
// BEADS ACTIVITIES
// ============================================================

/**
 * Initialize Beads in a git repository
 */
export async function initializeBeads(input: {
  gitRepoPath: string;
  projectName: string;
  projectIdentifier: string;
}): Promise<boolean> {
  const { gitRepoPath, projectName } = input;

  console.log(`[Temporal:Orchestration] Initializing Beads in ${gitRepoPath}`);

  try {
    const beadsClient = createBeadsClient(gitRepoPath);

    if (beadsClient.isInitialized()) {
      console.log(`[Temporal:Orchestration] Beads already initialized`);
      return true;
    }

    await beadsClient.initialize();
    console.log(`[Temporal:Orchestration] Beads initialized for ${projectName}`);
    return true;
  } catch (error) {
    // Non-fatal - log and continue
    console.warn(`[Temporal:Orchestration] Beads init failed: ${error}`);
    return false;
  }
}

/**
 * Fetch Beads issues from a repository via Dolt SQL.
 *
 * Connects to the local Dolt SQL server (port discovered from
 * `.beads/dolt-server.port`), queries active issues with labels,
 * and returns them in the canonical shape expected by callers.
 */
export async function fetchBeadsIssues(input: { gitRepoPath: string }): Promise<
  Array<{
    id: string;
    title: string;
    status: string;
    priority?: number;
    description?: string;
    labels?: string[];
  }>
> {
  const { gitRepoPath } = input;

  console.log(`[Temporal:Orchestration] Fetching Beads issues from Dolt: ${gitRepoPath}`);

  try {
    const DoltQueryServiceClass = await getDoltQueryServiceClass();
    const dolt = new DoltQueryServiceClass();
    await dolt.connect(gitRepoPath);

    try {
      // Query active issues (exclude tombstones) with labels joined
      const [rows]: any = await dolt.pool.execute(
        `SELECT i.*, GROUP_CONCAT(l.label) AS labels
         FROM issues i
         LEFT JOIN labels l ON i.id = l.issue_id
         WHERE i.status != 'tombstone'
         GROUP BY i.id
         ORDER BY i.updated_at DESC`
      );

      const issues = (rows as any[]).map((row: any) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        priority: row.priority != null ? Number(row.priority) : undefined,
        description: row.description || undefined,
        labels: row.labels ? row.labels.split(',') : [],
      }));

      console.log(`[Temporal:Orchestration] Found ${issues.length} Beads issues from Dolt`);
      return issues;
    } finally {
      await dolt.disconnect();
    }
  } catch (error) {
    console.warn(`[Temporal:Orchestration] Beads Dolt fetch failed: ${error}`);
    return [];
  }
}
