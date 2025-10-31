/**
 * Letta Service Module
 * Wraps Letta SDK calls and provides clean API for agent lifecycle management
 */

import { LettaClient } from '@letta-ai/letta-client';

export class LettaService {
  constructor(baseURL, password, options = {}) {
    this.client = new LettaClient({
      baseURL,
      password,
    });
    this.model = options.model || process.env.LETTA_MODEL;
    this.embedding = options.embedding || process.env.LETTA_EMBEDDING;
  }

  /**
   * Ensure a Letta PM agent exists for a project (idempotent)
   * Creates agent on first call, returns existing on subsequent calls
   * 
   * @param {string} projectIdentifier - Project identifier (e.g., "VIBEK")
   * @param {string} projectName - Project name for display
   * @returns {Promise<Object>} Agent object with id, name, etc.
   */
  async ensureAgent(projectIdentifier, projectName) {
    const agentName = `Huly/${projectIdentifier} PM Agent`;
    
    console.log(`[Letta] Ensuring agent exists: ${agentName}`);
    
    try {
      // Try to find existing agent by name
      const agents = await this.client.agents.list();
      const existingAgent = agents.find(a => a.name === agentName);
      
      if (existingAgent) {
        console.log(`[Letta] Agent already exists: ${existingAgent.id}`);
        return existingAgent;
      }
      
      // Create new agent with PM persona
      console.log(`[Letta] Creating new agent: ${agentName}`);
      
      const persona = this._buildPersonaBlock(projectIdentifier, projectName);
      
      const agent = await this.client.agents.create({
        name: agentName,
        model: this.model,
        embedding: this.embedding,
        memory: {
          blocks: [
            {
              label: 'persona',
              value: persona,
            },
            {
              label: 'human',
              value: `Project stakeholders and team members working on ${projectName}`,
            },
          ],
        },
      });
      
      console.log(`[Letta] Agent created successfully: ${agent.id}`);
      return agent;
      
    } catch (error) {
      console.error(`[Letta] Error ensuring agent:`, error.message);
      throw error;
    }
  }

  /**
   * Attach MCP servers as tools to the agent
   * 
   * @param {string} agentId - Agent ID
   * @param {string} hulyMcpUrl - Huly MCP server URL
   * @param {string} vibeMcpUrl - Vibe Kanban MCP server URL
   */
  async attachMcpTools(agentId, hulyMcpUrl, vibeMcpUrl) {
    console.log(`[Letta] Attaching MCP tools to agent ${agentId}`);
    
    try {
      // Create or get Huly MCP tool
      const hulyTool = await this._ensureMcpTool('huly', hulyMcpUrl);
      
      // Create or get Vibe MCP tool
      const vibeTool = await this._ensureMcpTool('vibe', vibeMcpUrl);
      
      // Attach tools to agent
      await this.client.agents.tools.attach(agentId, hulyTool.id);
      console.log(`[Letta] Attached Huly MCP tool: ${hulyTool.id}`);
      
      await this.client.agents.tools.attach(agentId, vibeTool.id);
      console.log(`[Letta] Attached Vibe MCP tool: ${vibeTool.id}`);
      
      return { hulyTool, vibeTool };
      
    } catch (error) {
      console.error(`[Letta] Error attaching MCP tools:`, error.message);
      throw error;
    }
  }

  /**
   * Ensure an MCP tool exists (idempotent)
   * 
   * @private
   * @param {string} name - Tool name
   * @param {string} url - MCP server URL
   * @returns {Promise<Object>} Tool object
   */
  async _ensureMcpTool(name, url) {
    try {
      // List existing MCP tools
      const tools = await this.client.tools.mcp.list();
      const existing = tools.find(t => t.name === name);
      
      if (existing) {
        console.log(`[Letta] MCP tool already exists: ${name}`);
        return existing;
      }
      
      // Create new MCP tool
      console.log(`[Letta] Creating MCP tool: ${name} at ${url}`);
      const tool = await this.client.tools.mcp.create({
        name,
        transport: 'http',
        url,
      });
      
      console.log(`[Letta] MCP tool created: ${tool.id}`);
      return tool;
      
    } catch (error) {
      console.error(`[Letta] Error ensuring MCP tool ${name}:`, error.message);
      throw error;
    }
  }

  /**
   * Build persona memory block for PM agent
   * 
   * @private
   * @param {string} projectIdentifier - Project identifier
   * @param {string} projectName - Project name
   * @returns {string} Persona description
   */
  _buildPersonaBlock(projectIdentifier, projectName) {
    return `You are a Project Management AI assistant for the ${projectName} project (identifier: ${projectIdentifier}).

Your role is to:
- Monitor project health and Kanban board flow
- Analyze task status, WIP limits, and throughput
- Identify bottlenecks, blocked items, and risks
- Provide actionable recommendations to improve delivery
- Track changes and highlight important trends

Your style:
- Be concise and evidence-based
- Cite specific data from the board state
- Prioritize actionable insights over descriptions
- Focus on "why" and "what to do" rather than just "what"

Your constraints:
- You have read/write access via Huly and Vibe Kanban MCP tools
- Propose changes clearly but do not execute without explicit approval
- Always explain the reasoning behind recommendations
- Respect team workflows and existing processes`;
  }

  /**
   * Get agent by ID
   * 
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Agent object
   */
  async getAgent(agentId) {
    try {
      return await this.client.agents.get(agentId);
    } catch (error) {
      console.error(`[Letta] Error getting agent ${agentId}:`, error.message);
      throw error;
    }
  }

  /**
   * List all agents
   * 
   * @returns {Promise<Array>} Array of agent objects
   */
  async listAgents() {
    try {
      return await this.client.agents.list();
    } catch (error) {
      console.error(`[Letta] Error listing agents:`, error.message);
      throw error;
    }
  }
}

/**
 * Create and initialize LettaService from environment variables
 * 
 * @returns {LettaService}
 */
export function createLettaService() {
  const baseURL = process.env.LETTA_BASE_URL;
  const password = process.env.LETTA_PASSWORD;
  
  if (!baseURL || !password) {
    throw new Error('LETTA_BASE_URL and LETTA_PASSWORD must be set');
  }
  
  return new LettaService(baseURL, password, {
    model: process.env.LETTA_MODEL,
    embedding: process.env.LETTA_EMBEDDING,
  });
}
