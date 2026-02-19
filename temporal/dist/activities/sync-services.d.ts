/**
 * Sync Service Activities for Temporal
 *
 * These activities use pure TypeScript clients for Vibe, Huly, and Beads.
 * Provides proper error handling for Temporal retry classification.
 *
 * This is the production-ready implementation using native TypeScript SDKs.
 */
export interface HulyIssue {
    identifier: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    modifiedOn?: number;
    parentIssue?: string;
    subIssues?: string[];
}
export interface BeadsIssue {
    id: string;
    title: string;
    status: string;
    priority?: number;
    description?: string;
    labels?: string[];
}
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
/**
 * Sync a Huly issue to Beads
 */
export declare function syncIssueToBeads(input: {
    issue: HulyIssue;
    context: SyncContext;
    existingBeadsIssues: BeadsIssue[];
}): Promise<SyncActivityResult>;
/**
 * Sync Beads changes back to Huly
 */
export declare function syncBeadsToHuly(input: {
    beadsIssue: BeadsIssue & {
        description?: string;
        modifiedAt?: number;
    };
    hulyIdentifier: string;
    context: SyncContext;
}): Promise<SyncActivityResult>;
export declare function syncBeadsToHulyBatch(input: {
    beadsIssues: Array<{
        beadsId: string;
        hulyIdentifier: string;
        status: string;
        title?: string;
        description?: string;
    }>;
    context: SyncContext;
}): Promise<{
    success: boolean;
    updated: number;
    failed: number;
    errors: Array<{
        identifier: string;
        error: string;
    }>;
}>;
export declare function createBeadsIssueInHuly(input: {
    beadsIssue: BeadsIssue;
    context: SyncContext;
}): Promise<SyncActivityResult & {
    hulyIdentifier?: string;
}>;
export declare function commitBeadsToGit(input: {
    context: SyncContext;
    message?: string;
}): Promise<SyncActivityResult>;
//# sourceMappingURL=sync-services.d.ts.map