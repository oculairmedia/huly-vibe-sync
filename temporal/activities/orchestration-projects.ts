/**
 * Orchestration Activities — Project Fetching
 *
 * Activities for fetching and managing Huly/Vibe projects.
 */

import { ApplicationFailure } from '@temporalio/activity';
import { createVibeClient, createHulyClient } from '../lib';
import * as fs from 'fs';
import * as path from 'path';
import { handleOrchestratorError } from './orchestration-letta';
import type { HulyProject, VibeProject, HulyIssue, VibeTask } from './orchestration';

// ============================================================
// PROJECT FETCHING ACTIVITIES
// ============================================================

/**
 * Fetch all Huly projects
 */
export async function fetchHulyProjects(): Promise<HulyProject[]> {
  console.log('[Temporal:Orchestration] Fetching Huly projects');

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);
    const projects = await hulyClient.listProjects();

    console.log(`[Temporal:Orchestration] Found ${projects.length} Huly projects`);
    return projects;
  } catch (error) {
    throw handleOrchestratorError(error, 'fetchHulyProjects');
  }
}

/**
 * Fetch all Vibe projects
 */
export async function fetchVibeProjects(): Promise<VibeProject[]> {
  console.log('[Temporal:Orchestration] Fetching Vibe projects');

  try {
    const vibeClient = createVibeClient(process.env.VIBE_API_URL);
    const projects = await vibeClient.listProjects();

    console.log(`[Temporal:Orchestration] Found ${projects.length} Vibe projects`);
    return projects;
  } catch (error) {
    throw handleOrchestratorError(error, 'fetchVibeProjects');
  }
}

export async function getVibeProjectId(hulyProjectIdentifier: string): Promise<string | null> {
  console.log(`[Temporal:Orchestration] Looking up Vibe project for: ${hulyProjectIdentifier}`);

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);
    const hulyProjects = await hulyClient.listProjects();
    const hulyProject = hulyProjects.find(p => p.identifier === hulyProjectIdentifier);

    if (!hulyProject) {
      console.log(`[Temporal:Orchestration] Huly project not found: ${hulyProjectIdentifier}`);
      return null;
    }

    const vibeClient = createVibeClient(process.env.VIBE_API_URL);
    const vibeProjects = await vibeClient.listProjects();
    const normalizedName = hulyProject.name.toLowerCase().trim();
    const match = vibeProjects.find(p => p.name.toLowerCase().trim() === normalizedName);

    if (match) {
      console.log(
        `[Temporal:Orchestration] Found Vibe project: ${match.id} for ${hulyProjectIdentifier}`
      );
      return match.id;
    }

    console.log(`[Temporal:Orchestration] No Vibe project found for: ${hulyProject.name}`);
    return null;
  } catch (error) {
    console.warn(`[Temporal:Orchestration] Vibe project lookup failed: ${error}`);
    return null;
  }
}

export async function resolveProjectIdentifier(projectIdOrFolder: string): Promise<string | null> {
  if (!projectIdOrFolder) return null;

  console.log(`[Temporal:Orchestration] Resolving project identifier: ${projectIdOrFolder}`);

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);
    const projects = await hulyClient.listProjects();

    // Normalize input: lowercase, remove path separators
    const normalizedInput =
      projectIdOrFolder.toLowerCase().replace(/\\/g, '/').split('/').filter(Boolean).pop() ||
      projectIdOrFolder.toLowerCase();

    // First, try direct identifier match (case-insensitive)
    const directMatch = projects.find(
      (p: HulyProject) => p.identifier.toLowerCase() === normalizedInput
    );
    if (directMatch) {
      console.log(`[Temporal:Orchestration] Direct match found: ${directMatch.identifier}`);
      return directMatch.identifier;
    }

    // Try matching by filesystem path in description
    for (const project of projects) {
      const description = (project as HulyProject).description || '';

      // Parse "Filesystem: /opt/stacks/foldername" from description
      const fsMatch = description.match(/Filesystem:\s*([^\n]+)/i);
      if (fsMatch) {
        const fsPath = fsMatch[1].trim();
        const folderName = fsPath
          .replace(/\\/g, '/')
          .split('/')
          .filter(Boolean)
          .pop()
          ?.toLowerCase();

        if (folderName === normalizedInput) {
          console.log(
            `[Temporal:Orchestration] Resolved folder "${projectIdOrFolder}" → "${project.identifier}"`
          );
          return project.identifier;
        }
      }
    }

    // Try matching by project name (case-insensitive, with common transformations)
    const nameMatch = projects.find((p: HulyProject) => {
      const normalizedName = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedSearch = normalizedInput.replace(/[^a-z0-9]/g, '');
      return normalizedName === normalizedSearch;
    });

    if (nameMatch) {
      console.log(
        `[Temporal:Orchestration] Resolved by name "${projectIdOrFolder}" → "${nameMatch.identifier}"`
      );
      return nameMatch.identifier;
    }

    console.warn(
      `[Temporal:Orchestration] Could not resolve project identifier: ${projectIdOrFolder}`
    );
    return null;
  } catch (error) {
    throw handleOrchestratorError(error, 'resolveProjectIdentifier');
  }
}

