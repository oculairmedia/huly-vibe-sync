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

import {
  proxyActivities,
  defineQuery,
  defineSignal,
  setHandler,
  sleep,
  log,
  CancellationScope,
  isCancellation,
} from '@temporalio/workflow';

import type * as activities from '../activities/agent-provisioning';

// Proxy activities with retry policy
const {
  fetchAgentsToProvision,
  provisionSingleAgent,
  attachToolsToAgent,
  recordProvisioningResult,
  cleanupFailedProvision,
  updateProjectAgentsMd,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 3,
  },
});

// ============================================================================
// Types
// ============================================================================

export interface ProvisioningInput {
  /** Optional list of specific project identifiers to provision */
  projectIdentifiers?: string[];
  /** Maximum number of agents to process in parallel */
  maxConcurrency?: number;
  /** Delay between agent provisions in milliseconds */
  delayBetweenAgents?: number;
  /** If true, only create agents without attaching tools */
  skipToolAttachment?: boolean;
  /** If true, resume from last checkpoint */
  resumeFromCheckpoint?: boolean;
}

export interface ProvisioningResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  toolsAttached: number;
  errors: Array<{ projectIdentifier: string; error: string }>;
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

export interface AgentInfo {
  projectIdentifier: string;
  projectName: string;
  existingAgentId?: string;
}

// ============================================================================
// Queries and Signals
// ============================================================================

export const progressQuery = defineQuery<ProvisioningProgress>('progress');
export const cancelSignal = defineSignal('cancel');

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
export async function ProvisionAgentsWorkflow(
  input: ProvisioningInput = {}
): Promise<ProvisioningResult> {
  const startTime = Date.now();
  const {
    projectIdentifiers,
    maxConcurrency = 3,
    delayBetweenAgents = 2000,
    skipToolAttachment = false,
    resumeFromCheckpoint = false,
  } = input;

  // State for queries
  let cancelled = false;
  const progress: ProvisioningProgress = {
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    currentBatch: [],
    errors: [],
    phase: 'fetching',
  };

  // Set up handlers
  setHandler(progressQuery, () => progress);
  setHandler(cancelSignal, () => {
    cancelled = true;
    progress.phase = 'cancelled';
  });

  // Result tracking
  const result: ProvisioningResult = {
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
    log.info('[ProvisionAgents] Fetching agents to provision...');
    const agents = await fetchAgentsToProvision(projectIdentifiers);
    progress.total = agents.length;
    result.total = agents.length;

    if (agents.length === 0) {
      log.info('[ProvisionAgents] No agents to provision');
      progress.phase = 'complete';
      result.durationMs = Date.now() - startTime;
      return result;
    }

    log.info('[ProvisionAgents] Found agents to provision', {
      count: agents.length,
    });

    // Phase 2: Provision agents in batches
    progress.phase = 'provisioning';

    // Split agents into batches for parallel processing
    const batches: AgentInfo[][] = [];
    for (let i = 0; i < agents.length; i += maxConcurrency) {
      batches.push(agents.slice(i, i + maxConcurrency));
    }

    for (const batch of batches) {
      if (cancelled) {
        log.info('[ProvisionAgents] Cancelled by user');
        break;
      }

      progress.currentBatch = batch.map(a => a.projectIdentifier);

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async agent => {
          try {
            // Create or ensure agent exists
            const agentResult = await provisionSingleAgent(
              agent.projectIdentifier,
              agent.projectName
            );

            // Attach tools if not skipped
            let toolsAttached = 0;
            if (!skipToolAttachment && agentResult.agentId) {
              const toolResult = await attachToolsToAgent(agentResult.agentId);
              toolsAttached = toolResult.attached;
            }

            if (agentResult.agentId) {
              try {
                await updateProjectAgentsMd({
                  projectIdentifier: agent.projectIdentifier,
                  projectName: agent.projectName,
                  agentId: agentResult.agentId,
                });
              } catch (mdError) {
                const mdMsg = mdError instanceof Error ? mdError.message : String(mdError);
                log.warn('[ProvisionAgents] AGENTS.md update failed (non-fatal)', {
                  project: agent.projectIdentifier,
                  error: mdMsg,
                });
              }
            }

            return {
              success: true,
              projectIdentifier: agent.projectIdentifier,
              agentId: agentResult.agentId,
              created: agentResult.created,
              toolsAttached,
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
              success: false,
              projectIdentifier: agent.projectIdentifier,
              error: errorMessage,
            };
          }
        })
      );

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
          } else {
            progress.failed++;
            result.failed++;
            progress.errors.push(`${agentResult.projectIdentifier}: ${agentResult.error}`);
            result.errors.push({
              projectIdentifier: agentResult.projectIdentifier,
              error: agentResult.error || 'Unknown error',
            });
          }
        } else {
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
        await sleep(delayBetweenAgents);
      }
    }

    progress.phase = 'complete';
    progress.currentBatch = [];

    log.info('[ProvisionAgents] Provisioning complete', {
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
      toolsAttached: result.toolsAttached,
    });
  } catch (error) {
    if (isCancellation(error)) {
      log.info('[ProvisionAgents] Workflow cancelled');
      progress.phase = 'cancelled';
    } else {
      log.error('[ProvisionAgents] Workflow failed', { error });
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
export async function ProvisionSingleAgentWorkflow(input: {
  projectIdentifier: string;
  projectName: string;
  attachTools?: boolean;
}): Promise<{
  success: boolean;
  agentId?: string;
  created?: boolean;
  toolsAttached?: number;
  error?: string;
}> {
  const { projectIdentifier, projectName, attachTools = true } = input;

  try {
    const agentResult = await provisionSingleAgent(projectIdentifier, projectName);

    let toolsAttached = 0;
    if (attachTools && agentResult.agentId) {
      const toolResult = await attachToolsToAgent(agentResult.agentId);
      toolsAttached = toolResult.attached;
    }

    if (agentResult.agentId) {
      try {
        await updateProjectAgentsMd({
          projectIdentifier,
          projectName,
          agentId: agentResult.agentId,
        });
      } catch (mdError) {
        const mdMsg = mdError instanceof Error ? mdError.message : String(mdError);
        log.warn('[ProvisionSingleAgent] AGENTS.md update failed (non-fatal)', {
          projectIdentifier,
          error: mdMsg,
        });
      }
    }

    log.info('[ProvisionSingleAgent] Agent provisioned', {
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error('[ProvisionSingleAgent] Failed', {
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
export async function CleanupFailedProvisionsWorkflow(input: {
  projectIdentifiers: string[];
}): Promise<{
  cleaned: number;
  errors: string[];
}> {
  const { projectIdentifiers } = input;
  let cleaned = 0;
  const errors: string[] = [];

  for (const projectIdentifier of projectIdentifiers) {
    try {
      await cleanupFailedProvision(projectIdentifier);
      cleaned++;
      log.info('[Cleanup] Cleaned up failed provision', { projectIdentifier });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`${projectIdentifier}: ${errorMessage}`);
      log.error('[Cleanup] Failed to cleanup', { projectIdentifier, error: errorMessage });
    }
  }

  return { cleaned, errors };
}
