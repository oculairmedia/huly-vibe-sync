/**
 * Agent Provisioning Client Functions
 *
 * Schedule and manage Letta agent provisioning workflows.
 */
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
//# sourceMappingURL=agent-provisioning.d.ts.map