/**
 * Full Sync Client Functions
 *
 * Schedule and manage full orchestration sync workflows.
 */
import type { SyncIssueInput, SyncIssueResult } from '../workflows/full-sync';
import type { FullSyncInput, FullSyncResult, SyncProgress } from '../workflows/orchestration';
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
        gitRepoPath?: string;
    };
    batchSize?: number;
}): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Schedule a full orchestration sync (fire-and-forget)
 *
 * This replaces the legacy SyncOrchestrator.syncHulyToVibe() function.
 * Runs as a durable Temporal workflow with automatic retry.
 */
export declare function scheduleFullSync(input?: FullSyncInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a full sync and wait for result
 *
 * Blocks until the workflow completes.
 */
export declare function executeFullSync(input?: FullSyncInput): Promise<FullSyncResult>;
/**
 * Get progress of a running full sync workflow
 */
export declare function getFullSyncProgress(workflowId: string): Promise<SyncProgress | null>;
/**
 * Cancel a running full sync workflow
 */
export declare function cancelFullSync(workflowId: string): Promise<void>;
/**
 * List running sync workflows
 */
export declare function listSyncWorkflows(limit?: number): Promise<Array<{
    workflowId: string;
    status: string;
    startTime: Date;
    type: string;
}>>;
//# sourceMappingURL=full-sync.d.ts.map