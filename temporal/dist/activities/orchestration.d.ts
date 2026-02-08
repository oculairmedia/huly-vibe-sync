/**
 * Orchestration Activities for Temporal — Facade
 *
 * Re-exports all activities from sub-modules:
 *   - orchestration-projects: Project fetching, ensuring, resolving
 *   - orchestration-git: Git repo path resolution, Beads operations
 *   - orchestration-letta: Letta memory updates, metrics, error handling
 */
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
export { fetchHulyProjects, fetchVibeProjects, getVibeProjectId, clearProjectCaches, resolveProjectIdentifier, ensureVibeProject, fetchProjectData, fetchVibeTasksForHulyIssues, fetchHulyIssuesBulk, } from './orchestration-projects';
export { resolveGitRepoPath, extractGitRepoPath, clearGitRepoPathCache, initializeBeads, fetchBeadsIssues, } from './orchestration-git';
export { updateLettaMemory, recordSyncMetrics, buildBoardMetrics, buildProjectMeta, handleOrchestratorError, } from './orchestration-letta';
//# sourceMappingURL=orchestration.d.ts.map