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
export interface BeadsFileChangeInput {
    projectIdentifier: string;
    gitRepoPath: string;
    vibeProjectId: string;
    changedFiles: string[];
    timestamp: string;
}
export interface BeadsFileChangeResult {
    success: boolean;
    issuesProcessed: number;
    issuesSynced: number;
    errors: Array<{
        issueId: string;
        error: string;
    }>;
}
/**
 * BeadsFileChangeWorkflow - Triggered when .beads files change
 *
 * This workflow is the durable replacement for BeadsWatcher callbacks.
 * It fetches all Beads issues and syncs each one to Huly and Vibe.
 *
 * Benefits over in-memory callback:
 * - Durable: survives crashes and restarts
 * - Retryable: automatic retry with exponential backoff
 * - Observable: visible in Temporal UI
 * - Resumable: picks up where it left off after failure
 */
export declare function BeadsFileChangeWorkflow(input: BeadsFileChangeInput): Promise<BeadsFileChangeResult>;
/**
 * Input for VibeSSEChangeWorkflow
 */
export interface VibeSSEChangeInput {
    vibeProjectId: string;
    hulyProjectIdentifier?: string;
    changedTaskIds: string[];
    timestamp: string;
}
/**
 * Result from VibeSSEChangeWorkflow
 */
export interface VibeSSEChangeResult {
    success: boolean;
    tasksProcessed: number;
    tasksSynced: number;
    errors: Array<{
        taskId: string;
        error: string;
    }>;
}
/**
 * VibeSSEChangeWorkflow - Triggered by Vibe SSE events
 *
 * This workflow is the durable replacement for VibeEventWatcher callbacks.
 * It processes batch task changes from the SSE stream and syncs each to Huly.
 *
 * Benefits over in-memory callback:
 * - Durable: survives crashes and restarts
 * - Retryable: automatic retry with exponential backoff
 * - Observable: visible in Temporal UI
 * - Resumable: picks up where it left off after failure
 */
export declare function VibeSSEChangeWorkflow(input: VibeSSEChangeInput): Promise<VibeSSEChangeResult>;
/**
 * Input for HulyWebhookChangeWorkflow
 */
export interface HulyWebhookChangeInput {
    type: 'task.changed' | 'project.changed';
    changes: Array<{
        id: string;
        class: string;
        modifiedOn?: number;
        data?: {
            identifier?: string;
            title?: string;
            status?: string;
            space?: string;
        };
    }>;
    byProject?: Record<string, unknown[]>;
    timestamp: string;
}
/**
 * Result from HulyWebhookChangeWorkflow
 */
export interface HulyWebhookChangeResult {
    success: boolean;
    issuesProcessed: number;
    issuesSynced: number;
    errors: Array<{
        issueId: string;
        error: string;
    }>;
}
/**
 * HulyWebhookChangeWorkflow - Triggered by Huly webhook events
 *
 * This workflow is the durable replacement for HulyWebhookHandler callbacks.
 * It processes Huly change notifications and syncs to Vibe/Beads.
 *
 * Benefits over in-memory callback:
 * - Durable: survives crashes and restarts
 * - Retryable: automatic retry with exponential backoff
 * - Observable: visible in Temporal UI
 * - Resumable: picks up where it left off after failure
 */
export declare function HulyWebhookChangeWorkflow(input: HulyWebhookChangeInput): Promise<HulyWebhookChangeResult>;
//# sourceMappingURL=bidirectional-sync.d.ts.map