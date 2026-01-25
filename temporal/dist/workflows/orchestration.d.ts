/**
 * Full Orchestration Workflow
 *
 * Top-level workflow that replaces the SyncOrchestrator.syncHulyToVibe() function.
 * Coordinates the complete bidirectional sync across all projects.
 *
 * Features:
 * - Fetches all Huly and Vibe projects
 * - Creates Vibe projects if needed
 * - Runs Phase 1 (Huly→Vibe), Phase 2 (Vibe→Huly), Phase 3 (Beads) for each project
 * - Updates Letta agent memory
 * - Records metrics
 * - Durable execution with automatic retry
 */
export declare const cancelSignal: import("@temporalio/workflow").SignalDefinition<[], "cancel">;
export declare const progressQuery: import("@temporalio/workflow").QueryDefinition<SyncProgress, [], string>;
export interface FullSyncInput {
    /** Optional: sync only specific project */
    projectIdentifier?: string;
    /** Batch size for parallel issue sync (default: 5) */
    batchSize?: number;
    /** Enable Beads sync (default: true if configured) */
    enableBeads?: boolean;
    /** Enable Letta memory updates (default: true if configured) */
    enableLetta?: boolean;
    /** Dry run - don't make changes */
    dryRun?: boolean;
    /** Max consecutive failures before skipping a project (default: 3) */
    circuitBreakerThreshold?: number;
    /** Starting project index (for continuation) */
    _continueIndex?: number;
    /** Accumulated results from previous runs */
    _accumulatedResults?: ProjectSyncResult[];
    /** Accumulated errors from previous runs */
    _accumulatedErrors?: string[];
    /** Original start time (preserved across continuations) */
    _originalStartTime?: number;
    /** Circuit breaker: map of project -> consecutive failure count */
    _projectFailures?: Record<string, number>;
}
export interface FullSyncResult {
    success: boolean;
    projectsProcessed: number;
    issuesSynced: number;
    durationMs: number;
    errors: string[];
    projectResults: ProjectSyncResult[];
}
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
export interface SyncProgress {
    status: 'initializing' | 'fetching' | 'syncing' | 'completing' | 'done' | 'cancelled';
    currentProject?: string;
    projectsTotal: number;
    projectsCompleted: number;
    issuesSynced: number;
    errors: number;
    startedAt: number;
    elapsedMs: number;
}
export declare function FullOrchestrationWorkflow(input?: FullSyncInput): Promise<FullSyncResult>;
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
/**
 * ScheduledSyncWorkflow
 *
 * Long-running workflow for periodic sync.
 * Replaces setInterval-based scheduling.
 */
export declare function ScheduledSyncWorkflow(input: {
    intervalMinutes: number;
    maxIterations?: number;
    syncOptions?: FullSyncInput;
}): Promise<void>;
//# sourceMappingURL=orchestration.d.ts.map