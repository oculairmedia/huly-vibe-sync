/**
 * Bidirectional Sync Workflows
 *
 * Full bidirectional sync between Huly, Vibe, and Beads.
 * "Most recent change wins" conflict resolution.
 *
 * When any system updates:
 * - Vibe updates → sync to Huly + Beads
 * - Beads updates → sync to Huly + Vibe
 * - Huly updates → sync to Vibe + Beads
 */
export type SourceSystem = 'vibe' | 'huly' | 'beads';
export interface SyncContext {
    projectIdentifier: string;
    vibeProjectId: string;
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
        vibeId?: string;
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
        vibe?: {
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
/**
 * SyncFromVibeWorkflow - Triggered when Vibe task changes
 */
export declare function SyncFromVibeWorkflow(input: {
    vibeTaskId: string;
    context: SyncContext;
    linkedIds?: {
        hulyId?: string;
        beadsId?: string;
    };
}): Promise<BidirectionalSyncResult>;
export declare function SyncFromHulyWorkflow(input: {
    hulyIdentifier: string;
    context: SyncContext;
    linkedIds?: {
        vibeId?: string;
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
        vibeId?: string;
    };
}): Promise<BidirectionalSyncResult>;
export { BeadsFileChangeWorkflow, VibeSSEChangeWorkflow, HulyWebhookChangeWorkflow, } from './event-sync';
export type { BeadsFileChangeInput, BeadsFileChangeResult, VibeSSEChangeInput, VibeSSEChangeResult, HulyWebhookChangeInput, HulyWebhookChangeResult, } from './event-sync';
//# sourceMappingURL=bidirectional-sync.d.ts.map