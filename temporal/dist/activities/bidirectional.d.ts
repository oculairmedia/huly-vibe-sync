/**
 * Bidirectional Sync Activities
 *
 * Activities for syncing between Huly, Vibe, and Beads in all directions.
 * Each activity handles one direction of sync.
 */
interface SyncContext {
    projectIdentifier: string;
    gitRepoPath?: string;
}
interface IssueData {
    id: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    modifiedAt?: number;
}
interface SyncResult {
    success: boolean;
    id?: string;
    skipped?: boolean;
    created?: boolean;
    updated?: boolean;
    error?: string;
}
export declare function getHulyIssue(input: {
    identifier: string;
}): Promise<{
    identifier: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    modifiedOn?: number;
} | null>;
export declare function getBeadsIssue(input: {
    issueId: string;
    gitRepoPath: string;
}): Promise<{
    id: string;
    title: string;
    description?: string;
    status: string;
    priority?: number;
    updated_at?: string;
} | null>;
export declare function syncHulyToBeads(input: {
    hulyIssue: IssueData;
    existingBeadsId?: string;
    context: SyncContext;
}): Promise<SyncResult>;
/**
 * Sync Beads issue to Huly
 */
export declare function syncBeadsToHuly(input: {
    beadsIssue: IssueData;
    hulyIdentifier: string;
    context: SyncContext;
}): Promise<SyncResult>;
/**
 * Commit Beads changes to git
 */
export declare function commitBeadsChanges(input: {
    gitRepoPath: string;
    message: string;
}): Promise<SyncResult>;
export {};
//# sourceMappingURL=bidirectional.d.ts.map