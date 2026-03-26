/**
 * Orchestration Activities for Temporal — Facade
 *
 * Re-exports all activities from sub-modules:
 *   - orchestration-projects: Registry-based project fetching
 *   - orchestration-git: Git repo path resolution, Beads operations
 *   - orchestration-letta: Letta memory updates, metrics, error handling
 */
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
export { fetchRegistryProjects } from './orchestration-projects';
export { resolveGitRepoPath, extractGitRepoPath, clearGitRepoPathCache, initializeBeads, fetchBeadsIssues, loadDoltQueryService, } from './orchestration-git';
export { updateLettaMemory, recordSyncMetrics, handleOrchestratorError, } from './orchestration-letta';
//# sourceMappingURL=orchestration.d.ts.map