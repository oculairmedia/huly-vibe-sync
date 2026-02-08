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
    beadsIssueId?: string;
    hulyModifiedAt?: NullableNumber;
    vibeModifiedAt?: NullableNumber;
    beadsModifiedAt?: NullableNumber;
    vibeStatus?: string;
    beadsStatus?: string;
    parentHulyId?: string | null;
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
export declare function persistIssueSyncState(input: PersistIssueStateInput): Promise<PersistIssueStateResult>;
export declare function persistIssueSyncStateBatch(input: PersistIssueStateBatchInput): Promise<PersistIssueStateResult>;
export {};
//# sourceMappingURL=sync-database.d.ts.map