/**
 * Agent Provisioning Activities
 *
 * Activities for agent provisioning workflow using official Letta SDK.
 * Each activity is atomic and retryable.
 */
export interface AgentInfo {
    projectIdentifier: string;
    projectName: string;
    existingAgentId?: string;
}
export interface ProvisionResult {
    agentId: string;
    created: boolean;
}
export interface ToolAttachmentResult {
    attached: number;
    skipped: number;
    errors: Array<{
        toolId: string;
        error: string;
    }>;
}
export interface CheckpointData {
    batchNumber: number;
    totalBatches: number;
    processed: number;
    succeeded: number;
    failed: number;
}
/**
 * Fetch list of projects/agents that need provisioning
 *
 * @param projectIdentifiers - Optional list of specific projects to provision
 * @returns Array of agent info objects
 */
export declare function fetchAgentsToProvision(projectIdentifiers?: string[]): Promise<AgentInfo[]>;
/**
 * Provision a single agent for a project
 *
 * Creates the agent if it doesn't exist, or returns existing agent.
 *
 * @param projectIdentifier - Huly project identifier
 * @param projectName - Huly project name
 * @returns Provision result with agent ID and creation status
 */
export declare function provisionSingleAgent(projectIdentifier: string, projectName: string): Promise<ProvisionResult>;
/**
 * Attach PM tools to an agent
 *
 * Gets tools from control agent and attaches them to the target agent.
 *
 * @param agentId - Target agent ID
 * @returns Tool attachment result
 */
export declare function attachToolsToAgent(agentId: string): Promise<ToolAttachmentResult>;
/**
 * Record a checkpoint of provisioning progress
 *
 * This can be used to persist state for resume capability.
 *
 * @param data - Checkpoint data
 */
export declare function recordProvisioningResult(data: CheckpointData): Promise<void>;
/**
 * Cleanup a failed provision
 *
 * Removes partially created agents that failed during provisioning.
 *
 * @param projectIdentifier - Project identifier to cleanup
 */
export declare function cleanupFailedProvision(projectIdentifier: string): Promise<void>;
/**
 * Get current provisioning status from persisted state
 *
 * Used for resume capability.
 */
export declare function getProvisioningStatus(): Promise<{
    lastCheckpoint?: CheckpointData;
    completedProjects: string[];
}>;
//# sourceMappingURL=agent-provisioning.d.ts.map