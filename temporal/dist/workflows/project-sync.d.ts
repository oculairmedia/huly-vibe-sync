/**
 * Project Sync Workflow
 *
 * Handles syncing a single project with continueAsNew for large issue counts.
 * This prevents workflow history overflow for projects with many issues.
 *
 * Multi-phase execution: init → phase1 → phase2 → phase3 → phase3b → phase3c → done
 */
export interface ProjectSyncResult {
    projectIdentifier: string;
    projectName: string;
    success: boolean;
    phase1: {
        synced: number;
        skipped: number;
        errors: number;
    };
    phase2: {
        synced: number;
        skipped: number;
        errors: number;
    };
    phase3?: {
        synced: number;
        skipped: number;
        errors: number;
    };
    lettaUpdated: boolean;
    error?: string;
}
export interface ProjectSyncInput {
    hulyProject: {
        identifier: string;
        name: string;
        description?: string;
    };
    vibeProjects: Array<{
        id: string;
        name: string;
    }>;
    batchSize: number;
    enableBeads: boolean;
    enableLetta: boolean;
    dryRun: boolean;
    prefetchedIssues?: Array<{
        identifier: string;
        title: string;
        status: string;
        priority?: string;
        modifiedOn?: number;
        parentIssue?: string;
    }>;
    prefetchedIssuesAreComplete?: boolean;
    _phase?: 'init' | 'phase1' | 'phase2' | 'phase3' | 'phase3b' | 'phase3c' | 'done';
    _phase1Index?: number;
    _phase2Index?: number;
    _phase3Index?: number;
    _accumulatedResult?: ProjectSyncResult;
    _vibeProjectId?: string;
    _gitRepoPath?: string | null;
    _beadsInitialized?: boolean;
    _phase1UpdatedTasks?: string[];
}
/**
 * ProjectSyncWorkflow
 *
 * Handles syncing a single project with continueAsNew for large issue counts.
 * This prevents workflow history overflow for projects like LTSEL with 990 issues.
 */
export declare function ProjectSyncWorkflow(input: ProjectSyncInput): Promise<ProjectSyncResult>;
//# sourceMappingURL=project-sync.d.ts.map