/**
 * Full Sync Workflows
 *
 * These workflows orchestrate the complete sync process
 * using the existing service implementations wrapped as activities.
 */
export interface SyncIssueInput {
    issue: {
        identifier: string;
        title: string;
        description?: string;
        status: string;
        priority?: string;
        modifiedOn?: number;
    };
    context: {
        projectIdentifier: string;
        gitRepoPath?: string;
    };
    existingBeadsIssues?: Array<{
        id: string;
        title: string;
        status: string;
    }>;
    syncToBeads?: boolean;
}
export interface SyncIssueResult {
    success: boolean;
    beadsResult?: {
        success: boolean;
        id?: string;
        skipped?: boolean;
        error?: string;
    };
    error?: string;
}
/**
 * SyncSingleIssueWorkflow
 *
 * Syncs a single Huly issue to Vibe and Beads atomically.
 * Use this for real-time sync on issue changes.
 */
export declare function SyncSingleIssueWorkflow(input: SyncIssueInput): Promise<SyncIssueResult>;
/**
 * SyncProjectWorkflow
 *
 * Syncs an entire project's issues in parallel batches.
 * Use this for initial sync or full reconciliation.
 */
export declare function SyncProjectWorkflow(input: {
    issues: SyncIssueInput[];
    context: {
        projectIdentifier: string;
        gitRepoPath?: string;
    };
    batchSize?: number;
    commitAfterSync?: boolean;
}): Promise<{
    success: boolean;
    total: number;
    synced: number;
    failed: number;
    results: SyncIssueResult[];
}>;
//# sourceMappingURL=full-sync.d.ts.map