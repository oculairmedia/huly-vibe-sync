"use strict";
/**
 * Agent Provisioning Activities
 *
 * Activities for agent provisioning workflow using official Letta SDK.
 * Each activity is atomic and retryable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAgentsToProvision = fetchAgentsToProvision;
exports.provisionSingleAgent = provisionSingleAgent;
exports.attachToolsToAgent = attachToolsToAgent;
exports.recordProvisioningResult = recordProvisioningResult;
exports.cleanupFailedProvision = cleanupFailedProvision;
exports.getProvisioningStatus = getProvisioningStatus;
const activity_1 = require("@temporalio/activity");
const letta_client_1 = require("@letta-ai/letta-client");
const lib_1 = require("../lib");
// Configuration
const LETTA_API_BASE = process.env.LETTA_API_URL || 'https://letta.oculair.ca';
const LETTA_PASSWORD = process.env.LETTA_PASSWORD || '';
const LETTA_MODEL = process.env.LETTA_MODEL || 'letta/letta-free';
const LETTA_EMBEDDING = process.env.LETTA_EMBEDDING || 'letta/letta-free';
// Initialize Letta client
const lettaClient = new letta_client_1.LettaClient({
    baseUrl: LETTA_API_BASE,
    token: LETTA_PASSWORD,
});
// ============================================================================
// Activity: Fetch Agents to Provision
// ============================================================================
/**
 * Fetch list of projects/agents that need provisioning
 *
 * @param projectIdentifiers - Optional list of specific projects to provision
 * @returns Array of agent info objects
 */
