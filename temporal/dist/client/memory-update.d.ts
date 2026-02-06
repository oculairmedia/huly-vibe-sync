/**
 * Memory Update Client Functions
 *
 * Schedule and manage Letta memory update workflows.
 */
import type { MemoryUpdateInput, MemoryUpdateResult } from '../workflows/memory-update';
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
//# sourceMappingURL=memory-update.d.ts.map