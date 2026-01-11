"use strict";
/**
 * Issue Sync Workflow
 *
 * Handles atomic synchronization of issues across Huly, VibeKanban, and Beads.
 * Uses Temporal's durable execution for reliability and visibility.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssueSyncWorkflow = IssueSyncWorkflow;
exports.BatchIssueSyncWorkflow = BatchIssueSyncWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Proxy activities with retry policies
const { syncToHuly, syncToVibe, syncToBeads, updateLettaMemory } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '60 seconds',
    retry: {
        initialInterval: '1 second',
        backoffCoefficient: 2,
        maximumInterval: '30 seconds',
        maximumAttempts: 5,
        nonRetryableErrorTypes: [
            'HulyNotFoundError',
            'HulyValidationError',
            'VibeNotFoundError',
            'VibeValidationError',
        ],
    },
});
/**
 * IssueSyncWorkflow - Atomic sync across all systems
 *
 * Flow:
 * 1. Sync to Huly (if not source)
 * 2. Sync to Vibe (if not source)
 * 3. Sync to Beads (if not source)
 * 4. Update Letta memory (optional)
 *
 * If any critical step fails after retries, the workflow fails
 * and can be inspected in Temporal UI.
 */
async function IssueSyncWorkflow(input) {
    const startTime = Date.now();
    const { issue, operation, source, agentId } = input;
    workflow_1.log.info(`[IssueSyncWorkflow] Starting: ${operation} from ${source}`, {
        identifier: issue.identifier,
        title: issue.title,
    });
    const result = {
        success: false,
    };
    try {
        // Step 1: Sync to Huly (skip if source is Huly)
        if (source !== 'huly') {
            workflow_1.log.info(`[IssueSyncWorkflow] Syncing to Huly...`);
            result.hulyResult = await syncToHuly({ issue, operation, source });
            if (!result.hulyResult.success) {
                throw new Error(`Huly sync failed: ${result.hulyResult.error}`);
            }
            // Update issue with Huly ID if created
            if (result.hulyResult.systemId && operation === 'create') {
                issue.hulyId = result.hulyResult.systemId;
                issue.identifier = result.hulyResult.systemId;
            }
        }
        else {
            result.hulyResult = { success: true, systemId: issue.identifier };
        }
        // Step 2: Sync to Vibe (skip if source is Vibe)
        if (source !== 'vibe') {
            workflow_1.log.info(`[IssueSyncWorkflow] Syncing to Vibe...`);
            result.vibeResult = await syncToVibe({ issue, operation, source });
            if (!result.vibeResult.success) {
                throw new Error(`Vibe sync failed: ${result.vibeResult.error}`);
            }
            // Update issue with Vibe ID if created
            if (result.vibeResult.systemId && operation === 'create') {
                issue.vibeId = result.vibeResult.systemId;
            }
        }
        else {
            result.vibeResult = { success: true, systemId: issue.vibeId };
        }
        // Step 3: Sync to Beads (skip if source is Beads)
        // Beads sync is non-fatal - we continue even if it fails
        if (source !== 'beads') {
            workflow_1.log.info(`[IssueSyncWorkflow] Syncing to Beads...`);
            try {
                result.beadsResult = await syncToBeads({ issue, operation, source });
            }
            catch (beadsError) {
                workflow_1.log.warn(`[IssueSyncWorkflow] Beads sync failed (non-fatal): ${beadsError}`);
                result.beadsResult = { success: false, error: String(beadsError) };
            }
        }
        else {
            result.beadsResult = { success: true, systemId: issue.beadsId };
        }
        // Step 4: Update Letta memory (optional, non-fatal)
        if (agentId) {
            workflow_1.log.info(`[IssueSyncWorkflow] Updating Letta memory...`);
            try {
                result.lettaResult = await updateLettaMemory({
                    agentId,
                    syncResult: {
                        hulyId: result.hulyResult?.systemId,
                        vibeId: result.vibeResult?.systemId,
                        beadsId: result.beadsResult?.systemId,
                        operation,
                        timestamp: Date.now(),
                    },
                });
            }
            catch (lettaError) {
                workflow_1.log.warn(`[IssueSyncWorkflow] Letta update failed (non-fatal): ${lettaError}`);
                result.lettaResult = { success: false, error: String(lettaError) };
            }
        }
        // Success!
        result.success = true;
        result.duration = Date.now() - startTime;
        workflow_1.log.info(`[IssueSyncWorkflow] Complete`, {
            identifier: issue.identifier,
            duration: result.duration,
            huly: result.hulyResult?.success,
            vibe: result.vibeResult?.success,
            beads: result.beadsResult?.success,
        });
        return result;
    }
    catch (error) {
        result.success = false;
        result.error = error instanceof Error ? error.message : String(error);
        result.duration = Date.now() - startTime;
        workflow_1.log.error(`[IssueSyncWorkflow] Failed`, {
            identifier: issue.identifier,
            error: result.error,
            duration: result.duration,
        });
        throw error;
    }
}
/**
 * BatchIssueSyncWorkflow - Sync multiple issues in parallel
 *
 * Useful for full project syncs or bulk operations.
 */
async function BatchIssueSyncWorkflow(input) {
    const { issues, maxParallel = 5 } = input;
    workflow_1.log.info(`[BatchIssueSyncWorkflow] Starting batch sync of ${issues.length} issues`);
    const results = [];
    let succeeded = 0;
    let failed = 0;
    // Process in batches to avoid overwhelming the systems
    for (let i = 0; i < issues.length; i += maxParallel) {
        const batch = issues.slice(i, i + maxParallel);
        workflow_1.log.info(`[BatchIssueSyncWorkflow] Processing batch ${Math.floor(i / maxParallel) + 1}`);
        // Process batch in parallel
        const batchResults = await Promise.allSettled(batch.map(issueInput => IssueSyncWorkflow(issueInput)));
        for (const result of batchResults) {
            if (result.status === 'fulfilled') {
                results.push(result.value);
                if (result.value.success) {
                    succeeded++;
                }
                else {
                    failed++;
                }
            }
            else {
                failed++;
                results.push({
                    success: false,
                    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                });
            }
        }
        // Small delay between batches to be nice to the APIs
        if (i + maxParallel < issues.length) {
            await (0, workflow_1.sleep)(500);
        }
    }
    workflow_1.log.info(`[BatchIssueSyncWorkflow] Complete: ${succeeded}/${issues.length} succeeded`);
    return {
        success: failed === 0,
        total: issues.length,
        succeeded,
        failed,
        results,
    };
}
//# sourceMappingURL=issue-sync.js.map