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
        vibeProjectId: string;
        gitRepoPath?: string;
    };
    existingVibeTaskId?: string;
    existingBeadsIssues?: Array<{
        id: string;
        title: string;
        status: string;
    }>;
    syncToVibe?: boolean;
    syncToBeads?: boolean;
}
export interface SyncIssueResult {
    success: boolean;
    vibeResult?: {
        success: boolean;
        id?: string;
        skipped?: boolean;
        error?: string;
    };
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
        vibeProjectId: string;
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
/**
 * SyncVibeToHulyWorkflow
 *
 * Syncs Vibe task changes back to Huly (Phase 2).
 */
export declare function SyncVibeToHulyWorkflow(input: {
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
    success: boolean;
    error?: string;
}>;
//# sourceMappingURL=full-sync.d.ts.map