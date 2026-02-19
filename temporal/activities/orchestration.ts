/**
 * Orchestration Activities for Temporal — Facade
 *
 * Re-exports all activities from sub-modules:
 *   - orchestration-projects: Project fetching, ensuring, resolving
 *   - orchestration-git: Git repo path resolution, Beads operations
 *   - orchestration-letta: Letta memory updates, metrics, error handling
 */

// ============================================================
// TYPE DEFINITIONS (shared by sub-modules)
// ============================================================

export interface HulyProject {
  identifier: string;
  name: string;
  description?: string;
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

export interface ProjectSyncContext {
  hulyProject: HulyProject;
  gitRepoPath?: string;
  hulyIssues: HulyIssue[];
}

// ============================================================
// RE-EXPORTS FROM SUB-MODULES
// ============================================================

export {
  fetchHulyProjects,
  clearProjectCaches,
  resolveProjectIdentifier,
  fetchProjectData,
  fetchHulyIssuesBulk,
} from './orchestration-projects';

export {
  resolveGitRepoPath,
  extractGitRepoPath,
  clearGitRepoPathCache,
  initializeBeads,
  fetchBeadsIssues,
} from './orchestration-git';

export {
  updateLettaMemory,
  recordSyncMetrics,
  buildBoardMetrics,
  buildProjectMeta,
  handleOrchestratorError,
} from './orchestration-letta';
