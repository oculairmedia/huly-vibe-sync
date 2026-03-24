export interface SyncContext {
    projectIdentifier: string;
    gitRepoPath?: string;
}
export interface BidirectionalSyncResult {
    success: boolean;
    source: string;
    issueId: string;
    errors: string[];
}
export interface BeadsFileChangeInput {
    projectIdentifier: string;
    projectPath: string;
    changedFiles: string[];
    timestamp: string;
}
export interface BeadsFileChangeResult {
    success: boolean;
    issuesProcessed: number;
    errors: string[];
}
export interface BeadsSyncInput {
    beadsIssueId: string;
    context: SyncContext;
    linkedIds?: {
        hulyId?: string;
        vibeId?: string;
    };
}
export declare function scheduleBeadsSync(input: BeadsSyncInput): Promise<{
    workflowId: string;
    runId: string;
}>;
export declare function executeBeadsSync(input: BeadsSyncInput): Promise<BidirectionalSyncResult>;
export declare function scheduleBatchBeadsSync(inputs: BeadsSyncInput[]): Promise<Array<{
    workflowId: string;
    runId: string;
}>>;
export declare function scheduleBeadsFileChange(input: BeadsFileChangeInput): Promise<{
    workflowId: string;
    runId: string;
}>;
export declare function executeBeadsFileChange(input: BeadsFileChangeInput): Promise<BeadsFileChangeResult>;
//# sourceMappingURL=beads-sync.d.ts.map