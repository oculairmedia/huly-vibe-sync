type NullableNumber = number | null | undefined;
export interface PersistIssueStateInput {
    identifier: string;
    projectIdentifier: string;
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    hulyId?: string;
    vibeTaskId?: string;
    hulyModifiedAt?: NullableNumber;
    vibeModifiedAt?: NullableNumber;
    vibeStatus?: string;
    parentHulyId?: string | null;
    parentVibeId?: string | null;
    subIssueCount?: number;
}
export interface PersistIssueStateBatchInput {
    issues: PersistIssueStateInput[];
}
export interface PersistIssueStateResult {
    success: boolean;
    updated: number;
    failed: number;
    errors: Array<{
        identifier: string;
        error: string;
    }>;
}
export declare function getDb(): Promise<any>;
/** Reset DB singleton — for testing only */
export declare function resetDb(): Promise<void>;
export interface IssueSyncTimestamps {
    huly_modified_at: number | null;
    vibe_modified_at: number | null;
}
export declare function getIssueSyncTimestamps(input: {
    identifier: string;
}): Promise<IssueSyncTimestamps | null>;
export declare function hasIssueContentChanged(input: {
    hulyIdentifier: string;
    title: string;
    description?: string;
    status: string;
}): Promise<boolean>;
export declare function getIssueSyncState(input: {
    hulyIdentifier: string;
}): Promise<{
    status?: string;
} | null>;
export declare function getIssueSyncStateBatch(input: {
    hulyIdentifiers: string[];
}): Promise<Record<string, {
    status?: string;
}>>;
export declare function persistIssueSyncState(input: PersistIssueStateInput): Promise<PersistIssueStateResult>;
export declare function persistIssueSyncStateBatch(input: PersistIssueStateBatchInput): Promise<PersistIssueStateResult>;
export {};
//# sourceMappingURL=sync-database.d.ts.map