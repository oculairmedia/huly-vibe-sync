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
 * Note: This runs shell commands, so it needs to run on a host with beads installed
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
//# sourceMappingURL=issue-sync.d.ts.map