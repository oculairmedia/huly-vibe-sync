/**
 * Bidirectional Sync Workflows
 *
 * Bidirectional sync between Huly and Beads.
 * "Most recent change wins" conflict resolution.
 */
export type SourceSystem = 'huly' | 'beads';
export interface SyncContext {
    projectIdentifier: string;
    gitRepoPath?: string;
}
export interface IssueData {
    id: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    modifiedAt: number;
}
export interface BidirectionalSyncInput {
    source: SourceSystem;
    issueData: IssueData;
    context: SyncContext;
    linkedIds?: {
        hulyId?: string;
        beadsId?: string;
    };
}
export interface BidirectionalSyncResult {
    success: boolean;
    source: SourceSystem;
    results: {
        huly?: {
            success: boolean;
            id?: string;
            skipped?: boolean;
            error?: string;
        };
        beads?: {
            success: boolean;
            id?: string;
            skipped?: boolean;
            error?: string;
        };
    };
    conflictResolution?: {
        winner: SourceSystem;
        winnerTimestamp: number;
        loserTimestamp?: number;
    };
    error?: string;
}
/**
 * BidirectionalSyncWorkflow
 *
 * Syncs changes from one system to the other two.
 * Uses "most recent wins" for conflict resolution.
 */
export declare function BidirectionalSyncWorkflow(input: BidirectionalSyncInput): Promise<BidirectionalSyncResult>;
export declare function SyncFromHulyWorkflow(input: {
    hulyIdentifier: string;
    context: SyncContext;
    linkedIds?: {
        beadsId?: string;
    };
}): Promise<BidirectionalSyncResult>;
/**
 * SyncFromBeadsWorkflow - Triggered when Beads issue changes
 */
export declare function SyncFromBeadsWorkflow(input: {
    beadsIssueId: string;
    context: SyncContext;
    linkedIds?: {
        hulyId?: string;
    };
}): Promise<BidirectionalSyncResult>;
export { BeadsFileChangeWorkflow, HulyWebhookChangeWorkflow } from './event-sync';
export type { BeadsFileChangeInput, BeadsFileChangeResult, HulyWebhookChangeInput, HulyWebhookChangeResult, } from './event-sync';
//# sourceMappingURL=bidirectional-sync.d.ts.map