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
export interface VibeTask {
    id: string;
    title: string;
    description?: string;
    status: string;
    updated_at?: string;
}
export interface BeadsIssue {
    id: string;
    title: string;
    status: string;
    priority?: number;
}
export interface SyncContext {
    projectIdentifier: string;
    vibeProjectId: string;
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
 * Create or update a Vibe task from a Huly issue
 */
export declare function syncIssueToVibe(input: {
    issue: HulyIssue;
    context: SyncContext;
    existingTaskId?: string;
    operation: 'create' | 'update';
}): Promise<SyncActivityResult>;
/**
 * Update a Huly issue from Vibe task changes
 */
export declare function syncTaskToHuly(input: {
    task: VibeTask;
    hulyIdentifier: string;
    context: SyncContext;
}): Promise<SyncActivityResult>;
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
    beadsIssue: BeadsIssue;
    hulyIdentifier: string;
    context: SyncContext;
}): Promise<SyncActivityResult>;
/**
 * Commit Beads changes to git
 */
export declare function commitBeadsToGit(input: {
    context: SyncContext;
    message?: string;
}): Promise<SyncActivityResult>;
//# sourceMappingURL=sync-services.d.ts.map