function extractFilesystemPath(description?: string): string | null {
  if (!description) return null;
  const match = description.match(/(?:Path|Filesystem|Directory|Location):\s*([^\n\r]+)/i);
  if (match) {
    return match[1]
      .trim()
      .replace(/[,;.]$/, '')
      .trim();
  }
  return null;
}

function determineGitRepoPath(hulyProject: HulyProject): string {
  const filesystemPath = extractFilesystemPath(hulyProject.description);
  if (filesystemPath) {
    return filesystemPath;
  }
  return `/opt/stacks/huly-sync-placeholders/${hulyProject.identifier}`;
}

function validateGitRepoPath(repoPath: string): { valid: boolean; reason?: string } {
  if (!repoPath || typeof repoPath !== 'string') {
    return { valid: false, reason: 'path is null or not a string' };
  }
  if (!path.isAbsolute(repoPath)) {
    return { valid: false, reason: `path is not absolute: ${repoPath}` };
  }
  if (!fs.existsSync(repoPath)) {
    return { valid: false, reason: `path does not exist on disk: ${repoPath}` };
  }
  try {
    const stat = fs.statSync(repoPath);
    if (!stat.isDirectory()) {
      return { valid: false, reason: `path is not a directory: ${repoPath}` };
    }
  } catch {
    return { valid: false, reason: `cannot stat path: ${repoPath}` };
  }
  const gitDir = path.join(repoPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return { valid: false, reason: `not a git repository (no .git): ${repoPath}` };
  }
  return { valid: true };
}

export async function ensureVibeProject(input: {
  hulyProject: HulyProject;
  existingVibeProjects: VibeProject[];
}): Promise<VibeProject> {
  const { hulyProject, existingVibeProjects } = input;

  console.log(`[Temporal:Orchestration] Ensuring Vibe project for ${hulyProject.identifier}`);

  try {
    const existing = existingVibeProjects.find(
      vp => vp.name.toLowerCase() === hulyProject.name.toLowerCase()
    );

    if (existing) {
      console.log(`[Temporal:Orchestration] Found existing Vibe project: ${existing.id}`);
      return existing;
    }

    const gitRepoPath = determineGitRepoPath(hulyProject);

    const validation = validateGitRepoPath(gitRepoPath);
    if (!validation.valid) {
      console.warn(
        `[Temporal:Orchestration] ⚠ Skipping project ${hulyProject.identifier}: invalid repo path — ${validation.reason}`
      );
      throw ApplicationFailure.nonRetryable(
        `Invalid repo path for ${hulyProject.identifier}: ${validation.reason}`,
        'INVALID_REPO_PATH'
      );
    }

    const displayName = gitRepoPath.split('/').pop() || hulyProject.name;

    console.log(`[Temporal:Orchestration] Creating Vibe project with repo: ${gitRepoPath}`);

    const vibeClient = createVibeClient(process.env.VIBE_API_URL);
    const created = await vibeClient.createProject({
      name: hulyProject.name,
      repositories: [{ display_name: displayName, git_repo_path: gitRepoPath }],
    });

    console.log(`[Temporal:Orchestration] Created Vibe project: ${created.id}`);
    return created;
  } catch (error) {
    throw handleOrchestratorError(error, 'ensureVibeProject');
  }
}

/**
 * Fetch project data (issues and tasks) for sync
 */
