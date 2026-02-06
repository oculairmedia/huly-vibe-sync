/**
 * Issue Sync Client Functions
 *
 * Schedule and manage issue sync workflows.
 */
import type { IssueSyncInput, IssueSyncResult } from '../workflows/issue-sync';
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
//# sourceMappingURL=issue-sync.d.ts.map