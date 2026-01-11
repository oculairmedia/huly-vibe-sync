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
export interface AgentInfo {
    projectIdentifier: string;
    projectName: string;
    existingAgentId?: string;
}
export declare const progressQuery: import("@temporalio/workflow").QueryDefinition<ProvisioningProgress, [], string>;
export declare const cancelSignal: import("@temporalio/workflow").SignalDefinition<[], "cancel">;
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
export declare function ProvisionAgentsWorkflow(input?: ProvisioningInput): Promise<ProvisioningResult>;
/**
 * Provision a single agent with full retry capability
 *
 * Can be used standalone or as a child workflow from ProvisionAgentsWorkflow
 */
export declare function ProvisionSingleAgentWorkflow(input: {
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
 * Cleanup workflow for failed provisions
 *
 * Removes partially created agents that failed tool attachment
 */
export declare function CleanupFailedProvisionsWorkflow(input: {
    projectIdentifiers: string[];
}): Promise<{
    cleaned: number;
    errors: string[];
}>;
//# sourceMappingURL=agent-provisioning.d.ts.map