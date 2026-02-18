"use strict";
/**
 * Letta API Activities for Temporal
 *
 * These activities handle Letta API calls with proper error typing
 * for Temporal's retry policies. Uses the official Letta SDK.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateMemoryBlock = updateMemoryBlock;
const activity_1 = require("@temporalio/activity");
const letta_client_1 = require("@letta-ai/letta-client");
// Configuration
const LETTA_API_BASE = process.env.LETTA_API_URL || 'http://192.168.50.90:8289';
const LETTA_PASSWORD = process.env.LETTA_PASSWORD || '';
// Initialize Letta client
const lettaClient = new letta_client_1.LettaClient({
    baseUrl: LETTA_API_BASE,
    token: LETTA_PASSWORD,
});
/**
 * Update a memory block for a Letta agent.
 *
 * This is the core activity for the MemoryUpdateWorkflow.
 * Throws typed errors for Temporal retry classification:
 * - LettaNotFoundError (404) - non-retryable
 * - LettaValidationError (400) - non-retryable
 * - LettaServerError (5xx) - retryable
 */
async function updateMemoryBlock(input) {
    const { agentId, blockLabel, newValue } = input;
    console.log(`[Letta Activity] Updating memory block: agent=${agentId}, block=${blockLabel}`);
    try {
        // Step 1: Get agent's blocks
        const blocks = await lettaClient.agents.blocks.list(agentId);
        // Find the block by label
        const block = blocks.find(b => b.label === blockLabel);
        if (!block || !block.id) {
            throw activity_1.ApplicationFailure.nonRetryable(`Memory block '${blockLabel}' not found for agent ${agentId}`, 'LettaNotFoundError');
        }
        const previousValue = block.value || '';
        const blockId = block.id;
        // Step 2: Update the block using SDK
        await lettaClient.blocks.modify(blockId, { value: newValue });
        console.log(`[Letta Activity] Memory block updated successfully: agent=${agentId}, block=${blockLabel}`);
        return {
            success: true,
            blockId,
            previousValue,
        };
    }
    catch (error) {
        // Re-throw ApplicationFailure as-is
        if (error instanceof activity_1.ApplicationFailure) {
            throw error;
        }
        // Handle SDK errors
        if (error instanceof Error) {
            const message = error.message.toLowerCase();
            // Not found errors
            if (message.includes('404') || message.includes('not found')) {
                throw activity_1.ApplicationFailure.nonRetryable(`Not found: ${error.message}`, 'LettaNotFoundError');
            }
            // Validation errors
            if (message.includes('400') || message.includes('validation')) {
                throw activity_1.ApplicationFailure.nonRetryable(`Validation error: ${error.message}`, 'LettaValidationError');
            }
            // Server errors (retryable)
            if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('timeout')) {
                throw activity_1.ApplicationFailure.retryable(`Server error: ${error.message}`, 'LettaServerError');
            }
            // Network errors (retryable)
            if (message.includes('fetch') || message.includes('network') || message.includes('econnrefused')) {
                throw activity_1.ApplicationFailure.retryable(`Network error: ${error.message}`, 'LettaServerError');
            }
        }
        // Unknown error - make it retryable to be safe
        throw activity_1.ApplicationFailure.retryable(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`, 'LettaServerError');
    }
}
//# sourceMappingURL=letta.js.map