/**
 * Temporal Client for VibeSync
 *
 * Helper functions to trigger and monitor Temporal workflows
 * from VibeSync's existing code.
 *
 * Usage:
 *   import { scheduleMemoryUpdate, scheduleBatchMemoryUpdate } from './temporal/client';
 *
 *   // Single update
 *   await scheduleMemoryUpdate({
 *     agentId: 'agent-xxx',
 *     blockLabel: 'board_metrics',
 *     newValue: '{"issues": 10}',
 *     source: 'vibesync-sync',
 *   });
 *
 *   // Batch update
 *   await scheduleBatchMemoryUpdate([
 *     { agentId: 'agent-1', blockLabel: 'board_metrics', newValue: '...' },
 *     { agentId: 'agent-2', blockLabel: 'board_metrics', newValue: '...' },
 *   ]);
 */
import type { MemoryUpdateInput, MemoryUpdateResult } from './workflows/memory-update';
import type { IssueSyncInput, IssueSyncResult } from './workflows/issue-sync';
import type { SyncIssueInput, SyncIssueResult } from './workflows/full-sync';
import type { FullSyncInput, FullSyncResult, SyncProgress } from './workflows/orchestration';
import type { SyncContext, BidirectionalSyncResult, BeadsFileChangeInput, BeadsFileChangeResult, VibeSSEChangeInput, VibeSSEChangeResult, HulyWebhookChangeInput, HulyWebhookChangeResult } from './workflows/bidirectional-sync';
/**
 * Schedule a single memory update workflow
 *
 * Returns immediately after scheduling. The workflow runs
 * in the background with automatic retry.
 */
