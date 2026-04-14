export interface SyncContext {
    projectIdentifier: string;
    gitRepoPath?: string;
}
export interface SyncActivityResult {
    success: boolean;
    id?: string;
    error?: string;
    skipped?: boolean;
    created?: boolean;
    updated?: boolean;
}
export declare function commitBeadsToGit(input: {
    context: SyncContext;
    message?: string;
}): Promise<SyncActivityResult>;
//# sourceMappingURL=sync-services.d.ts.map