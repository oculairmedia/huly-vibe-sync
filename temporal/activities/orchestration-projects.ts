/**
 * Orchestration Activities — Project Fetching
 *
 * Activities for fetching and managing Huly/Vibe projects.
 */

import { createHulyClient } from '../lib';
import { handleOrchestratorError } from './orchestration-letta';
import type { HulyProject, HulyIssue } from './orchestration';

const PROJECT_CACHE_TTL_MS = Number(process.env.TEMPORAL_PROJECT_CACHE_TTL_MS || 30000);

let hulyProjectsCache: { value: HulyProject[]; expiresAt: number } | null = null;

/**
 * Test-only helper to reset module-level caches between test runs.
 */
export function clearProjectCaches(): void {
  hulyProjectsCache = null;
}

function isFresh(expiresAt: number): boolean {
  return expiresAt > Date.now();
}

async function getCachedHulyProjects(): Promise<HulyProject[]> {
  if (hulyProjectsCache && isFresh(hulyProjectsCache.expiresAt)) {
    return hulyProjectsCache.value;
  }

  const hulyClient = createHulyClient(process.env.HULY_API_URL);
  const projects = await hulyClient.listProjects();
  hulyProjectsCache = {
    value: projects,
    expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
  };
  return projects;
}

// ============================================================
// PROJECT FETCHING ACTIVITIES
// ============================================================

/**
 * Fetch all Huly projects
 */
export async function fetchHulyProjects(): Promise<HulyProject[]> {
  console.log('[Temporal:Orchestration] Fetching Huly projects');

  try {
    const projects = await getCachedHulyProjects();

    console.log(`[Temporal:Orchestration] Found ${projects.length} Huly projects`);
    return projects;
  } catch (error) {
    throw handleOrchestratorError(error, 'fetchHulyProjects');
  }
}

export async function resolveProjectIdentifier(projectIdOrFolder: string): Promise<string | null> {
  if (!projectIdOrFolder) return null;

  console.log(`[Temporal:Orchestration] Resolving project identifier: ${projectIdOrFolder}`);

  try {
    const projects = await getCachedHulyProjects();

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

export async function fetchProjectData(input: {
  hulyProject: HulyProject;
}): Promise<{ hulyIssues: HulyIssue[] }> {
  const { hulyProject } = input;

  console.log(`[Temporal:Orchestration] Fetching data for ${hulyProject.identifier}`);

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);
    const hulyIssues = await hulyClient.listIssues(hulyProject.identifier);

    console.log(`[Temporal:Orchestration] Fetched ${hulyIssues.length} issues`);

    return { hulyIssues };
  } catch (error) {
    throw handleOrchestratorError(error, 'fetchProjectData');
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
