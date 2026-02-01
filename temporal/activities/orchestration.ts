/**
 * Orchestration Activities for Temporal
 *
 * Activities for the FullOrchestrationWorkflow that fetches projects,
 * coordinates sync phases, and updates Letta memory.
 */

import { ApplicationFailure } from '@temporalio/activity';
import { createVibeClient, createHulyClient, createBeadsClient } from '../lib';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface HulyProject {
  identifier: string;
  name: string;
  description?: string;
}

export interface VibeProject {
  id: string;
  name: string;
  slug?: string;
}

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

export interface VibeTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  updated_at?: string;
}

export interface ProjectSyncContext {
  hulyProject: HulyProject;
  vibeProject: VibeProject;
  gitRepoPath?: string;
  hulyIssues: HulyIssue[];
  vibeTasks: VibeTask[];
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
      const normalizedName = p.name.toLowerCase().replace(/[^a-z0-9]/g, ''); // Remove non-alphanumeric
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
 * Bulk fetch issues from multiple Huly projects in a single API call.
 * Uses POST /api/issues/bulk-by-projects for ~12s savings per sync cycle.
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
      includeDescriptions: false, // 5x faster, descriptions fetched individually when needed
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

/**
 * Resolve git repo path for a Huly project by identifier.
 * Fetches the project from Huly API and extracts the filesystem path from its description.
 * Returns null (not throws) if project not found or no path configured — caller decides severity.
 */
export async function resolveGitRepoPath(input: {
  projectIdentifier: string;
}): Promise<string | null> {
  const { projectIdentifier } = input;

  console.log(`[Temporal:Orchestration] Resolving gitRepoPath for project: ${projectIdentifier}`);

  try {
    const hulyClient = createHulyClient(process.env.HULY_API_URL);
    const projects = await hulyClient.listProjects();
    const project = projects.find((p: HulyProject) => p.identifier === projectIdentifier);

    if (!project) {
      console.log(
        `[Temporal:Orchestration] Project not found for gitRepoPath: ${projectIdentifier}`
      );
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

// ============================================================
// LETTA MEMORY ACTIVITIES
// ============================================================

/**
 * Update Letta agent memory with project state
 */
export async function updateLettaMemory(input: {
  agentId: string;
  hulyProject: HulyProject;
  vibeProject: VibeProject;
  hulyIssues: HulyIssue[];
  vibeTasks: VibeTask[];
  gitRepoPath?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { agentId, hulyProject, hulyIssues, vibeTasks } = input;

  console.log(`[Temporal:Orchestration] Updating Letta memory for agent ${agentId}`);

  try {
    const lettaUrl = process.env.LETTA_BASE_URL || process.env.LETTA_API_URL;
    const lettaPassword = process.env.LETTA_PASSWORD;

    if (!lettaUrl || !lettaPassword) {
      console.log('[Temporal:Orchestration] Letta not configured, skipping memory update');
      return { success: true };
    }

    // Build memory blocks
    const boardMetrics = buildBoardMetrics(hulyIssues, vibeTasks);
    const projectMeta = buildProjectMeta(hulyProject, hulyIssues);

    // Update memory blocks via Letta API
    const response = await fetch(`${lettaUrl}/v1/agents/${agentId}/memory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${lettaPassword}`,
      },
      body: JSON.stringify({
        blocks: [
          { label: 'board_metrics', value: boardMetrics },
          { label: 'project', value: projectMeta },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Letta API error: ${response.status} ${response.statusText}`);
    }

    console.log(`[Temporal:Orchestration] Updated Letta memory for ${agentId}`);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[Temporal:Orchestration] Letta memory update failed: ${errorMsg}`);
    // Non-fatal
    return { success: false, error: errorMsg };
  }
}

// ============================================================
// METRICS & RECORDING
// ============================================================

/**
 * Record sync completion metrics
 */
export async function recordSyncMetrics(input: {
  projectsProcessed: number;
  issuesSynced: number;
  durationMs: number;
  errors: number;
}): Promise<void> {
  const { projectsProcessed, issuesSynced, durationMs, errors } = input;

  console.log(`[Temporal:Orchestration] Sync complete`, {
    projects: projectsProcessed,
    issues: issuesSynced,
    duration: `${(durationMs / 1000).toFixed(2)}s`,
    errors,
  });

  // Could emit to metrics system here (Prometheus, etc.)
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function buildBoardMetrics(hulyIssues: HulyIssue[], vibeTasks: VibeTask[]): string {
  const statusCounts: Record<string, number> = {};

  for (const issue of hulyIssues) {
    const status = issue.status || 'Unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  return JSON.stringify({
    totalIssues: hulyIssues.length,
    totalTasks: vibeTasks.length,
    byStatus: statusCounts,
    lastUpdated: new Date().toISOString(),
  });
}

function buildProjectMeta(hulyProject: HulyProject, hulyIssues: HulyIssue[]): string {
  return JSON.stringify({
    identifier: hulyProject.identifier,
    name: hulyProject.name,
    issueCount: hulyIssues.length,
    lastSynced: new Date().toISOString(),
  });
}

function handleOrchestratorError(error: unknown, operation: string): never {
  if (error instanceof ApplicationFailure) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  // Non-retryable errors
  if (
    lowerMessage.includes('404') ||
    lowerMessage.includes('not found') ||
    lowerMessage.includes('401') ||
    lowerMessage.includes('403') ||
    lowerMessage.includes('validation')
  ) {
    throw ApplicationFailure.nonRetryable(
      `${operation} failed: ${message}`,
      'OrchestratorValidationError'
    );
  }

  // Retryable errors
  throw ApplicationFailure.retryable(`${operation} failed: ${message}`, 'OrchestratorError');
}
