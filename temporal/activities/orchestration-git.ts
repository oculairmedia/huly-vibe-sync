/**
 * Orchestration Activities — Git & Beads
 *
 * Activities for git repo path resolution and Beads operations.
 */

import { createBeadsClient, createHulyClient } from '../lib';
import type { HulyProject } from './orchestration';

const GIT_PATH_CACHE_TTL_MS = Number(process.env.TEMPORAL_GIT_PATH_CACHE_TTL_MS || 30000);
const gitRepoPathCache = new Map<string, { value: string | null; expiresAt: number }>();

function isFresh(expiresAt: number): boolean {
  return expiresAt > Date.now();
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

    const hulyClient = createHulyClient(process.env.HULY_API_URL);
    const projects = await hulyClient.listProjects();
    const project = projects.find((p: HulyProject) => p.identifier === projectIdentifier);

    if (!project) {
      console.log(
        `[Temporal:Orchestration] Project not found for gitRepoPath: ${projectIdentifier}`
      );
      gitRepoPathCache.set(projectIdentifier, {
        value: null,
        expiresAt: Date.now() + GIT_PATH_CACHE_TTL_MS,
      });
      return null;
    }

    const path = extractGitRepoPath({ description: project.description });

    if (path) {
      console.log(
        `[Temporal:Orchestration] Resolved gitRepoPath: ${path} for ${projectIdentifier}`
      );
    } else {
      console.log(
        `[Temporal:Orchestration] No gitRepoPath in description for ${projectIdentifier}`
      );
    }

    gitRepoPathCache.set(projectIdentifier, {
      value: path,
      expiresAt: Date.now() + GIT_PATH_CACHE_TTL_MS,
    });

    return path;
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
 * Fetch Beads issues from a repository
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

  console.log(`[Temporal:Orchestration] Fetching Beads issues from ${gitRepoPath}`);

  try {
    const beadsClient = createBeadsClient(gitRepoPath);

    if (!beadsClient.isInitialized()) {
      return [];
    }

    const issues = await beadsClient.listIssues();
    console.log(`[Temporal:Orchestration] Found ${issues.length} Beads issues`);
    return issues;
  } catch (error) {
    console.warn(`[Temporal:Orchestration] Beads fetch failed: ${error}`);
    return [];
  }
}
