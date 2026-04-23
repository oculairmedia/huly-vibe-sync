/**
 * Issue Sync Activities for Temporal
 *
 * These activities handle cross-system issue synchronization
 * with proper error typing for Temporal's retry policies.
 */
export interface IssueData {
    id?: string;
    identifier?: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    projectId: string;
    projectIdentifier?: string;
    hulyId?: string;
    vibeId?: string;
    modifiedAt?: number;
}
export interface SyncResult {
    success: boolean;
    systemId?: string;
    skipped?: boolean;
    error?: string;
}
export interface IssueSyncInput {
    issue: IssueData;
    operation: 'create' | 'update' | 'delete';
    source: 'huly' | 'vibe';
}
export declare function syncToHuly(_input: IssueSyncInput): Promise<SyncResult>;
/**
 * Sync issue to VibeKanban
 */
export declare function syncToVibe(input: IssueSyncInput): Promise<SyncResult>;
/**
 * Update Letta agent memory with sync result
 */
export declare function updateLettaMemory(input: {
    agentId: string;
    syncResult: {
        hulyId?: string;
        vibeId?: string;
        operation: string;
        timestamp: number;
    };
}): Promise<SyncResult>;
export declare function compensateHulyCreate(_input: {
    hulyIdentifier?: string;
}): Promise<SyncResult>;
/**
 * Best-effort compensation: delete newly created Vibe task.
 */
export declare function compensateVibeCreate(input: {
    vibeId?: string;
}): Promise<SyncResult>;
//# sourceMappingURL=issue-sync.d.ts.map