async function fetchAgentsToProvision(projectIdentifiers) {
    console.log('[Activity:FetchAgents] Fetching agents to provision...');
    try {
        // Fetch Huly projects using the shared client (same as orchestration activities)
        const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        const hulyProjects = await hulyClient.listProjects();
        console.log(`[Activity:FetchAgents] Found ${hulyProjects.length} Huly projects`);
        // Filter to specific projects if provided
        let projects = hulyProjects;
        if (projectIdentifiers && projectIdentifiers.length > 0) {
            projects = hulyProjects.filter(p => projectIdentifiers.includes(p.identifier));
        }
        // Get existing Letta agents with huly-vibe-sync tag
        // Using matchAllTags ensures we only get agents that belong to our sync system
        const existingAgents = await lettaClient.agents.list({
            tags: ['huly-vibe-sync'],
            limit: 500,
        });
        // Build map of project identifier -> agent ID
        // Parse the project:IDENTIFIER tag to get the project mapping
        const agentByProject = new Map();
        const agentByName = new Map();
        for (const agent of existingAgents) {
            if (!agent.id || !agent.name)
                continue;
            // Store by name for fallback matching
            if (agent.name.startsWith('Huly - ')) {
                agentByName.set(agent.name, agent.id);
            }
            // Extract project identifier from tags
            const projectTag = agent.tags?.find(t => t.startsWith('project:'));
            if (projectTag) {
                const projectId = projectTag.replace('project:', '');
                agentByProject.set(projectId, agent.id);
            }
        }
        console.log(`[Activity:FetchAgents] Found ${existingAgents.length} existing huly-vibe-sync agents`);
        // Build list of agents to provision
        const agentsToProvision = [];
        for (const project of projects) {
            const sanitizedName = project.name.replace(/[/\\:*?"<>|]/g, '-');
            const agentName = `Huly - ${sanitizedName}`;
            // Prefer project ID match, fallback to name match
            const existingAgentId = agentByProject.get(project.identifier) || agentByName.get(agentName);
            agentsToProvision.push({
                projectIdentifier: project.identifier,
                projectName: project.name,
                existingAgentId,
            });
        }
        console.log(`[Activity:FetchAgents] Found ${agentsToProvision.length} agents to provision`);
        return agentsToProvision;
    }
    catch (error) {
        if (error instanceof activity_1.ApplicationFailure) {
            throw error;
        }
        throw activity_1.ApplicationFailure.retryable(`Failed to fetch agents: ${error instanceof Error ? error.message : String(error)}`, 'FetchError');
    }
}
// ============================================================================
// Activity: Provision Single Agent
// ============================================================================
/**
 * Provision a single agent for a project
 *
 * Creates the agent if it doesn't exist, or returns existing agent.
 *
 * @param projectIdentifier - Huly project identifier
 * @param projectName - Huly project name
 * @returns Provision result with agent ID and creation status
 */
async function provisionSingleAgent(projectIdentifier, projectName) {
    console.log(`[Activity:ProvisionAgent] Provisioning agent for ${projectIdentifier}...`);
    const sanitizedName = projectName.replace(/[/\\:*?"<>|]/g, '-');
    const agentName = `Huly - ${sanitizedName}`;
    try {
        // First check if agent already exists using precise tag matching
        // This mirrors the deduplication logic in LettaService.ensureAgent()
        const existingAgents = await lettaClient.agents.list({
            name: agentName,
            tags: ['huly-vibe-sync', `project:${projectIdentifier}`],
            matchAllTags: true, // Must have BOTH tags - critical for deduplication
            limit: 100,
        });
        // Double-check exact name match (server may do partial matching)
        const matchingAgents = existingAgents.filter(a => a.name === agentName);
        if (matchingAgents.length > 0) {
            // DUPLICATE DETECTION: Handle multiple agents with same name
            if (matchingAgents.length > 1) {
                console.warn(`[Activity:ProvisionAgent] ⚠️ DUPLICATE AGENTS DETECTED: Found ${matchingAgents.length} agents with name "${agentName}"!`);
                matchingAgents.forEach((agent, idx) => {
                    console.warn(`[Activity:ProvisionAgent]   ${idx + 1}. ${agent.id} (created: ${agent.createdAt || 'unknown'})`);
                });
                // Use the most recently created agent
                const sortedAgents = [...matchingAgents].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
                const selectedAgent = sortedAgents[0];
                console.warn(`[Activity:ProvisionAgent] Using most recent agent: ${selectedAgent.id}`);
                return {
                    agentId: selectedAgent.id,
                    created: false,
                };
            }
            console.log(`[Activity:ProvisionAgent] Agent already exists: ${matchingAgents[0].id}`);
            return {
                agentId: matchingAgents[0].id,
                created: false,
            };
        }
        // Create new agent
        console.log(`[Activity:ProvisionAgent] Creating new agent: ${agentName}`);
        const agent = await lettaClient.agents.create({
            name: agentName,
            agentType: 'letta_v1_agent',
            model: LETTA_MODEL,
            embedding: LETTA_EMBEDDING,
            tags: ['huly-vibe-sync', `project:${projectIdentifier}`],
        });
        console.log(`[Activity:ProvisionAgent] Agent created: ${agent.id}`);
        return {
            agentId: agent.id,
            created: true,
        };
    }
    catch (error) {
        if (error instanceof activity_1.ApplicationFailure) {
            throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        // Rate limit errors are retryable
        if (message.includes('429') || message.includes('rate limit')) {
            throw activity_1.ApplicationFailure.retryable(`Rate limit hit: ${message}`, 'RateLimitError');
        }
        // Server errors are retryable
        if (message.includes('500') || message.includes('502') || message.includes('503')) {
            throw activity_1.ApplicationFailure.retryable(`Server error: ${message}`, 'LettaServerError');
        }
        // Not found errors are non-retryable
        if (message.includes('404')) {
            throw activity_1.ApplicationFailure.nonRetryable(`Not found: ${message}`, 'LettaNotFoundError');
        }
        throw activity_1.ApplicationFailure.retryable(`Failed to provision agent: ${message}`, 'ProvisionError');
    }
}
// ============================================================================
// Activity: Attach Tools to Agent
// ============================================================================
/**
 * Attach PM tools to an agent
 *
 * Gets tools from control agent and attaches them to the target agent.
 *
 * @param agentId - Target agent ID
 * @returns Tool attachment result
 */
async function attachToolsToAgent(agentId) {
    console.log(`[Activity:AttachTools] Attaching tools to agent ${agentId}...`);
    const result = {
        attached: 0,
        skipped: 0,
        errors: [],
    };
    try {
        // Get control agent (the agent that has the correct tool configuration)
        const controlAgentName = process.env.LETTA_CONTROL_AGENT_NAME || 'Meridian';
        const controlAgents = await lettaClient.agents.list({ name: controlAgentName, limit: 1 });
        if (controlAgents.length === 0) {
            console.log(`[Activity:AttachTools] No control agent found, skipping tool attachment`);
            return result;
        }
        const controlAgent = controlAgents[0];
        // Get control agent's tools
        const controlTools = await lettaClient.agents.tools.list(controlAgent.id);
        const controlToolIds = controlTools
            .map(t => t.id)
            .filter((id) => id !== undefined);
        console.log(`[Activity:AttachTools] Control agent has ${controlToolIds.length} tools`);
        // Get target agent's existing tools
        const existingTools = await lettaClient.agents.tools.list(agentId);
        const existingToolIds = new Set(existingTools.map(t => t.id).filter((id) => id !== undefined));
        // Attach missing tools
        for (const toolId of controlToolIds) {
            if (existingToolIds.has(toolId)) {
                result.skipped++;
                continue;
            }
            try {
                await lettaClient.agents.tools.attach(agentId, toolId);
                result.attached++;
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                result.errors.push({ toolId, error: errorMessage });
            }
        }
        console.log(`[Activity:AttachTools] Attached ${result.attached} tools, skipped ${result.skipped}`);
        return result;
    }
    catch (error) {
        if (error instanceof activity_1.ApplicationFailure) {
            throw error;
        }
        throw activity_1.ApplicationFailure.retryable(`Failed to attach tools: ${error instanceof Error ? error.message : String(error)}`, 'ToolAttachmentError');
    }
}
// ============================================================================
// Activity: Record Provisioning Result
// ============================================================================
/**
 * Record a checkpoint of provisioning progress
 *
 * This can be used to persist state for resume capability.
 *
 * @param data - Checkpoint data
 */
async function recordProvisioningResult(data) {
    console.log(`[Activity:Checkpoint] Batch ${data.batchNumber}/${data.totalBatches} - ` +
        `Processed: ${data.processed}, Succeeded: ${data.succeeded}, Failed: ${data.failed}`);
    // In a production implementation, this would persist to database
    // For now, we just log it (Temporal provides the durability)
}
// ============================================================================
// Activity: Cleanup Failed Provision
// ============================================================================
/**
 * Cleanup a failed provision
 *
 * Removes partially created agents that failed during provisioning.
 *
 * @param projectIdentifier - Project identifier to cleanup
 */
async function cleanupFailedProvision(projectIdentifier) {
    console.log(`[Activity:Cleanup] Cleaning up failed provision for ${projectIdentifier}...`);
    try {
        // Find agents for this project using tags
        const allAgents = await lettaClient.agents.list({
            tags: ['huly-vibe-sync', `project:${projectIdentifier}`],
            matchAllTags: true,
            limit: 100,
        });
        if (allAgents.length === 0) {
            console.log(`[Activity:Cleanup] No agents found for ${projectIdentifier}`);
            return;
        }
        // Delete matching agents
        for (const agent of allAgents) {
            console.log(`[Activity:Cleanup] Deleting agent ${agent.id}...`);
            await lettaClient.agents.delete(agent.id);
        }
        console.log(`[Activity:Cleanup] Cleaned up ${allAgents.length} agents`);
    }
    catch (error) {
        if (error instanceof activity_1.ApplicationFailure) {
            throw error;
        }
        throw activity_1.ApplicationFailure.retryable(`Failed to cleanup: ${error instanceof Error ? error.message : String(error)}`, 'CleanupError');
    }
}
// ============================================================================
// Activity: Get Provisioning Status
// ============================================================================
/**
 * Get current provisioning status from persisted state
 *
 * Used for resume capability.
 */
async function getProvisioningStatus() {
    // In a production implementation, this would read from database
    // For now, return empty state
    return {
        completedProjects: [],
    };
}
//# sourceMappingURL=agent-provisioning.js.map