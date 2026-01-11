"use strict";
/**
 * Agent Provisioning Workflow
 *
 * Converts sequential agent provisioning to fault-tolerant Temporal workflow.
 *
 * Benefits over current implementation:
 * - Checkpoints each agent creation (resume from failure point)
 * - Parallel agent provisioning with controlled concurrency
 * - Progress visibility in Temporal UI
 * - Automatic retry with configurable policy
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelSignal = exports.progressQuery = void 0;
exports.ProvisionAgentsWorkflow = ProvisionAgentsWorkflow;
exports.ProvisionSingleAgentWorkflow = ProvisionSingleAgentWorkflow;
exports.CleanupFailedProvisionsWorkflow = CleanupFailedProvisionsWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Proxy activities with retry policy
const { fetchAgentsToProvision, provisionSingleAgent, attachToolsToAgent, recordProvisioningResult, cleanupFailedProvision, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '30 seconds',
        maximumAttempts: 3,
    },
});
// ============================================================================
// Queries and Signals
// ============================================================================
exports.progressQuery = (0, workflow_1.defineQuery)('progress');
exports.cancelSignal = (0, workflow_1.defineSignal)('cancel');
// ============================================================================
// Main Workflow: ProvisionAgentsWorkflow
// ============================================================================
/**
 * Provision agents for multiple projects with fault tolerance
 *
 * Features:
 * - Fetches projects to provision
 * - Batches agent creation with controlled concurrency
 * - Checkpoints progress after each batch
 * - Can resume from failure point
 * - Handles cancellation gracefully
 */
async function ProvisionAgentsWorkflow(input = {}) {
    const startTime = Date.now();
    const { projectIdentifiers, maxConcurrency = 3, delayBetweenAgents = 2000, skipToolAttachment = false, resumeFromCheckpoint = false, } = input;
    // State for queries
    let cancelled = false;
    const progress = {
        total: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        currentBatch: [],
        errors: [],
        phase: 'fetching',
    };
    // Set up handlers
    (0, workflow_1.setHandler)(exports.progressQuery, () => progress);
    (0, workflow_1.setHandler)(exports.cancelSignal, () => {
        cancelled = true;
        progress.phase = 'cancelled';
    });
    // Result tracking
    const result = {
        total: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        toolsAttached: 0,
        errors: [],
        durationMs: 0,
    };
    try {
        // Phase 1: Fetch agents to provision
        workflow_1.log.info('[ProvisionAgents] Fetching agents to provision...');
        const agents = await fetchAgentsToProvision(projectIdentifiers);
        progress.total = agents.length;
        result.total = agents.length;
        if (agents.length === 0) {
            workflow_1.log.info('[ProvisionAgents] No agents to provision');
            progress.phase = 'complete';
            result.durationMs = Date.now() - startTime;
            return result;
        }
        workflow_1.log.info('[ProvisionAgents] Found agents to provision', {
            count: agents.length,
        });
        // Phase 2: Provision agents in batches
        progress.phase = 'provisioning';
        // Split agents into batches for parallel processing
        const batches = [];
        for (let i = 0; i < agents.length; i += maxConcurrency) {
            batches.push(agents.slice(i, i + maxConcurrency));
        }
        for (const batch of batches) {
            if (cancelled) {
                workflow_1.log.info('[ProvisionAgents] Cancelled by user');
                break;
            }
            progress.currentBatch = batch.map(a => a.projectIdentifier);
            // Process batch in parallel
            const batchResults = await Promise.allSettled(batch.map(async (agent) => {
                try {
                    // Create or ensure agent exists
                    const agentResult = await provisionSingleAgent(agent.projectIdentifier, agent.projectName);
                    // Attach tools if not skipped
                    let toolsAttached = 0;
                    if (!skipToolAttachment && agentResult.agentId) {
                        const toolResult = await attachToolsToAgent(agentResult.agentId);
                        toolsAttached = toolResult.attached;
                    }
                    return {
                        success: true,
                        projectIdentifier: agent.projectIdentifier,
                        agentId: agentResult.agentId,
                        created: agentResult.created,
                        toolsAttached,
                    };
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        success: false,
                        projectIdentifier: agent.projectIdentifier,
                        error: errorMessage,
                    };
                }
            }));
            // Process batch results
            for (const settledResult of batchResults) {
                progress.processed++;
                if (settledResult.status === 'fulfilled') {
                    const agentResult = settledResult.value;
                    if (agentResult.success) {
                        progress.succeeded++;
                        result.succeeded++;
                        if ('toolsAttached' in agentResult) {
                            result.toolsAttached += agentResult.toolsAttached || 0;
                        }
                    }
                    else {
                        progress.failed++;
                        result.failed++;
                        progress.errors.push(`${agentResult.projectIdentifier}: ${agentResult.error}`);
                        result.errors.push({
                            projectIdentifier: agentResult.projectIdentifier,
                            error: agentResult.error || 'Unknown error',
                        });
                    }
                }
                else {
                    // Promise rejected
                    progress.failed++;
                    result.failed++;
                    const errorMessage = settledResult.reason?.message || 'Unknown error';
                    progress.errors.push(`Batch error: ${errorMessage}`);
                }
            }
            // Record checkpoint after each batch
            await recordProvisioningResult({
                batchNumber: batches.indexOf(batch) + 1,
                totalBatches: batches.length,
                processed: progress.processed,
                succeeded: progress.succeeded,
                failed: progress.failed,
            });
            // Delay between batches (unless cancelled)
            if (!cancelled && batches.indexOf(batch) < batches.length - 1) {
                await (0, workflow_1.sleep)(delayBetweenAgents);
            }
        }
        progress.phase = 'complete';
        progress.currentBatch = [];
        workflow_1.log.info('[ProvisionAgents] Provisioning complete', {
            total: result.total,
            succeeded: result.succeeded,
            failed: result.failed,
            toolsAttached: result.toolsAttached,
        });
    }
    catch (error) {
        if ((0, workflow_1.isCancellation)(error)) {
            workflow_1.log.info('[ProvisionAgents] Workflow cancelled');
            progress.phase = 'cancelled';
        }
        else {
            workflow_1.log.error('[ProvisionAgents] Workflow failed', { error });
            throw error;
        }
    }
    result.durationMs = Date.now() - startTime;
    return result;
}
// ============================================================================
// Child Workflow: ProvisionSingleAgentWorkflow
// ============================================================================
/**
 * Provision a single agent with full retry capability
 *
 * Can be used standalone or as a child workflow from ProvisionAgentsWorkflow
 */
