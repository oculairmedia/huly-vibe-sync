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
    beadsId?: string;
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
    source: 'huly' | 'vibe' | 'beads';
}
/**
 * Sync issue to Huly
 */
export declare function syncToHuly(input: IssueSyncInput): Promise<SyncResult>;
/**
 * Sync issue to VibeKanban
 */
export declare function syncToVibe(input: IssueSyncInput): Promise<SyncResult>;
/**
 * Sync issue to Beads (via CLI)
 * Note: In atomic workflow mode, failures are fatal and retried by Temporal.
 */
export declare function syncToBeads(input: IssueSyncInput): Promise<SyncResult>;
/**
 * Update Letta agent memory with sync result
 */
export declare function updateLettaMemory(input: {
    agentId: string;
    syncResult: {
        hulyId?: string;
        vibeId?: string;
        beadsId?: string;
        operation: string;
        timestamp: number;
    };
}): Promise<SyncResult>;
/**
 * Best-effort compensation: delete newly created Huly issue.
 */
export declare function compensateHulyCreate(input: {
    hulyIdentifier?: string;
}): Promise<SyncResult>;
/**
 * Best-effort compensation: delete newly created Vibe task.
 */
export declare function compensateVibeCreate(input: {
    vibeId?: string;
}): Promise<SyncResult>;
/**
 * Best-effort compensation: remove newly created Beads issue.
 * Uses optional VibeSync endpoint if available.
 */
export declare function compensateBeadsCreate(input: {
    beadsId?: string;
}): Promise<SyncResult>;
//# sourceMappingURL=issue-sync.d.ts.map