import path from 'path';
import { getDb } from './sync-database';

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
export async function initializeBeads(input: {
  gitRepoPath: string;
  projectName: string;
  projectIdentifier: string;
}): Promise<boolean> {
  const { gitRepoPath, projectIdentifier } = input;

  console.log(
    `[Temporal:Orchestration] Tracker initialization skipped for ${projectIdentifier}; beads integration removed (${gitRepoPath})`
  );

  return false;
}

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

  console.log(
    `[Temporal:Orchestration] Tracker issue fetch skipped for ${gitRepoPath}; beads integration removed`
  );

  return [];
}
