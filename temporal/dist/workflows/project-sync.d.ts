/**
 * Project Sync Workflow — Simplified 4-Phase Pipeline
 *
 * Handles syncing a single project with continueAsNew for large issue counts.
 *
 * Phases: init → sync → agent → done
 *   init:  Discover project in registry, init beads, provision/reconcile agent
 *   sync:  Read beads issues, persist to registry DB (for MCP queries)
 *   agent: Update Letta agent memory with latest issue summary
 *   done:  Record metrics, commit beads changes if any
 */
export interface ProjectSyncResult {
    projectIdentifier: string;
    projectName: string;
    success: boolean;
    beadsSync: {
        synced: number;
        skipped: number;
        errors: number;
    };
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
    enableBeads: boolean;
    enableLetta: boolean;
    dryRun: boolean;
    _phase?: 'init' | 'sync' | 'agent' | 'done';
    _accumulatedResult?: ProjectSyncResult;
    _gitRepoPath?: string | null;
    _beadsInitialized?: boolean;
}
export declare function ProjectSyncWorkflow(input: ProjectSyncInput): Promise<ProjectSyncResult>;
//# sourceMappingURL=project-sync.d.ts.map