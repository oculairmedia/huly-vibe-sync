/**
 * Full Orchestration Workflow
 *
 * Top-level workflow that coordinates the complete bidirectional sync across all projects.
 *
 * Features:
 * - Fetches all Huly projects
 * - Runs Phase 3 (Beads) for each project
 * - Updates Letta agent memory
 * - Records metrics
 * - Durable execution with automatic retry
 */
import type { ProjectSyncResult } from './project-sync';
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
/**
 * FullOrchestrationWorkflow
 *
 * Replaces SyncOrchestrator.syncHulyToVibe() with a durable Temporal workflow.
 * Orchestrates the complete sync across all projects.
 */
export declare function FullOrchestrationWorkflow(input?: FullSyncInput): Promise<FullSyncResult>;
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
//# sourceMappingURL=full-orchestration.d.ts.map