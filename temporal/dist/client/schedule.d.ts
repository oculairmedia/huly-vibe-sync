/**
 * Schedule Management Client Functions
 *
 * Start, stop, and manage scheduled sync workflows.
 */
import type { FullSyncInput } from '../workflows/orchestration';
/**
 * Start a scheduled sync workflow
 *
 * This replaces setInterval-based scheduling with a durable workflow.
 * The workflow runs forever (or until maxIterations), executing syncs at intervals.
 */
export declare function startScheduledSync(input: {
    intervalMinutes: number;
    maxIterations?: number;
    syncOptions?: FullSyncInput;
}): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Get active scheduled sync workflow
 *
 * Returns the currently running scheduled sync workflow if any.
 */
export declare function getActiveScheduledSync(): Promise<{
    workflowId: string;
    status: string;
    startTime: Date;
    intervalMinutes?: number;
} | null>;
/**
 * Stop a running scheduled sync workflow
 *
 * Sends a cancel signal to gracefully stop the workflow.
 */
export declare function stopScheduledSync(workflowId?: string): Promise<boolean>;
/**
 * Restart scheduled sync with new interval
 *
 * Stops the current scheduled sync and starts a new one with updated parameters.
 */
export declare function restartScheduledSync(input: {
    intervalMinutes: number;
    maxIterations?: number;
    syncOptions?: FullSyncInput;
}): Promise<{
    workflowId: string;
    runId: string;
} | null>;
/**
 * Check if a scheduled sync is currently active
 */
export declare function isScheduledSyncActive(): Promise<boolean>;
//# sourceMappingURL=schedule.d.ts.map