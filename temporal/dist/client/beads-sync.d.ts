/**
 * Beads Sync Client Functions
 *
 * Schedule and manage Beads sync and file change workflows.
 */
import type { SyncContext, BidirectionalSyncResult, BeadsFileChangeInput, BeadsFileChangeResult } from '../workflows/bidirectional-sync';
export interface BeadsSyncInput {
    beadsIssueId: string;
    context: SyncContext;
    linkedIds?: {
        hulyId?: string;
        vibeId?: string;
    };
}
/**
 * Schedule a Beads sync workflow (fire-and-forget)
 *
 * Triggered when Beads files change. Syncs from Beads to Huly and Vibe.
 * Returns immediately; workflow runs in background with retry.
 */
export declare function scheduleBeadsSync(input: BeadsSyncInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a Beads sync and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 */
export declare function executeBeadsSync(input: BeadsSyncInput): Promise<BidirectionalSyncResult>;
/**
 * Schedule batch Beads sync for multiple changed issues
 *
 * When multiple Beads issues change at once (e.g., git pull), this
 * schedules individual workflows for each changed issue.
 */
export declare function scheduleBatchBeadsSync(inputs: BeadsSyncInput[]): Promise<Array<{
    workflowId: string;
    runId: string;
}>>;
/**
 * Schedule a Beads file change workflow
 *
 * This is the main entry point for BeadsWatcher to trigger durable syncs.
 * When .beads files change, call this to sync all Beads issues.
 */
export declare function scheduleBeadsFileChange(input: BeadsFileChangeInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a Beads file change workflow and wait for result
 */
export declare function executeBeadsFileChange(input: BeadsFileChangeInput): Promise<BeadsFileChangeResult>;
//# sourceMappingURL=beads-sync.d.ts.map