/**
 * Letta Memory Update Workflow
 *
 * POC workflow for testing Temporal integration with VibeSync.
 * Wraps Letta memory block updates with durable retry.
 *
 * When Letta returns 502s or timeouts, the workflow automatically
 * retries with exponential backoff. Failed updates stay visible
 * in Temporal UI until resolved.
 */
export interface MemoryUpdateInput {
    agentId: string;
    blockLabel: string;
    newValue: string;
    source?: string;
}
export interface MemoryUpdateResult {
    success: boolean;
    agentId: string;
    blockLabel: string;
    attempts: number;
    error?: string;
    previousValue?: string;
}
export declare const cancelSignal: import("@temporalio/workflow").SignalDefinition<[], "cancel">;
export declare const statusQuery: import("@temporalio/workflow").QueryDefinition<{
    attempts: number;
    lastError?: string;
}, [], string>;
/**
 * Memory Update Workflow
 *
 * Updates a Letta agent's memory block with automatic retry on failure.
 * Visible in Temporal UI for monitoring and debugging.
 */
export declare function MemoryUpdateWorkflow(input: MemoryUpdateInput): Promise<MemoryUpdateResult>;
export interface BatchMemoryUpdateInput {
    updates: MemoryUpdateInput[];
    source?: string;
}
export interface BatchMemoryUpdateResult {
    total: number;
    succeeded: number;
    failed: number;
    failures: Array<{
        agentId: string;
        blockLabel: string;
        error: string;
    }>;
}
/**
 * Batch Memory Update Workflow
 *
 * Updates multiple agent memory blocks in parallel.
 * Use after a sync cycle when multiple agents need updates.
 */
export declare function BatchMemoryUpdateWorkflow(input: BatchMemoryUpdateInput): Promise<BatchMemoryUpdateResult>;
//# sourceMappingURL=memory-update.d.ts.map