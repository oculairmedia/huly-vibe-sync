/**
 * Full Sync Workflows
 *
 * Legacy workflows kept for backward compatibility.
 * Main orchestration now uses ProjectSyncWorkflow with a simplified pipeline.
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
}
export interface SyncIssueResult {
    success: boolean;
    error?: string;
}
export declare function SyncSingleIssueWorkflow(input: SyncIssueInput): Promise<SyncIssueResult>;
export declare function SyncProjectWorkflow(input: {
    issues: SyncIssueInput[];
    context: {
        projectIdentifier: string;
        gitRepoPath?: string;
    };
    batchSize?: number;
}): Promise<{
    success: boolean;
    total: number;
    synced: number;
    failed: number;
    results: SyncIssueResult[];
}>;
//# sourceMappingURL=full-sync.d.ts.map