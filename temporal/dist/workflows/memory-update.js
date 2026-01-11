"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusQuery = exports.cancelSignal = void 0;
exports.MemoryUpdateWorkflow = MemoryUpdateWorkflow;
exports.BatchMemoryUpdateWorkflow = BatchMemoryUpdateWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Proxy activities with retry policy
const { updateMemoryBlock } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '30 seconds',
    retry: {
        initialInterval: '1 second',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 10,
        nonRetryableErrorTypes: ['LettaNotFoundError', 'LettaValidationError'],
    },
});
// Signals
exports.cancelSignal = (0, workflow_1.defineSignal)('cancel');
// Queries
exports.statusQuery = (0, workflow_1.defineQuery)('status');
/**
 * Memory Update Workflow
 *
 * Updates a Letta agent's memory block with automatic retry on failure.
 * Visible in Temporal UI for monitoring and debugging.
 */
async function MemoryUpdateWorkflow(input) {
    const { agentId, blockLabel, newValue, source = 'unknown' } = input;
    let attempts = 0;
    let lastError;
    let cancelled = false;
    // Handle cancel signal
    (0, workflow_1.setHandler)(exports.cancelSignal, () => {
        cancelled = true;
    });
    // Handle status query
    (0, workflow_1.setHandler)(exports.statusQuery, () => ({
        attempts,
        lastError,
    }));
    console.log(`[MemoryUpdateWorkflow] Starting: agent=${agentId}, block=${blockLabel}, source=${source}`);
    try {
        attempts++;
        const result = await updateMemoryBlock({
            agentId,
            blockLabel,
            newValue,
        });
        console.log(`[MemoryUpdateWorkflow] Success: agent=${agentId}, block=${blockLabel}`);
        return {
            success: true,
            agentId,
            blockLabel,
            attempts,
            previousValue: result.previousValue,
        };
    }
    catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.log(`[MemoryUpdateWorkflow] Failed: agent=${agentId}, block=${blockLabel}, error=${lastError}`);
        return {
            success: false,
            agentId,
            blockLabel,
            attempts,
            error: lastError,
        };
    }
}
/**
 * Batch Memory Update Workflow
 *
 * Updates multiple agent memory blocks in parallel.
 * Use after a sync cycle when multiple agents need updates.
 */
async function BatchMemoryUpdateWorkflow(input) {
    const { updates, source = 'batch' } = input;
    console.log(`[BatchMemoryUpdateWorkflow] Starting batch of ${updates.length} updates`);
    const results = {
        total: updates.length,
        succeeded: 0,
        failed: 0,
        failures: [],
    };
    // Process updates in parallel (Temporal handles concurrency)
    const promises = updates.map(async (update) => {
        try {
            const result = await updateMemoryBlock({
                agentId: update.agentId,
                blockLabel: update.blockLabel,
                newValue: update.newValue,
            });
            if (result.success) {
                results.succeeded++;
            }
            else {
                results.failed++;
                results.failures.push({
                    agentId: update.agentId,
                    blockLabel: update.blockLabel,
                    error: 'Update returned success=false',
                });
            }
        }
        catch (error) {
            results.failed++;
            results.failures.push({
                agentId: update.agentId,
                blockLabel: update.blockLabel,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    await Promise.all(promises);
    console.log(`[BatchMemoryUpdateWorkflow] Complete: ${results.succeeded}/${results.total} succeeded`);
    return results;
}
//# sourceMappingURL=memory-update.js.map