/**
 * Temporal Client for VibeSync
 *
 * Helper functions to trigger and monitor Temporal workflows
 * from VibeSync's existing code.
 *
 * Usage:
 *   import { scheduleMemoryUpdate, scheduleBatchMemoryUpdate } from './temporal/client';
 *
 *   // Single update
 *   await scheduleMemoryUpdate({
 *     agentId: 'agent-xxx',
 *     blockLabel: 'board_metrics',
 *     newValue: '{"issues": 10}',
 *     source: 'vibesync-sync',
 *   });
 *
 *   // Batch update
 *   await scheduleBatchMemoryUpdate([
 *     { agentId: 'agent-1', blockLabel: 'board_metrics', newValue: '...' },
 *     { agentId: 'agent-2', blockLabel: 'board_metrics', newValue: '...' },
 *   ]);
 */
import type { MemoryUpdateInput, MemoryUpdateResult } from './workflows/memory-update';
import type { IssueSyncInput, IssueSyncResult } from './workflows/issue-sync';
import type { SyncIssueInput, SyncIssueResult } from './workflows/full-sync';
/**
 * Schedule a single memory update workflow
 *
 * Returns immediately after scheduling. The workflow runs
 * in the background with automatic retry.
 */
export declare function scheduleMemoryUpdate(input: MemoryUpdateInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Schedule a batch memory update workflow
 *
 * All updates run in parallel with independent retry.
 */
export declare function scheduleBatchMemoryUpdate(updates: MemoryUpdateInput[], source?: string): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a memory update and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 * Use for synchronous flows where you need the result.
 */
export declare function executeMemoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateResult>;
/**
 * Get the status of a running workflow
 */
export declare function getWorkflowStatus(workflowId: string): Promise<{
    status: string;
    attempts?: number;
    lastError?: string;
}>;
/**
 * Cancel a running workflow
 */
export declare function cancelWorkflow(workflowId: string): Promise<void>;
/**
 * List recent memory update workflows
 */
export declare function listRecentWorkflows(limit?: number): Promise<Array<{
    workflowId: string;
    status: string;
    startTime: Date;
}>>;
/**
 * Get failed workflows that need attention
 */
export declare function getFailedWorkflows(): Promise<Array<{
    workflowId: string;
    startTime: Date;
    closeTime?: Date;
}>>;
/**
 * Schedule an issue sync workflow (fire-and-forget)
 *
 * Syncs an issue across Huly, VibeKanban, and Beads atomically.
 * Returns immediately; workflow runs in background with retry.
 */
export declare function scheduleIssueSync(input: IssueSyncInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute an issue sync and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 * Use when you need to know if sync succeeded before continuing.
 */
export declare function executeIssueSync(input: IssueSyncInput): Promise<IssueSyncResult>;
/**
 * Schedule a batch issue sync workflow
 *
 * Syncs multiple issues in parallel with controlled concurrency.
 * Useful for full project syncs.
 */
export declare function scheduleBatchIssueSync(issues: IssueSyncInput[], maxParallel?: number): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Check if Temporal is enabled via feature flag
 */
export declare function isTemporalEnabled(): boolean;
/**
 * Check if Temporal is available (can connect)
 */
export declare function isTemporalAvailable(): Promise<boolean>;
/**
 * Schedule a single issue sync using existing services
 *
 * This is the recommended way to sync issues - it uses the battle-tested
 * service implementations wrapped in Temporal for durability.
 */
export declare function scheduleSingleIssueSync(input: SyncIssueInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a single issue sync and wait for result
 */
export declare function executeSingleIssueSync(input: SyncIssueInput): Promise<SyncIssueResult>;
/**
 * Schedule a full project sync
 */
export declare function scheduleProjectSync(input: {
    issues: SyncIssueInput[];
    context: {
        projectIdentifier: string;
        vibeProjectId: string;
        gitRepoPath?: string;
    };
    batchSize?: number;
}): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Schedule Vibe→Huly sync (Phase 2)
 */
export declare function scheduleVibeToHulySync(input: {
    task: {
        id: string;
        title: string;
        description?: string;
        status: string;
        updated_at?: string;
    };
    hulyIdentifier: string;
    context: {
        projectIdentifier: string;
        vibeProjectId: string;
    };
}): Promise<{
    workflowId: string;
    runId: string;
}>;
//# sourceMappingURL=client.d.ts.map