async function ProvisionSingleAgentWorkflow(input) {
    const { projectIdentifier, projectName, attachTools = true } = input;
    try {
        // Create or ensure agent exists
        const agentResult = await provisionSingleAgent(projectIdentifier, projectName);
        // Attach tools if requested
        let toolsAttached = 0;
        if (attachTools && agentResult.agentId) {
            const toolResult = await attachToolsToAgent(agentResult.agentId);
            toolsAttached = toolResult.attached;
        }
        workflow_1.log.info('[ProvisionSingleAgent] Agent provisioned', {
            projectIdentifier,
            agentId: agentResult.agentId,
            created: agentResult.created,
            toolsAttached,
        });
        return {
            success: true,
            agentId: agentResult.agentId,
            created: agentResult.created,
            toolsAttached,
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        workflow_1.log.error('[ProvisionSingleAgent] Failed', {
            projectIdentifier,
            error: errorMessage,
        });
        return {
            success: false,
            error: errorMessage,
        };
    }
}
// ============================================================================
// Cleanup Workflow: CleanupFailedProvisionsWorkflow
// ============================================================================
/**
 * Cleanup workflow for failed provisions
 *
 * Removes partially created agents that failed tool attachment
 */
async function CleanupFailedProvisionsWorkflow(input) {
    const { projectIdentifiers } = input;
    let cleaned = 0;
    const errors = [];
    for (const projectIdentifier of projectIdentifiers) {
        try {
            await cleanupFailedProvision(projectIdentifier);
            cleaned++;
            workflow_1.log.info('[Cleanup] Cleaned up failed provision', { projectIdentifier });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push(`${projectIdentifier}: ${errorMessage}`);
            workflow_1.log.error('[Cleanup] Failed to cleanup', { projectIdentifier, error: errorMessage });
        }
    }
    return { cleaned, errors };
}
//# sourceMappingURL=agent-provisioning.js.map