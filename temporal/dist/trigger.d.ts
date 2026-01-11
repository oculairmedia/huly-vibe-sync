/**
 * Temporal Workflow Triggers
 *
 * Helper functions for external services to trigger bidirectional sync workflows.
 * Used by: VibeEventWatcher, BeadsWatcher, HulyWebhookHandler
 */
/**
 * Check if Temporal is available
 */
export declare function isTemporalAvailable(): Promise<boolean>;
export interface SyncContext {
    projectIdentifier: string;
    vibeProjectId: string;
    gitRepoPath?: string;
}
export interface LinkedIds {
    hulyId?: string;
    vibeId?: string;
    beadsId?: string;
}
/**
 * Trigger sync when Vibe task changes
 */
export declare function triggerSyncFromVibe(vibeTaskId: string, context: SyncContext, linkedIds?: LinkedIds): Promise<{
    workflowId: string;
}>;
/**
 * Trigger sync when Huly issue changes
 */
export declare function triggerSyncFromHuly(hulyIdentifier: string, context: SyncContext, linkedIds?: LinkedIds): Promise<{
    workflowId: string;
}>;
/**
 * Trigger sync when Beads issue changes
 */
export declare function triggerSyncFromBeads(beadsIssueId: string, context: SyncContext, linkedIds?: LinkedIds): Promise<{
    workflowId: string;
}>;
/**
 * Trigger generic bidirectional sync
 */
export declare function triggerBidirectionalSync(source: 'vibe' | 'huly' | 'beads', issueData: {
    id: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    modifiedAt: number;
}, context: SyncContext, linkedIds?: LinkedIds): Promise<{
    workflowId: string;
}>;
/**
 * Close the Temporal connection
 */
export declare function closeConnection(): Promise<void>;
//# sourceMappingURL=trigger.d.ts.map