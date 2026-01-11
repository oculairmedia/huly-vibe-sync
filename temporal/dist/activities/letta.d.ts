/**
 * Letta API Activities for Temporal
 *
 * These activities handle Letta API calls with proper error typing
 * for Temporal's retry policies. Uses the official Letta SDK.
 */
export interface MemoryBlock {
    id?: string;
    label?: string;
    value?: string;
}
export interface UpdateMemoryBlockInput {
    agentId: string;
    blockLabel: string;
    newValue: string;
}
export interface UpdateMemoryBlockResult {
    success: boolean;
    blockId: string;
    previousValue?: string;
}
/**
 * Update a memory block for a Letta agent.
 *
 * This is the core activity for the MemoryUpdateWorkflow.
 * Throws typed errors for Temporal retry classification:
 * - LettaNotFoundError (404) - non-retryable
 * - LettaValidationError (400) - non-retryable
 * - LettaServerError (5xx) - retryable
 */
export declare function updateMemoryBlock(input: UpdateMemoryBlockInput): Promise<UpdateMemoryBlockResult>;
//# sourceMappingURL=letta.d.ts.map