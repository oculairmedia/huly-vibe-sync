/**
 * Full Orchestration Workflow
 *
 * Top-level workflow that coordinates project sync across all registry projects.
 *
 * Phase 4 pipeline:
 * - Fetches project list from SQLite registry
 * - Runs ProjectSyncWorkflow per project (init → sync → agent → done)
 * - Records metrics
 * - Durable execution with automatic retry
 */
import type { ProjectSyncResult } from './project-sync';
export declare const cancelSignal: import("@temporalio/workflow").SignalDefinition<[], "cancel">;
export declare const progressQuery: import("@temporalio/workflow").QueryDefinition<SyncProgress, [], string>;
export interface FullSyncInput {
    projectIdentifier?: string;
    batchSize?: number;
    enableLetta?: boolean;
    dryRun?: boolean;
    circuitBreakerThreshold?: number;
    _continueIndex?: number;
    _accumulatedResults?: ProjectSyncResult[];
    _accumulatedErrors?: string[];
    _originalStartTime?: number;
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
export declare function FullOrchestrationWorkflow(input?: FullSyncInput): Promise<FullSyncResult>;
export declare function ScheduledSyncWorkflow(input: {
    intervalMinutes: number;
    maxIterations?: number;
    syncOptions?: FullSyncInput;
}): Promise<void>;
//# sourceMappingURL=full-orchestration.d.ts.map