export declare function scheduleMemoryUpdate(input: MemoryUpdateInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Schedule a batch memory update workflow
 *
 * All updates run in parallel with independent retry.
 */
export declare function scheduleBatchMemoryUpdate(updates: MemoryUpdateInput[], source?: string): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a memory update and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 * Use for synchronous flows where you need the result.
 */
export declare function executeMemoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateResult>;
/**
 * Get the status of a running workflow
 */
export declare function getWorkflowStatus(workflowId: string): Promise<{
    status: string;
    attempts?: number;
    lastError?: string;
}>;
/**
 * Cancel a running workflow
 */
export declare function cancelWorkflow(workflowId: string): Promise<void>;
/**
 * List recent memory update workflows
 */
export declare function listRecentWorkflows(limit?: number): Promise<Array<{
    workflowId: string;
    status: string;
    startTime: Date;
}>>;
/**
 * Get failed workflows that need attention
 */
export declare function getFailedWorkflows(): Promise<Array<{
    workflowId: string;
    startTime: Date;
    closeTime?: Date;
}>>;
/**
 * Schedule an issue sync workflow (fire-and-forget)
 *
 * Syncs an issue across Huly, VibeKanban, and Beads atomically.
 * Returns immediately; workflow runs in background with retry.
 */
export declare function scheduleIssueSync(input: IssueSyncInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute an issue sync and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 * Use when you need to know if sync succeeded before continuing.
 */
export declare function executeIssueSync(input: IssueSyncInput): Promise<IssueSyncResult>;
/**
 * Schedule a batch issue sync workflow
 *
 * Syncs multiple issues in parallel with controlled concurrency.
 * Useful for full project syncs.
 */
export declare function scheduleBatchIssueSync(issues: IssueSyncInput[], maxParallel?: number): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Check if Temporal is enabled via feature flag
 */
export declare function isTemporalEnabled(): boolean;
/**
 * Check if Temporal is available (can connect)
 */
export declare function isTemporalAvailable(): Promise<boolean>;
/**
 * Schedule a single issue sync using existing services
 *
 * This is the recommended way to sync issues - it uses the battle-tested
 * service implementations wrapped in Temporal for durability.
 */
export declare function scheduleSingleIssueSync(input: SyncIssueInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a single issue sync and wait for result
 */
export declare function executeSingleIssueSync(input: SyncIssueInput): Promise<SyncIssueResult>;
/**
 * Schedule a full project sync
 */
export declare function scheduleProjectSync(input: {
    issues: SyncIssueInput[];
    context: {
        projectIdentifier: string;
        vibeProjectId: string;
        gitRepoPath?: string;
    };
    batchSize?: number;
}): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Schedule Vibe→Huly sync (Phase 2)
 */
export declare function scheduleVibeToHulySync(input: {
    task: {
        id: string;
        title: string;
        description?: string;
        status: string;
        updated_at?: string;
    };
    hulyIdentifier: string;
    context: {
        projectIdentifier: string;
        vibeProjectId: string;
    };
}): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Schedule a full orchestration sync (fire-and-forget)
 *
 * This replaces the legacy SyncOrchestrator.syncHulyToVibe() function.
 * Runs as a durable Temporal workflow with automatic retry.
 */
export declare function scheduleFullSync(input?: FullSyncInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a full sync and wait for result
 *
 * Blocks until the workflow completes.
 */
export declare function executeFullSync(input?: FullSyncInput): Promise<FullSyncResult>;
/**
 * Get progress of a running full sync workflow
 */
export declare function getFullSyncProgress(workflowId: string): Promise<SyncProgress | null>;
/**
 * Cancel a running full sync workflow
 */
export declare function cancelFullSync(workflowId: string): Promise<void>;
/**
 * Start a scheduled sync workflow
 *
 * This replaces setInterval-based scheduling with a durable workflow.
 * The workflow runs forever (or until maxIterations), executing syncs at intervals.
 */
export declare function startScheduledSync(input: {
    intervalMinutes: number;
    maxIterations?: number;
    syncOptions?: FullSyncInput;
}): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * List running sync workflows
 */
export declare function listSyncWorkflows(limit?: number): Promise<Array<{
    workflowId: string;
    status: string;
    startTime: Date;
    type: string;
}>>;
/**
 * Get active scheduled sync workflow
 *
 * Returns the currently running scheduled sync workflow if any.
 */
export declare function getActiveScheduledSync(): Promise<{
    workflowId: string;
    status: string;
    startTime: Date;
    intervalMinutes?: number;
} | null>;
/**
 * Stop a running scheduled sync workflow
 *
 * Sends a cancel signal to gracefully stop the workflow.
 */
export declare function stopScheduledSync(workflowId?: string): Promise<boolean>;
/**
 * Restart scheduled sync with new interval
 *
 * Stops the current scheduled sync and starts a new one with updated parameters.
 */
export declare function restartScheduledSync(input: {
    intervalMinutes: number;
    maxIterations?: number;
    syncOptions?: FullSyncInput;
}): Promise<{
    workflowId: string;
    runId: string;
} | null>;
/**
 * Check if a scheduled sync is currently active
 */
export declare function isScheduledSyncActive(): Promise<boolean>;
export type ReconciliationAction = 'mark_deleted' | 'hard_delete';
export interface DataReconciliationInput {
    projectIdentifier?: string;
    action?: ReconciliationAction;
    dryRun?: boolean;
}
export interface DataReconciliationResult {
    success: boolean;
    action: ReconciliationAction;
    dryRun: boolean;
    projectsProcessed: number;
    projectsWithVibeChecked: number;
    projectsWithBeadsChecked: number;
    staleVibe: Array<{
        identifier: string;
        projectIdentifier: string;
        vibeTaskId: string;
    }>;
    staleBeads: Array<{
        identifier: string;
        projectIdentifier: string;
        beadsIssueId: string;
    }>;
    updated: {
        markedVibe: number;
        markedBeads: number;
        deleted: number;
    };
    errors: string[];
}
export declare function executeDataReconciliation(input?: DataReconciliationInput): Promise<DataReconciliationResult>;
export declare function startScheduledReconciliation(input: {
    intervalMinutes: number;
    maxIterations?: number;
    reconcileOptions?: DataReconciliationInput;
}): Promise<{
    workflowId: string;
    runId: string;
}>;
export declare function getActiveScheduledReconciliation(): Promise<{
    workflowId: string;
    status: string;
    startTime: Date;
    intervalMinutes?: number;
} | null>;
export declare function stopScheduledReconciliation(workflowId?: string): Promise<boolean>;
export interface ProvisioningInput {
    projectIdentifiers?: string[];
    maxConcurrency?: number;
    delayBetweenAgents?: number;
    skipToolAttachment?: boolean;
}
export interface ProvisioningResult {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    toolsAttached: number;
    errors: Array<{
        projectIdentifier: string;
        error: string;
    }>;
    durationMs: number;
}
export interface ProvisioningProgress {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
    currentBatch: string[];
    errors: string[];
    phase: 'fetching' | 'provisioning' | 'complete' | 'cancelled';
}
/**
 * Start agent provisioning workflow
 *
 * Creates Letta agents for Huly projects with fault tolerance and resume capability.
 */
export declare function startAgentProvisioning(input?: ProvisioningInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute agent provisioning and wait for completion
 */
export declare function executeAgentProvisioning(input?: ProvisioningInput): Promise<ProvisioningResult>;
/**
 * Get provisioning progress
 */
export declare function getProvisioningProgress(workflowId: string): Promise<ProvisioningProgress | null>;
/**
 * Cancel a running provisioning workflow
 */
export declare function cancelProvisioning(workflowId: string): Promise<void>;
/**
 * Provision a single agent
 */
export declare function provisionSingleAgent(input: {
    projectIdentifier: string;
    projectName: string;
    attachTools?: boolean;
}): Promise<{
    success: boolean;
    agentId?: string;
    created?: boolean;
    toolsAttached?: number;
    error?: string;
}>;
/**
 * Cleanup failed provisions
 */
export declare function cleanupFailedProvisions(projectIdentifiers: string[]): Promise<{
    cleaned: number;
    errors: string[];
}>;
export interface BeadsSyncInput {
    beadsIssueId: string;
    context: SyncContext;
    linkedIds?: {
        hulyId?: string;
        vibeId?: string;
    };
}
/**
 * Schedule a Beads sync workflow (fire-and-forget)
 *
 * Triggered when Beads files change. Syncs from Beads to Huly and Vibe.
 * Returns immediately; workflow runs in background with retry.
 */
export declare function scheduleBeadsSync(input: BeadsSyncInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a Beads sync and wait for result
 *
 * Blocks until the workflow completes (with all retries).
 */
export declare function executeBeadsSync(input: BeadsSyncInput): Promise<BidirectionalSyncResult>;
/**
 * Schedule batch Beads sync for multiple changed issues
 *
 * When multiple Beads issues change at once (e.g., git pull), this
 * schedules individual workflows for each changed issue.
 */
export declare function scheduleBatchBeadsSync(inputs: BeadsSyncInput[]): Promise<Array<{
    workflowId: string;
    runId: string;
}>>;
/**
 * Schedule a Beads file change workflow
 *
 * This is the main entry point for BeadsWatcher to trigger durable syncs.
 * When .beads files change, call this to sync all Beads issues.
 */
export declare function scheduleBeadsFileChange(input: BeadsFileChangeInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a Beads file change workflow and wait for result
 */
export declare function executeBeadsFileChange(input: BeadsFileChangeInput): Promise<BeadsFileChangeResult>;
/**
 * Schedule a Vibe SSE change workflow
 *
 * This is the main entry point for VibeEventWatcher to trigger durable syncs.
 * When Vibe SSE events indicate task changes, call this to sync to Huly.
 */
export declare function scheduleVibeSSEChange(input: VibeSSEChangeInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a Vibe SSE change workflow and wait for result
 */
export declare function executeVibeSSEChange(input: VibeSSEChangeInput): Promise<VibeSSEChangeResult>;
/**
 * Schedule a Huly webhook change workflow (fire and forget)
 *
 * Processes Huly webhook change events and syncs to Vibe/Beads.
 * Returns immediately after scheduling.
 */
export declare function scheduleHulyWebhookChange(input: HulyWebhookChangeInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a Huly webhook change workflow and wait for result
 */
export declare function executeHulyWebhookChange(input: HulyWebhookChangeInput): Promise<HulyWebhookChangeResult>;
//# sourceMappingURL=client.d.ts.map