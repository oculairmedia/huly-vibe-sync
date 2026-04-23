/**
 * Project Sync Workflow — Simplified 2-Phase Pipeline
 *
 * Handles syncing a single project.
 *
 * Phases: init → agent
 *   init:   Discover project in registry, provision/reconcile agent
 *   agent:  Update Letta agent memory with latest project snapshot
 */
export interface ProjectSyncResult {
    projectIdentifier: string;
    projectName: string;
    success: boolean;
    lettaUpdated: boolean;
    error?: string;
}
export interface ProjectSyncInput {
    project: {
        identifier: string;
        name: string;
        description?: string;
    };
    batchSize: number;
    enableLetta: boolean;
    dryRun: boolean;
    _phase?: 'init' | 'agent' | 'done';
    _accumulatedResult?: ProjectSyncResult;
    _gitRepoPath?: string | null;
}
export declare function ProjectSyncWorkflow(input: ProjectSyncInput): Promise<ProjectSyncResult>;
//# sourceMappingURL=project-sync.d.ts.map