export async function fetchProjectData(input: {
  hulyProject: HulyProject;
  vibeProjectId: string;
}): Promise<{ hulyIssues: HulyIssue[]; vibeTasks: VibeTask[] }> {
  const { hulyProject, vibeProjectId } = input;

  console.log(`[Temporal:Orchestration] Fetching data for ${hulyProject.identifier}`);

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);
    const vibeClient = createVibeClient(process.env.VIBE_API_URL);

    // Fetch in parallel
    const [hulyIssues, vibeTasks] = await Promise.all([
      hulyClient.listIssues(hulyProject.identifier),
      vibeClient.listTasks(vibeProjectId),
    ]);

    console.log(
      `[Temporal:Orchestration] Fetched ${hulyIssues.length} issues, ${vibeTasks.length} tasks`
    );

    return { hulyIssues, vibeTasks };
  } catch (error) {
    throw handleOrchestratorError(error, 'fetchProjectData');
  }
}

/**
 * Fetch only Vibe tasks that map to specific Huly identifiers via sync DB mappings.
 * Used by webhook-triggered project syncs to avoid full-table task fetches.
 */
export async function fetchVibeTasksForHulyIssues(input: {
  projectIdentifier: string;
  vibeProjectId: string;
  hulyIssueIdentifiers: string[];
}): Promise<VibeTask[]> {
  const { projectIdentifier, vibeProjectId, hulyIssueIdentifiers } = input;

  const uniqueHulyIds = Array.from(new Set(hulyIssueIdentifiers.filter(Boolean)));
  if (uniqueHulyIds.length === 0) {
    return [];
  }

  console.log(
    `[Temporal:Orchestration] Fetching mapped Vibe tasks for ${uniqueHulyIds.length} prefetched Huly issues in ${projectIdentifier}`
  );

  const vibeTaskIds = new Set<string>();

  try {
    const { createSyncDatabase } = await import('../../lib/database.js');
    const dbPath = process.env.DB_PATH || '/opt/stacks/huly-vibe-sync/logs/sync-state.db';
    const db = createSyncDatabase(dbPath);

    try {
      const dbAny = db as any;
      for (const hulyIdentifier of uniqueHulyIds) {
        const issue = dbAny.getIssue?.(hulyIdentifier);
        if (issue?.vibe_task_id) {
          vibeTaskIds.add(String(issue.vibe_task_id));
        }
      }
    } finally {
      db.close();
    }
  } catch (error) {
    throw handleOrchestratorError(error, 'fetchVibeTasksForHulyIssues');
  }

  if (vibeTaskIds.size === 0) {
    console.log(
      `[Temporal:Orchestration] No mapped Vibe tasks found for prefetched issues in ${projectIdentifier}`
    );
    return [];
  }

  try {
    const vibeClient = createVibeClient(process.env.VIBE_API_URL);

    const settled = await Promise.allSettled(
      Array.from(vibeTaskIds).map(taskId => vibeClient.getTask(taskId))
    );

    const vibeTasks: VibeTask[] = [];
    for (const item of settled) {
      if (item.status === 'fulfilled' && item.value) {
        vibeTasks.push(item.value as unknown as VibeTask);
      }
    }

    console.log(
      `[Temporal:Orchestration] Fetched ${vibeTasks.length}/${vibeTaskIds.size} mapped Vibe tasks for ${projectIdentifier}`
    );

    return vibeTasks;
  } catch (error) {
    throw handleOrchestratorError(error, 'fetchVibeTasksForHulyIssues');
  }
}

/**
 * Bulk fetch issues from multiple Huly projects in a single API call.
 */
export async function fetchHulyIssuesBulk(input: {
  projectIdentifiers: string[];
  modifiedSince?: string;
  limit?: number;
}): Promise<Record<string, HulyIssue[]>> {
  const { projectIdentifiers, modifiedSince, limit = 1000 } = input;

  console.log(
    `[Temporal:Orchestration] Bulk fetching issues from ${projectIdentifiers.length} projects`
  );

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);

    const result = await hulyClient.listIssuesBulk({
      projects: projectIdentifiers,
      modifiedSince,
      limit,
      includeDescriptions: false,
      fields: ['identifier', 'title', 'status', 'priority', 'modifiedOn', 'parentIssue'],
    });

    const issuesByProject: Record<string, HulyIssue[]> = {};
    let totalIssues = 0;

    for (const [projectId, data] of Object.entries(result.projects)) {
      issuesByProject[projectId] = data.issues;
      totalIssues += data.issues.length;
    }

    console.log(
      `[Temporal:Orchestration] Bulk fetched ${totalIssues} issues from ${projectIdentifiers.length} projects`
    );

    return issuesByProject;
  } catch (error) {
    throw handleOrchestratorError(error, 'fetchHulyIssuesBulk');
  }
}
