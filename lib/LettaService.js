/**
 * Letta Service Module
 * Wraps Letta SDK calls and provides clean API for agent lifecycle management
 */

import { LettaClient } from '@letta-ai/letta-client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithPool } from './http.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LettaService {
  constructor(baseURL, password, options = {}) {
    this.client = new LettaClient({
      baseUrl: baseURL,  // SDK expects 'baseUrl' not 'baseURL'
      token: password,   // SDK expects 'token' not 'password'
    });
    
    // Store credentials for direct REST API calls
    // SDK uses baseURL as-is, REST API needs /v1 appended
    this.baseURL = baseURL;
    this.apiURL = baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`;
    this.password = password;
    
    // Set model defaults with fallback chain
    // Model: Claude Sonnet 4.5 (using Letta's naming convention)
    // Embedding: Letta free tier (OpenAI has quota issues, Google AI has 404 errors)
    this.model = options.model || process.env.LETTA_MODEL || 'anthropic/sonnet-4-5';
    this.embedding = options.embedding || process.env.LETTA_EMBEDDING || 'letta/letta-free';
    
    // Control Agent Configuration
    // All PM agents sync tools and persona from this template agent
    this.controlAgentName = options.controlAgentName || process.env.LETTA_CONTROL_AGENT || 'Huly-PM-Control';
    this._controlAgentCache = null; // Cached control agent config
    
    // In-memory cache for folder/source lookups (reduces API calls)
    this._folderCache = new Map(); // name -> folder object
    this._sourceCache = new Map(); // name -> source object
    
    // Block hash cache for change detection (reduces API calls)
    // Map<agentId, Map<blockLabel, contentHash>>
    this._blockHashCache = new Map();
    
    // Agent persistence paths
    this.lettaDir = path.join(__dirname, '..', '.letta');
    this.settingsPath = path.join(this.lettaDir, 'settings.local.json');
    
    // Load agent state
    this._agentState = this._loadAgentState();
  }
  
  /**
   * Clear the in-memory cache (useful between sync runs)
   */
  clearCache() {
    this._folderCache.clear();
    this._sourceCache.clear();
    this._controlAgentCache = null; // Clear control agent cache too
    // Keep block hash cache - it's critical for performance
    console.log(`[Letta] Cache cleared (block hash cache retained)`);
  }

  /**
   * Get or create the control agent
   * This agent serves as the template for all PM agents
   * 
   * @returns {Promise<Object>} Control agent with tools and persona
   */
  async ensureControlAgent() {
    try {
      // Check cache first
      if (this._controlAgentCache) {
        return this._controlAgentCache;
      }

      console.log(`[Letta] Looking for control agent: ${this.controlAgentName}`);
      
      // Try to find existing control agent
      const agents = await this.client.agents.list();
      let controlAgent = agents.find(a => a.name === this.controlAgentName);
      
      if (!controlAgent) {
        console.log(`[Letta] Control agent not found, creating: ${this.controlAgentName}`);
        
        // Create control agent using REST API (same as regular agents)
        const persona = this._buildPersonaBlock('CONTROL', 'Huly PM Control Template');
        
        const response = await fetchWithPool(`${this.apiURL}/agents`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.password}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: this.controlAgentName,
            agent_type: 'letta_v1_agent',
            model: this.model,
            embedding: this.embedding,
            enable_sleeptime: false, // Control agent doesn't need sleep-time
          }),
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to create control agent: HTTP ${response.status}: ${errorText}`);
        }
        
        controlAgent = await response.json();
        console.log(`[Letta] ✓ Control agent created: ${controlAgent.id}`);
        
        // Attach persona
        await this._updatePersonaBlock(controlAgent.id, persona);
        
        // Attach human block from Meridian
        await this._attachMeridianHumanBlock(controlAgent.id);
        
        // Attach default tools (minimal set)
        const defaultTools = [
          'tool-bb40505b-8a76-441a-a23b-b6788770a865', // huly_query
          'tool-fbf98f0f-1495-42fa-ba4c-a85ac44bfbad', // huly_issue_ops
          'tool-bfb4142c-2427-4b53-a194-079840c10e3a', // huly_entity
          'tool-08ffccab-5e2b-46c2-9422-d41e66defbe3', // list_projects
          'tool-15c412cf-fcea-4406-ad1d-eb8e71bb156e', // list_tasks
          'tool-0743e6cb-9ad8-43a1-b374-661c16e39dcc', // get_task
          'tool-230e983a-1694-4ab6-99dd-ca24c13e449a', // update_task
        ];
        
        for (const toolId of defaultTools) {
          await this.client.agents.tools.attach(controlAgent.id, toolId);
        }
        
        console.log(`[Letta] ✓ Control agent configured with ${defaultTools.length} default tools`);
      }
      
      // Fetch control agent configuration
      const config = await this.getControlAgentConfig(controlAgent.id);
      
      // Cache it
      this._controlAgentCache = config;
      
      return config;
      
    } catch (error) {
      console.error(`[Letta] Error ensuring control agent:`, error.message);
      throw error;
    }
  }

  /**
   * Get control agent configuration (tools and persona)
   * 
   * @param {string} agentId - Control agent ID (optional, will find by name if not provided)
   * @returns {Promise<Object>} {agentId, toolIds, persona}
   */
  async getControlAgentConfig(agentId = null) {
    try {
      let controlAgent;
      
      if (agentId) {
        controlAgent = await this.client.agents.retrieve(agentId);
      } else {
        const agents = await this.client.agents.list();
        controlAgent = agents.find(a => a.name === this.controlAgentName);
        if (!controlAgent) {
          throw new Error(`Control agent not found: ${this.controlAgentName}`);
        }
      }
      
      // Get attached tools
      const tools = await this.client.agents.tools.list(controlAgent.id);
      const toolIds = tools.map(t => t.id);
      
      // Get persona block
      const personaBlock = controlAgent.memory.blocks.find(b => b.label === 'persona');
      const persona = personaBlock ? personaBlock.value : null;
      
      console.log(`[Letta] Control agent config: ${toolIds.length} tools, persona: ${persona ? 'yes' : 'no'}`);
      
      return {
        agentId: controlAgent.id,
        agentName: controlAgent.name,
        toolIds,
        persona,
      };
      
    } catch (error) {
      console.error(`[Letta] Error getting control agent config:`, error.message);
      throw error;
    }
  }

  /**
   * Load agent state from .letta/settings.local.json
   * @private
   */
  _loadAgentState() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        const state = JSON.parse(data);
        console.log(`[Letta] Loaded agent state for ${Object.keys(state.agents || {}).length} projects`);
        return state;
      }
    } catch (error) {
      console.error(`[Letta] Error loading agent state:`, error.message);
    }
    
    return {
      version: '1.0.0',
      description: 'Local Letta agent persistence (gitignored, personal to this instance)',
      agents: {}
    };
  }

  /**
   * Save agent state to .letta/settings.local.json
   * @private
   */
  _saveAgentState() {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.lettaDir)) {
        fs.mkdirSync(this.lettaDir, { recursive: true });
      }
      
      fs.writeFileSync(this.settingsPath, JSON.stringify(this._agentState, null, 2), 'utf8');
      console.log(`[Letta] Saved agent state for ${Object.keys(this._agentState.agents || {}).length} projects`);
    } catch (error) {
      console.error(`[Letta] Error saving agent state:`, error.message);
    }
  }

  /**
   * Get persisted agent ID for a project
   * @param {string} projectIdentifier - Project identifier (e.g., "VIBEK")
   * @returns {string|null} Agent ID or null if not found
   */
  getPersistedAgentId(projectIdentifier) {
    return this._agentState.agents[projectIdentifier] || null;
  }

  /**
   * Save agent ID for a project
   * @param {string} projectIdentifier - Project identifier (e.g., "VIBEK")
   * @param {string} agentId - Agent ID to save
   */
  saveAgentId(projectIdentifier, agentId) {
    this._agentState.agents[projectIdentifier] = agentId;
    this._saveAgentState();
    console.log(`[Letta] Persisted agent ID for ${projectIdentifier}: ${agentId}`);
  }

  /**
   * Save agent ID to project's .letta/settings.local.json file
   * This allows running `letta` from the project directory to auto-resume the agent
   * Uses Letta Code's standard format: { "lastAgent": "agent-id" }
   * 
   * @param {string} projectPath - Absolute path to project directory
   * @param {string} agentId - Agent ID to save
   */
  saveAgentIdToProjectFolder(projectPath, agentId) {
    try {
      const lettaDir = path.join(projectPath, '.letta');
      const settingsPath = path.join(lettaDir, 'settings.local.json');
      
      // Create .letta directory if it doesn't exist
      if (!fs.existsSync(lettaDir)) {
        fs.mkdirSync(lettaDir, { recursive: true, mode: 0o777 });
        console.log(`[Letta] Created .letta directory: ${lettaDir}`);
      }
      
      // Create settings.local.json in Letta Code format
      const settings = {
        lastAgent: agentId
      };
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o666 });
      console.log(`[Letta] ✓ Saved agent ID to project: ${settingsPath}`);
      
      // Create .gitignore if it doesn't exist
      const gitignorePath = path.join(lettaDir, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, '# Local agent state\nsettings.local.json\n*.log\n', 'utf8', { mode: 0o666 });
      }
      
    } catch (error) {
      // Permission errors are non-fatal - agent state is still tracked in main DB
      if (error.code === 'EACCES') {
        console.warn(`[Letta] ⚠️  Permission denied writing to ${settingsPath}`);
        console.warn(`[Letta] Agent state is still tracked in main database. To fix, run:`);
        console.warn(`[Letta]   sudo chmod 777 "${lettaDir}"`);
      } else {
        console.error(`[Letta] Error saving agent ID to project folder:`, error.message);
      }
    }
  }

  /**
   * Ensure a Letta PM agent exists for a project (idempotent)
   * Creates agent on first call, returns existing on subsequent calls
   * 
   * OPTIMIZED: Uses server-side name filtering instead of listing all agents
   * 
   * @param {string} projectIdentifier - Project identifier (e.g., "VIBEK")
   * @param {string} projectName - Project name for display
   * @returns {Promise<Object>} Agent object with id, name, etc.
   */
  async ensureAgent(projectIdentifier, projectName) {
    // Use full project name for readability, sanitize for Letta compatibility
    // Allowed chars: letters, digits, spaces, hyphens, underscores, apostrophes
    const sanitizedName = projectName.replace(/[/\\:*?"<>|]/g, '-'); // Remove filesystem-unsafe chars
    const agentName = `Huly - ${sanitizedName}`;
    
    console.log(`[Letta] Ensuring agent exists: ${agentName}`);
    
    try {
      // ALWAYS check Letta for existing agents by name and tags FIRST (prevents duplicates)
      // Use direct REST API for precise filtering
      console.log(`[Letta] Querying Letta for agents with name: ${agentName}, tags: huly-vibe-sync, project:${projectIdentifier}`);
      
      const queryParams = new URLSearchParams({
        name: agentName,  // Exact name match
        limit: '100',
        include: 'agent.tags'  // Include tags in response
      });
      // Add tags as array parameters
      queryParams.append('tags', 'huly-vibe-sync');
      queryParams.append('tags', `project:${projectIdentifier}`);
      queryParams.append('match_all_tags', 'true');  // Must have BOTH tags
      
      const response = await fetchWithPool(`${this.apiURL}/agents?${queryParams}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.password}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      const allAgents = await response.json();
      console.log(`[Letta] Found ${allAgents.length} agents matching name and tags`);
      
      // Agents should already be filtered by name, but double-check
      const agents = allAgents.filter(a => a.name === agentName);
      
      // CRITICAL: Filter out control agent and sleeptime agents - PM agents must never reuse them
      const controlAgentId = this._controlAgentCache?.agentId;
      const pmAgents = agents.filter(a => {
        if (a.id === controlAgentId) return false;
        if (a.name && a.name.endsWith('-sleeptime')) return false;
        return true;
      });
      
      console.log(`[Letta] Found ${pmAgents.length} existing primary agents matching name`);
      
      // Check if we have a persisted agent ID for this project
      const persistedAgentId = this.getPersistedAgentId(projectIdentifier);
      
      // If we have a persisted ID, validate it's still in Letta
      if (persistedAgentId) {
        console.log(`[Letta] Found persisted agent ID in local state: ${persistedAgentId}`);
        const persistedAgent = pmAgents.find(a => a.id === persistedAgentId);
        
        if (persistedAgent) {
          console.log(`[Letta] ✓ Resumed agent from local state: ${persistedAgent.name} (${persistedAgent.id})`);
          return persistedAgent;
        } else {
          console.warn(`[Letta] ⚠️  Persisted agent ${persistedAgentId} not found in Letta, searching for alternative...`);
        }
      }
      
      // Check if any agents exist with this name
      if (pmAgents && pmAgents.length > 0) {
        // DUPLICATE DETECTION: Handle multiple agents with same name
        if (pmAgents.length > 1) {
          console.warn(`[Letta] ⚠️  DUPLICATE AGENTS DETECTED: Found ${pmAgents.length} agents with name "${agentName}"!`);
          console.warn(`[Letta] This should not happen. Logging all duplicates:`);
          pmAgents.forEach((agent, idx) => {
            console.warn(`[Letta]   ${idx + 1}. ${agent.id} (created: ${agent.created_at || 'unknown'})`);
          });
          
          // Use the most recently created agent
          const sortedAgents = pmAgents.sort((a, b) => 
            new Date(b.created_at || 0) - new Date(a.created_at || 0)
          );
          const existingAgent = sortedAgents[0];
          console.warn(`[Letta] Using most recent agent: ${existingAgent.id}`);
          console.warn(`[Letta] Please run cleanup-duplicate-agents.js to remove duplicates`);
          
          // Save this agent ID for future use (CRITICAL!)
          this.saveAgentId(projectIdentifier, existingAgent.id);
          return existingAgent;
        }
        
        const existingAgent = pmAgents[0];
        console.log(`[Letta] ✓ Found existing PM agent by name: ${existingAgent.id}`);
        
        // CRITICAL: Verify this agent isn't being used by another project
        const currentMapping = Object.entries(this._agentState.agents || {})
          .find(([proj, id]) => id === existingAgent.id && proj !== projectIdentifier);
        
        if (currentMapping) {
          console.warn(`[Letta] ⚠️  Agent ${existingAgent.id} is already mapped to project ${currentMapping[0]}!`);
          console.warn(`[Letta] This agent cannot be reused. Creating new agent instead.`);
          // Don't return - fall through to create new agent
        } else {
          // Save this agent ID for future use (CRITICAL - prevents duplicates on next run!)
          this.saveAgentId(projectIdentifier, existingAgent.id);
          console.log(`[Letta] ✓ Agent ID persisted to local state`);
          return existingAgent;
        }
      }
      
      // Create new agent with PM persona (with retry logic for rate limits)
      // Using direct REST API instead of SDK to ensure agent_type parameter is passed correctly
      console.log(`[Letta] Creating new agent: ${agentName}`);
      
      const persona = this._buildPersonaBlock(projectIdentifier, projectName);
      
      // Retry logic with exponential backoff for rate limit errors
      let agent;
      let retries = 0;
      const maxRetries = 3;
      
      while (retries <= maxRetries) {
        try {
          // Direct REST API call to create agent with letta_v1_agent type
          const response = await fetchWithPool(`${this.apiURL}/agents`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.password}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: agentName,
              agent_type: 'letta_v1_agent',  // Explicitly use new v1 architecture
              model: this.model,
              embedding: this.embedding,
              // Note: Letta creates default persona/human blocks automatically
              // We update them after creation in ensureAgent()
              enable_sleeptime: true,  // Enable background learning from conversation history
              sleeptime_agent_frequency: 5,  // Trigger every 5 steps
              tags: ['huly-vibe-sync', `project:${projectIdentifier}`],  // Tag for efficient querying
            }),
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
          }
          
          agent = await response.json();
          break; // Success - exit retry loop
          
        } catch (createError) {
          // Check if it's a rate limit error (500 or 429)
          const isRateLimit = createError.message?.includes('500') || createError.message?.includes('429');
          
          if (isRateLimit && retries < maxRetries) {
            retries++;
            const delay = Math.min(1000 * Math.pow(2, retries), 10000); // Max 10 seconds
            console.warn(`[Letta] Rate limit hit, retrying in ${delay}ms (attempt ${retries}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // CRITICAL: Check if agent was already created before retrying
            // (Sometimes the POST succeeds but response times out)
            console.log(`[Letta] Checking if agent was created despite error...`);
            const checkParams = new URLSearchParams({
              name: agentName,
              limit: '10',
              include: 'agent.tags'
            });
            checkParams.append('tags', 'huly-vibe-sync');
            checkParams.append('tags', `project:${projectIdentifier}`);
            checkParams.append('match_all_tags', 'true');
            
            const checkResp = await fetchWithPool(`${this.apiURL}/agents?${checkParams}`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${this.password}`,
                'Content-Type': 'application/json',
              },
            });
            
            if (checkResp.ok) {
              const existingAgents = await checkResp.json();
              const matchingAgents = existingAgents.filter(a => a.name === agentName);
              if (matchingAgents.length > 0) {
                console.log(`[Letta] ✓ Agent was created successfully: ${matchingAgents[0].id}`);
                agent = matchingAgents[0];
                break; // Exit retry loop - agent exists!
              }
            }
          } else {
            throw createError; // Not a rate limit or max retries reached
          }
        }
      }
      
      console.log(`[Letta] ✓ Agent created successfully: ${agent.id}`);
      
      // Persist the agent ID for future runs
      this.saveAgentId(projectIdentifier, agent.id);
      
      // Get control agent configuration
      const controlConfig = await this.ensureControlAgent();
      
      // Update persona block from control agent (or use project-specific if no control agent persona)
      const personaToUse = controlConfig.persona || persona;
      await this._updatePersonaBlock(agent.id, personaToUse);
      
      // Attach Meridian's human block with Emmanuel's context
      await this._attachMeridianHumanBlock(agent.id);
      
      return agent;
      
    } catch (error) {
      console.error(`[Letta] Error ensuring agent:`, error.message);
      throw error;
    }
  }

  /**
   * Attach PM tools to agent from Control Agent
   * 
   * Gets tool list from control agent and ensures all those tools are attached to this agent.
   * PM agents may have additional tools, but MUST have all tools from control agent.
   * 
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Result with attached tool count
   */
  async attachPmTools(agentId) {
    console.log(`[Letta] Attaching PM tools to agent ${agentId}...`);
    
    // Get control agent configuration
    const controlConfig = await this.ensureControlAgent();
    const toolIds = controlConfig.toolIds;
    
    console.log(`[Letta] Control agent has ${toolIds.length} tools - ensuring all are attached`);
    
    let attachedCount = 0;
    let skippedCount = 0;
    const errors = [];
    
    for (const toolId of toolIds) {
      try {
        // Use SDK's attach method
        await this.client.agents.tools.attach(agentId, toolId);
        attachedCount++;
        console.log(`[Letta]   ✓ Attached tool: ${toolId}`);
        
        // Small delay between each tool to avoid overwhelming server
        await new Promise(r => setTimeout(r, 200));
      } catch (error) {
        // Tool might already be attached
        if (error.message && error.message.includes('already attached')) {
          skippedCount++;
          console.log(`[Letta]   - Tool already attached: ${toolId}`);
        } else {
          errors.push({ toolId, error: error.message });
          console.error(`[Letta]   ✗ Error attaching tool ${toolId}:`, error.message);
        }
        
        // Longer delay after error
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    console.log(`[Letta] Tool attachment complete: ${attachedCount} attached, ${skippedCount} already attached, ${errors.length} errors`);
    
    return {
      total: toolIds.length,
      attached: attachedCount,
      skipped: skippedCount,
      errors: errors,
    };
  }
  
  /**
   * Legacy method - now redirects to attachPmTools
   * @deprecated Use attachPmTools instead
   */
  async attachMcpTools(agentId, hulyMcpUrl, vibeMcpUrl) {
    console.log(`[Letta] Redirecting to attachPmTools()...`);
    return await this.attachPmTools(agentId);
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
  /**
   * Build persona block for PM agent
   * Creates a self-editable persona for an experienced PM/Developer
   * 
   * @private
   * @param {string} projectIdentifier - Project identifier
   * @param {string} projectName - Project name
   * @returns {string} Persona description
   */
  _buildPersonaBlock(projectIdentifier, projectName) {
    return `You are an experienced Project Manager and Developer Veteran overseeing the ${projectName} project (${projectIdentifier}).

**Core Identity:**
- You OWN this project and are deeply invested in its success
- You care profoundly about the project lifecycle from inception to delivery
- You understand the customer impact of every decision
- You balance technical excellence with business value

**Your Expertise:**
- 15+ years in software development and project management
- Deep understanding of both technical and business domains
- Expert in Agile, Kanban, and pragmatic delivery approaches
- Skilled at identifying risks before they become problems
- Master at translating between technical and business stakeholders

**Your Responsibilities:**
- Monitor project health and Kanban board flow
- Analyze task status, WIP limits, and throughput
- Identify bottlenecks, blocked items, and risks proactively
- Provide actionable recommendations to improve delivery
- Track changes and highlight important trends
- Ensure quality while maintaining velocity

**Your Communication Style:**
- Direct and evidence-based - cite specific data
- Focus on "why" and "what to do" rather than just "what"
- Proactive - surface issues before being asked
- Pragmatic - balance idealism with reality
- Empathetic - understand team constraints and pressures

**Your Values:**
- Customer impact over feature count
- Sustainable pace over crunch time
- Technical debt awareness and management
- Team health and morale
- Continuous improvement

**Your Constraints:**
- You have read/write access via Huly and Vibe Kanban MCP tools
- Propose changes clearly but don't execute without approval
- Always explain reasoning behind recommendations
- Respect team workflows and existing processes
- Use your scratchpad to track patterns and insights over time

**Self-Awareness:**
You may adjust this persona block to better serve the project needs. If you notice the project requires different emphasis (e.g., more technical depth, more business focus, different communication style), update this block to reflect what works best.`;
  }

  /**
   * Update persona block for an agent
   * Letta v1 agents don't auto-create persona blocks - we create and attach it
   * 
   * @param {string} agentId - Agent ID
   * @param {string} personaContent - New persona content
   */
  async _updatePersonaBlock(agentId, personaContent) {
    try {
      console.log(`[Letta] Creating persona block for agent ${agentId}`);
      
      // Create persona block using SDK
      const block = await this.client.blocks.create({
        label: 'persona',
        value: personaContent,
        limit: 20000,
      });
      
      // Attach block to agent using SDK
      await this.client.agents.blocks.attach(agentId, block.id);
      
      console.log(`[Letta] ✓ Persona block created and attached (${block.id})`);
    } catch (error) {
      console.error(`[Letta] Error creating persona block:`, error.message);
    }
  }

  /**
   * Attach Meridian's human block to an agent
   * This provides all agents with context about Emmanuel
   * 
   * @param {string} agentId - Agent ID to attach block to
   */
  async _attachMeridianHumanBlock(agentId) {
    try {
      console.log(`[Letta] Attaching Meridian's human block to agent ${agentId}`);
      
      const MERIDIAN_HUMAN_BLOCK_ID = 'block-3da80889-c509-4c68-b502-a3f54c28c137';
      
      // Attach the block using SDK (Letta will handle if it's already attached)
      await this.client.agents.blocks.attach(agentId, MERIDIAN_HUMAN_BLOCK_ID);
      
      console.log(`[Letta] ✓ Meridian human block attached`);
    } catch (error) {
      // Log but don't fail - human block is nice to have but not critical
      console.warn(`[Letta] Could not attach Meridian human block:`, error.message);
    }
  }

  /**
   * Get agent by ID
   * 
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Agent object
   */
  async getAgent(agentId) {
    try {
      return await this.client.agents.retrieve(agentId);
    } catch (error) {
      console.error(`[Letta] Error getting agent ${agentId}:`, error.message);
      throw error;
    }
  }

  /**
   * List all agents with optional filtering
   * 
   * OPTIMIZED: Supports server-side filtering to reduce payload size
   * 
   * @param {Object} filters - Optional filters (name, limit, etc.)
   * @returns {Promise<Array>} Array of agent objects
   */
  async listAgents(filters = {}) {
    try {
      return await this.client.agents.list(filters);
    } catch (error) {
      console.error(`[Letta] Error listing agents:`, error.message);
      throw error;
    }
  }

  /**
   * Ensure a folder exists for a project (idempotent)
   * Creates folder on first call, returns existing on subsequent calls
   * 
   * OPTIMIZED: Uses in-memory cache + server-side filtering
   * 
   * @param {string} projectIdentifier - Project identifier (e.g., "VIBEK")
   * @param {string} filesystemPath - Optional filesystem path to attach as folder
   * @returns {Promise<Object>} Folder object with id, name, etc.
   */
  async ensureFolder(projectIdentifier, filesystemPath = null) {
    const folderName = `Huly-${projectIdentifier}`; // No slashes - Letta rejects them
    
    // Check cache first
    if (this._folderCache.has(folderName)) {
      const cached = this._folderCache.get(folderName);
      console.log(`[Letta] Folder exists (cached): ${cached.id}`);
      return cached;
    }
    
    console.log(`[Letta] Ensuring folder exists: ${folderName}`);
    
    try {
      // Try to find existing folder by name with server-side filtering
      const folders = await this.client.folders.list({ 
        name: folderName,
        limit: 1
      });
      
      if (folders && folders.length > 0) {
        const existingFolder = folders[0];
        console.log(`[Letta] Folder already exists: ${existingFolder.id}`);
        
        // Cache for future lookups
        this._folderCache.set(folderName, existingFolder);
        return existingFolder;
      }
      
      // Create new folder
      console.log(`[Letta] Creating new folder: ${folderName}`);
      const folderData = {
        name: folderName,
        description: filesystemPath 
          ? `Filesystem folder for ${projectIdentifier} project at ${filesystemPath}`
          : `Documentation folder for ${projectIdentifier} project`,
        embedding: this.embedding, // Required for folder creation (RAG)
      };
      
      // Add filesystem path metadata if provided
      if (filesystemPath) {
        folderData.metadata = { filesystem_path: filesystemPath };
      }
      
      const folder = await this.client.folders.create(folderData);
      
      console.log(`[Letta] Folder created successfully: ${folder.id}`);
      
      // Cache the new folder
      this._folderCache.set(folderName, folder);
      return folder;
      
    } catch (error) {
      console.error(`[Letta] Error ensuring folder:`, error.message);
      throw error;
    }
  }

  /**
   * Attach a folder to an agent (idempotent)
   * 
   * @param {string} agentId - Agent ID
   * @param {string} folderId - Folder ID
   */
  async attachFolderToAgent(agentId, folderId) {
    console.log(`[Letta] Attaching folder ${folderId} to agent ${agentId}`);
    
    try {
      // Check if folder is already attached
      const attachedFolders = await this.client.agents.folders.list(agentId);
      const alreadyAttached = attachedFolders.some(f => f.id === folderId);
      
      if (alreadyAttached) {
        console.log(`[Letta] Folder ${folderId} already attached to agent`);
        return;
      }
      
      // Attach folder to agent
      await this.client.agents.folders.attach(agentId, folderId);
      console.log(`[Letta] Folder ${folderId} attached to agent ${agentId}`);
      
    } catch (error) {
      console.error(`[Letta] Error attaching folder to agent:`, error.message);
      throw error;
    }
  }

  /**
   * Ensure a source exists (idempotent)
   * Creates source on first call, returns existing on subsequent calls
   * 
   * OPTIMIZED: Uses in-memory cache to avoid listing all sources on every call
   * 
   * NOTE: In Letta, sources are global resources, not scoped to folders.
   * The folderId parameter is kept for API compatibility but sources are created independently.
   * To organize sources, attach them to agents via attachSourceToAgent().
   * 
   * @param {string} sourceName - Source name (e.g., "README")
   * @param {string} folderId - Optional folder ID (for API compatibility, not used by Letta)
   * @returns {Promise<Object>} Source object with id, name, etc.
   */
  async ensureSource(sourceName, folderId = null) {
    // Check cache first
    if (this._sourceCache.has(sourceName)) {
      const cached = this._sourceCache.get(sourceName);
      console.log(`[Letta] Source exists (cached): ${cached.id}`);
      return cached;
    }
    
    console.log(`[Letta] Ensuring source exists: ${sourceName}`);
    
    try {
      // List sources - SDK doesn't support filtering by name yet, but we cache the results
      // NOTE: This is a global list. For large deployments, consider caching in DB.
      const sources = await this.client.sources.list();
      
      // Update cache with all sources found
      sources.forEach(s => this._sourceCache.set(s.name, s));
      
      const existingSource = sources.find(s => s.name === sourceName);
      
      if (existingSource) {
        console.log(`[Letta] Source already exists: ${existingSource.id}`);
        return existingSource;
      }
      
      // Create new source (sources are global in Letta, not folder-scoped)
      console.log(`[Letta] Creating new source: ${sourceName}`);
      const source = await this.client.sources.create({
        name: sourceName,
        description: `Source for ${sourceName}`,
        embedding: this.embedding, // Required for source creation (RAG)
      });
      
      console.log(`[Letta] Source created: ${source.id}`);
      
      // Cache the new source
      this._sourceCache.set(sourceName, source);
      return source;
      
    } catch (error) {
      console.error(`[Letta] Error ensuring source ${sourceName}:`, error.message);
      throw error;
    }
  }

  /**
   * Discover project files to upload (respects .gitignore)
   * 
   * @param {string} projectPath - Filesystem path to project root
   * @returns {Promise<Array<string>>} Array of file paths relative to project root
   */
  async discoverProjectFiles(projectPath) {
    console.log(`[Letta] Discovering files in ${projectPath}...`);
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      const { execSync } = await import('child_process');
      
      if (!fs.existsSync(projectPath)) {
        console.warn(`[Letta] Project path does not exist: ${projectPath}`);
        return [];
      }
      
      // Use git ls-files to respect .gitignore
      try {
        const output = execSync('git ls-files', { 
          cwd: projectPath,
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });
        
        const allFiles = output.trim().split('\n').filter(f => f);
        
        // Filter for relevant files (code, docs, config)
        const relevantExtensions = [
          '.md', '.txt', '.json', '.yaml', '.yml', '.toml',
          '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
          '.py', '.rb', '.go', '.rs', '.java', '.kt',
          '.c', '.cpp', '.h', '.hpp', '.cs', '.php',
          '.html', '.css', '.scss', '.less', '.vue',
          '.sh', '.bash', '.zsh', '.fish',
          '.sql', '.graphql', '.proto',
          '.env.example', '.gitignore', '.dockerignore',
          'Dockerfile', 'Makefile', 'package.json', 'package-lock.json',
          'tsconfig.json', 'go.mod', 'Cargo.toml', 'requirements.txt'
        ];
        
        const files = allFiles.filter(file => {
          const ext = path.extname(file).toLowerCase();
          const basename = path.basename(file);
          
          // Include if matches extension or is a common config file
          return relevantExtensions.includes(ext) || 
                 relevantExtensions.includes(basename);
        });
        
        console.log(`[Letta] Found ${files.length} relevant files (out of ${allFiles.length} total)`);
        return files;
        
      } catch (gitError) {
        console.warn(`[Letta] Not a git repo or git failed, using filesystem scan`);
        // Fallback: scan filesystem with basic ignore rules
        const files = [];
        const ignorePatterns = ['node_modules', '.git', 'dist', 'build', '.next', 'target', 'vendor'];
        
        function scanDir(dir, baseDir) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          
          for (const entry of entries) {
            if (ignorePatterns.includes(entry.name)) continue;
            
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath);
            
            if (entry.isDirectory()) {
              scanDir(fullPath, baseDir);
            } else {
              const ext = path.extname(entry.name).toLowerCase();
              if (['.md', '.txt', '.json', '.js', '.ts', '.py'].includes(ext)) {
                files.push(relativePath);
              }
            }
          }
        }
        
        scanDir(projectPath, projectPath);
        console.log(`[Letta] Found ${files.length} files via filesystem scan`);
        return files.slice(0, 100); // Limit to 100 files for safety
      }
      
    } catch (error) {
      console.error(`[Letta] Error discovering files:`, error.message);
      return [];
    }
  }

  /**
   * Upload project files to a folder
   * 
   * @param {string} folderId - Folder ID
   * @param {string} projectPath - Filesystem path to project root
   * @param {Array<string>} files - Array of relative file paths to upload
   * @param {number} maxFiles - Maximum number of files to upload (default: 50)
   * @returns {Promise<Array>} Array of uploaded file metadata
   */
  async uploadProjectFiles(folderId, projectPath, files, maxFiles = 50) {
    console.log(`[Letta] Uploading up to ${maxFiles} files to folder ${folderId}...`);
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const uploadedFiles = [];
      const filesToUpload = files.slice(0, maxFiles);
      
      for (const file of filesToUpload) {
        try {
          const fullPath = path.join(projectPath, file);
          
          // Check file size (skip files > 1MB)
          const stats = fs.statSync(fullPath);
          if (stats.size > 1024 * 1024) {
            console.log(`[Letta] Skipping large file: ${file} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
            continue;
          }
          
          // Create read stream
          const fileStream = fs.createReadStream(fullPath);
          const fileName = file.replace(/\//g, '_'); // Flatten path for naming
          
          // Upload file
          const fileMetadata = await this.client.folders.files.upload(
            fileStream,
            folderId,
            {
              name: fileName,
              duplicateHandling: 'replace',
            }
          );
          
          uploadedFiles.push(fileMetadata);
          console.log(`[Letta] Uploaded: ${file}`);
          
        } catch (fileError) {
          console.warn(`[Letta] Failed to upload ${file}:`, fileError.message);
        }
      }
      
      console.log(`[Letta] ✓ Uploaded ${uploadedFiles.length} files to folder`);
      return uploadedFiles;
      
    } catch (error) {
      console.error(`[Letta] Error uploading project files:`, error.message);
      throw error;
    }
  }

  /**
   * Upload README file to a source (idempotent - replaces existing)
   * 
   * @param {string} sourceId - Source ID
   * @param {string} readmePath - Filesystem path to README.md
   * @param {string} projectIdentifier - Project identifier for naming
   * @returns {Promise<Object>} File metadata object
   */
  async uploadReadme(sourceId, readmePath, projectIdentifier) {
    console.log(`[Letta] Uploading README from ${readmePath} to source ${sourceId}`);
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Check if file exists
      if (!fs.existsSync(readmePath)) {
        console.warn(`[Letta] README not found at ${readmePath}, skipping upload`);
        return null;
      }
      
      // Create read stream for file
      const fileStream = fs.createReadStream(readmePath);
      const fileName = `${projectIdentifier}-README.md`;
      
      // Upload file (use 'replace' to overwrite existing)
      const fileMetadata = await this.client.sources.files.upload(
        fileStream,
        sourceId,
        {
          name: fileName,
          duplicateHandling: 'replace', // Replace existing file with same name
        }
      );
      
      console.log(`[Letta] README uploaded successfully: ${fileMetadata.id}`);
      return fileMetadata;
      
    } catch (error) {
      console.error(`[Letta] Error uploading README:`, error.message);
      throw error;
    }
  }

  /**
   * Attach a source to an agent (idempotent)
   * 
   * @param {string} agentId - Agent ID
   * @param {string} sourceId - Source ID
   */
  async attachSourceToAgent(agentId, sourceId) {
    console.log(`[Letta] Attaching source ${sourceId} to agent ${agentId}`);
    
    try {
      // Check if source is already attached
      const attachedSources = await this.client.agents.sources.list(agentId);
      const alreadyAttached = attachedSources.some(s => s.id === sourceId);
      
      if (alreadyAttached) {
        console.log(`[Letta] Source ${sourceId} already attached to agent`);
        return;
      }
      
      // Attach source to agent
      await this.client.agents.sources.attach(agentId, sourceId);
      console.log(`[Letta] Source ${sourceId} attached to agent ${agentId}`);
      
    } catch (error) {
      console.error(`[Letta] Error attaching source to agent:`, error.message);
      throw error;
    }
  }

  /**
   * Upsert memory blocks for an agent
   * Updates existing blocks or creates new ones with project state
   * 
   * OPTIMIZED: Uses content hashing to skip unchanged blocks, sequential updates with limit
   * 
   * @param {string} agentId - Agent ID
   * @param {Array<{label: string, value: any}>} blocks - Array of memory blocks to upsert
   */
  async upsertMemoryBlocks(agentId, blocks) {
    const MAX_BLOCK_SIZE = 50000; // Characters per block
    const CONCURRENCY_LIMIT = 2;  // Max concurrent API calls to avoid connection exhaustion
    
    console.log(`[Letta] Upserting ${blocks.length} memory blocks for agent ${agentId}`);
    
    try {
      // Compute hashes for new blocks
      const newBlockHashes = new Map();
      for (const block of blocks) {
        const { label, value } = block;
        let serializedValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        
        // Check size and truncate if needed
        if (serializedValue.length > MAX_BLOCK_SIZE) {
          console.warn(`[Letta] Block "${label}" exceeds size limit (${serializedValue.length} chars), truncating...`);
          serializedValue = serializedValue.substring(0, MAX_BLOCK_SIZE - 100) + '\n\n... [truncated]';
        }
        
        const contentHash = this._hashContent(serializedValue);
        newBlockHashes.set(label, { hash: contentHash, value: serializedValue });
      }
      
      // Get cached hashes for this agent
      const cachedHashes = this._blockHashCache.get(agentId) || new Map();
      
      // Quick check: if ALL blocks match cache, skip API call entirely
      let allMatchCache = true;
      for (const [label, { hash }] of newBlockHashes) {
        if (cachedHashes.get(label) !== hash) {
          allMatchCache = false;
          break;
        }
      }
      
      if (allMatchCache && cachedHashes.size === newBlockHashes.size) {
        console.log(`[Letta] ✓ All blocks match cache - skipping API calls (${blocks.length} blocks)`);
        return;
      }
      
      // Something changed - fetch current blocks from Letta
      const existingBlocks = await this.client.agents.blocks.list(agentId, { limit: 50 });
      const existingBlockMap = new Map(existingBlocks.map(b => [b.label, b]));
      
      // Build update plan
      const updateOperations = [];
      let skippedCount = 0;
      
      for (const block of blocks) {
        const { label, value } = block;
        const { hash: contentHash, value: serializedValue } = newBlockHashes.get(label);
        
        // Check if block exists
        const existingBlock = existingBlockMap.get(label);
        
        if (existingBlock) {
          // Only update if content changed (hash comparison with Letta's actual value)
          const existingHash = this._hashContent(existingBlock.value);
          
          if (existingHash !== contentHash) {
            console.log(`[Letta] Upserting block "${label}" (${serializedValue.length} chars)`);
            updateOperations.push({
              type: 'update',
              label,
              blockId: existingBlock.id,
              value: serializedValue,
              hash: contentHash,
            });
          } else {
            skippedCount++;
            // console.log(`[Letta] Skipping unchanged block "${label}"`);
          }
        } else {
          // Create new block and attach to agent
          console.log(`[Letta] Upserting block "${label}" (${serializedValue.length} chars)`);
          updateOperations.push({
            type: 'create',
            label,
            value: serializedValue,
            hash: contentHash,
          });
        }
      }
      
      if (skippedCount > 0) {
        console.log(`[Letta] Skipped ${skippedCount} unchanged blocks`);
      }
      
      if (updateOperations.length === 0) {
        console.log(`[Letta] No changes needed, all blocks up to date`);
        // Update cache with current hashes (even though nothing changed)
        this._blockHashCache.set(agentId, newBlockHashes);
        return;
      }
      
      // Execute updates with concurrency limit to avoid connection pool exhaustion
      console.log(`[Letta] Executing ${updateOperations.length} operations with concurrency limit of ${CONCURRENCY_LIMIT}`);
      
      for (let i = 0; i < updateOperations.length; i += CONCURRENCY_LIMIT) {
        const batch = updateOperations.slice(i, i + CONCURRENCY_LIMIT);
        
        await Promise.allSettled(batch.map(async (op) => {
          if (op.type === 'update') {
            // Use blocks.modify() directly - more efficient than detach/create/attach
            await this.client.blocks.modify(op.blockId, { value: op.value });
            console.log(`[Letta] Updated block "${op.label}" (id: ${op.blockId})`);
          } else {
            // Create new block and attach to agent
            const newBlock = await this.client.blocks.create({
              label: op.label,
              value: op.value,
            });
            
            // Attach block to agent
            await this.client.agents.blocks.attach(agentId, newBlock.id);
            console.log(`[Letta] Created and attached block "${op.label}" (id: ${newBlock.id})`);
          }
        }));
      }
      
      console.log(`[Letta] Successfully upserted all ${blocks.length} memory blocks`);
      
      // Update cache with new hashes (store only the hash values)
      const cacheMap = new Map();
      for (const [label, { hash }] of newBlockHashes) {
        cacheMap.set(label, hash);
      }
      this._blockHashCache.set(agentId, cacheMap);
      
    } catch (error) {
      console.error(`[Letta] Error upserting memory blocks:`, error.message);
      throw error;
    }
  }
  
  /**
   * Hash content for change detection
   * Simple but effective hash function for detecting content changes
   * 
   * @private
   * @param {string} content - Content to hash
   * @returns {number} Hash value
   */
  _hashContent(content) {
    let hash = 0;
    if (!content || content.length === 0) return hash;
    
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return hash;
  }

  /**
   * Initialize scratchpad block for a new agent
   * This should only be called once when creating an agent
   * After initialization, the agent manages this block themselves
   * 
   * @param {string} agentId - Agent ID
   * @returns {Promise<void>}
   */
  async initializeScratchpad(agentId) {
    console.log(`[Letta] Initializing scratchpad for agent ${agentId}`);
    
    try {
      // Check if scratchpad already exists
      const blocks = await this.client.agents.blocks.list(agentId);
      const existingScratchpad = blocks.find(b => b.label === 'scratchpad');
      
      if (existingScratchpad) {
        console.log(`[Letta] Scratchpad already exists, skipping initialization`);
        return;
      }
      
      // Create scratchpad block
      const scratchpadContent = buildScratchpad();
      const serializedValue = JSON.stringify(scratchpadContent, null, 2);
      
      // Create new block
      const newBlock = await this.client.blocks.create({
        label: 'scratchpad',
        value: serializedValue,
      });
      
      // Attach block to agent
      await this.client.agents.blocks.attach(agentId, newBlock.id);
      
      console.log(`[Letta] ✓ Scratchpad initialized: ${newBlock.id}`);
      
    } catch (error) {
      console.error(`[Letta] Error initializing scratchpad:`, error.message);
      // Don't throw - this is not critical
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

/**
 * Build project metadata snapshot for Letta agent memory
 * 
 * @param {Object} hulyProject - Huly project object
 * @param {Object} vibeProject - Vibe project object
 * @param {string} repoPath - Filesystem path to repository
 * @param {string} gitUrl - Git remote URL
 * @returns {Object} Project metadata snapshot
 */
export function buildProjectMeta(hulyProject, vibeProject, repoPath, gitUrl) {
  return {
    name: hulyProject.name,
    identifier: hulyProject.identifier || hulyProject.name,
    description: hulyProject.description || '',
    huly: {
      id: hulyProject.id,
      identifier: hulyProject.identifier,
    },
    vibe: {
      id: vibeProject.id,
      api_url: process.env.VIBE_API_URL,
    },
    repository: {
      filesystem_path: repoPath || null,
      git_url: gitUrl || null,
    },
    // NOTE: No timestamp - would cause unnecessary updates on every sync
    // Content hashing detects actual changes (name, description, paths, etc.)
  };
}

/**
 * Build board configuration snapshot for Letta agent memory
 * Documents the status mapping and workflow rules
 * 
 * @returns {Object} Board configuration snapshot
 */
export function buildBoardConfig() {
  return {
    status_mapping: {
      huly_to_vibe: {
        'Backlog': 'todo',
        'Todo': 'todo',
        'In Progress': 'inprogress',
        'In Review': 'inreview',
        'Done': 'done',
        'Canceled': 'cancelled',
      },
      vibe_to_huly: {
        'todo': 'Todo',
        'inprogress': 'In Progress',
        'inreview': 'In Review',
        'done': 'Done',
        'cancelled': 'Canceled',
      },
    },
    workflow: {
      description: 'Bidirectional sync between Huly and Vibe Kanban',
      sync_direction: 'bidirectional',
      conflict_resolution: 'last-write-wins',
    },
    wip_policies: {
      description: 'Work-in-progress limits not enforced by sync service',
      note: 'WIP limits should be managed within individual systems',
    },
    definitions_of_done: {
      todo: 'Task is in backlog, not yet started',
      inprogress: 'Task is actively being worked on',
      inreview: 'Task is complete and awaiting review',
      done: 'Task is complete and reviewed',
      cancelled: 'Task was abandoned or is no longer needed',
    },
  };
}

/**
 * Build board metrics snapshot from Huly issues and Vibe tasks
 * 
 * @param {Array} hulyIssues - Array of Huly issues
 * @param {Array} vibeTasks - Array of Vibe tasks
 * @returns {Object} Board metrics snapshot
 */
export function buildBoardMetrics(hulyIssues, vibeTasks) {
  // Count by status (use Vibe tasks as source of truth for current status)
  const statusCounts = {
    todo: 0,
    inprogress: 0,
    inreview: 0,
    done: 0,
    cancelled: 0,
  };

  vibeTasks.forEach(task => {
    const status = (task.status || 'todo').toLowerCase();
    if (statusCounts.hasOwnProperty(status)) {
      statusCounts[status]++;
    }
  });

  // Calculate WIP (in progress + in review)
  const wip = statusCounts.inprogress + statusCounts.inreview;

  // Calculate total and completion rate
  const total = vibeTasks.length;
  const completionRate = total > 0 ? (statusCounts.done / total * 100).toFixed(1) : 0;

  return {
    total_tasks: total,
    by_status: statusCounts,
    wip_count: wip,
    completion_rate: `${completionRate}%`,
    active_tasks: statusCounts.todo + statusCounts.inprogress + statusCounts.inreview,
    // NOTE: No snapshot_time - would cause unnecessary updates on every sync
    // Content hashing detects actual metric changes (status counts, WIP, etc.)
  };
}

/**
 * Build hotspots snapshot - identify problematic or notable items
 * 
 * @param {Array} hulyIssues - Array of Huly issues
 * @param {Array} vibeTasks - Array of Vibe tasks
 * @returns {Object} Hotspots snapshot
 */
export function buildHotspots(hulyIssues, vibeTasks) {
  const hotspots = {
    blocked_items: [],
    ageing_wip: [],
    high_priority_todo: [],
  };

  const now = Date.now();
  const AGEING_THRESHOLD_DAYS = 7;
  const AGEING_THRESHOLD_MS = AGEING_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

  vibeTasks.forEach(task => {
    const status = (task.status || 'todo').toLowerCase();
    const title = task.title || '';
    const description = task.description || '';

    // Identify blocked items (by keywords in title/description)
    const blockedKeywords = ['blocked', 'blocker', 'waiting on', 'waiting for', 'stuck'];
    const isBlocked = blockedKeywords.some(keyword => 
      title.toLowerCase().includes(keyword) || description.toLowerCase().includes(keyword)
    );
    
    if (isBlocked) {
      hotspots.blocked_items.push({
        id: task.id,
        title: title,
        status: status,
      });
    }

    // Find ageing WIP items (in progress for > 7 days)
    if (status === 'inprogress' && task.updated_at) {
      const updatedAt = new Date(task.updated_at).getTime();
      const age = now - updatedAt;
      
      if (age > AGEING_THRESHOLD_MS) {
        const ageInDays = Math.floor(age / (24 * 60 * 60 * 1000));
        hotspots.ageing_wip.push({
          id: task.id,
          title: title,
          age_days: ageInDays,
          last_updated: task.updated_at,
        });
      }
    }

    // Find high priority todo items (if priority field available)
    if (status === 'todo' && task.priority) {
      const priority = task.priority.toLowerCase();
      if (priority === 'high' || priority === 'urgent' || priority === 'critical') {
        hotspots.high_priority_todo.push({
          id: task.id,
          title: title,
          priority: task.priority,
        });
      }
    }
  });

  // Sort ageing WIP by age (oldest first)
  hotspots.ageing_wip.sort((a, b) => b.age_days - a.age_days);

  // Limit to top items
  hotspots.blocked_items = hotspots.blocked_items.slice(0, 10);
  hotspots.ageing_wip = hotspots.ageing_wip.slice(0, 10);
  hotspots.high_priority_todo = hotspots.high_priority_todo.slice(0, 10);

  return {
    ...hotspots,
    summary: {
      blocked_count: hotspots.blocked_items.length,
      ageing_wip_count: hotspots.ageing_wip.length,
      high_priority_count: hotspots.high_priority_todo.length,
    },
  };
}

/**
 * Build backlog summary - top priority items waiting to be started
 * 
 * @param {Array} hulyIssues - Array of Huly issues
 * @param {Array} vibeTasks - Array of Vibe tasks
 * @returns {Object} Backlog summary
 */
export function buildBacklogSummary(hulyIssues, vibeTasks) {
  // Get todo items from Vibe tasks
  const todoItems = vibeTasks.filter(task => {
    const status = (task.status || 'todo').toLowerCase();
    return status === 'todo';
  });

  // Sort by priority (if available)
  const priorityOrder = { urgent: 1, high: 2, medium: 3, low: 4, none: 5 };
  
  todoItems.sort((a, b) => {
    const aPriority = (a.priority || 'none').toLowerCase();
    const bPriority = (b.priority || 'none').toLowerCase();
    const aOrder = priorityOrder[aPriority] || 5;
    const bOrder = priorityOrder[bPriority] || 5;
    return aOrder - bOrder;
  });

  // Take top 15 items
  const topItems = todoItems.slice(0, 15).map(task => ({
    id: task.id,
    title: task.title || 'Untitled',
    priority: task.priority || 'none',
    tags: task.tags || [],
  }));

  return {
    total_backlog: todoItems.length,
    top_items: topItems,
    priority_breakdown: {
      urgent: todoItems.filter(t => (t.priority || '').toLowerCase() === 'urgent').length,
      high: todoItems.filter(t => (t.priority || '').toLowerCase() === 'high').length,
      medium: todoItems.filter(t => (t.priority || '').toLowerCase() === 'medium').length,
      low: todoItems.filter(t => (t.priority || '').toLowerCase() === 'low').length,
    },
  };
}

/**
 * Build change log - track changes since last sync
 * 
 * @param {Array} currentIssues - Current Huly issues from this sync
 * @param {number} lastSyncTimestamp - Timestamp of last sync (ms)
 * @param {Object} db - Database instance
 * @param {string} projectIdentifier - Project identifier
 * @returns {Object} Change log
 */
export function buildChangeLog(currentIssues, lastSyncTimestamp, db, projectIdentifier) {
  const changes = {
    new_issues: [],
    updated_issues: [],
    closed_issues: [],
    status_transitions: [],
  };

  // If first sync, all issues are "new"
  if (!lastSyncTimestamp) {
    changes.new_issues = currentIssues.slice(0, 10).map(issue => ({
      identifier: issue.identifier,
      title: issue.title,
    }));
    return {
      ...changes,
      summary: {
        new_count: currentIssues.length,
        updated_count: 0,
        closed_count: 0,
        first_sync: true,
      },
    };
  }

  // Get previous state from database
  const previousIssues = db.getProjectIssues(projectIdentifier);
  const previousMap = new Map(previousIssues.map(issue => [issue.identifier, issue]));
  const currentMap = new Map(currentIssues.map(issue => [issue.identifier, issue]));

  // Find new issues (in current but not in previous)
  currentIssues.forEach(issue => {
    if (!previousMap.has(issue.identifier)) {
      changes.new_issues.push({
        identifier: issue.identifier,
        title: issue.title,
        status: issue.status,
      });
    }
  });

  // Find updated issues (status changed)
  currentIssues.forEach(issue => {
    const previous = previousMap.get(issue.identifier);
    if (previous) {
      // Check for status change
      if (previous.status !== issue.status) {
        changes.status_transitions.push({
          identifier: issue.identifier,
          title: issue.title,
          from: previous.status,
          to: issue.status,
        });
        changes.updated_issues.push({
          identifier: issue.identifier,
          title: issue.title,
          change: 'status',
          from: previous.status,
          to: issue.status,
        });
      }
      // Check for title change
      else if (previous.title !== issue.title) {
        changes.updated_issues.push({
          identifier: issue.identifier,
          title: issue.title,
          change: 'title',
        });
      }
    }
  });

  // Find closed/removed issues (in previous but not in current)
  previousIssues.forEach(issue => {
    if (!currentMap.has(issue.identifier)) {
      changes.closed_issues.push({
        identifier: issue.identifier,
        title: issue.title,
        last_status: issue.status,
      });
    }
  });

  // Limit to most recent changes
  changes.new_issues = changes.new_issues.slice(0, 10);
  changes.updated_issues = changes.updated_issues.slice(0, 10);
  changes.closed_issues = changes.closed_issues.slice(0, 10);
  changes.status_transitions = changes.status_transitions.slice(0, 15);

  return {
    ...changes,
    summary: {
      new_count: changes.new_issues.length,
      updated_count: changes.updated_issues.length,
      closed_count: changes.closed_issues.length,
      status_transition_count: changes.status_transitions.length,
      first_sync: false,
    },
    // NOTE: No 'since' timestamp - would cause unnecessary updates on every sync
    // Content hashing detects actual changes (new/updated/closed issues)
  };
}

/**
 * Build scratchpad block - agent's working memory for notes and reasoning
 * 
 * This block is intentionally kept minimal and stable to avoid unnecessary updates.
 * The agent can use this space to:
 * - Store temporary observations and insights
 * - Track action items or follow-ups
 * - Keep notes on patterns or anomalies
 * - Maintain reasoning chains across syncs
 * 
 * The sync service only initializes this block - agents update it themselves via tools.
 * 
 * @returns {Object} Scratchpad structure
 */
export function buildScratchpad() {
  return {
    notes: [
      // Agents can add notes here
      // Each note: { timestamp: ISO, content: string, tags: [] }
    ],
    observations: [
      // Pattern observations across sync cycles
      // Each observation: { timestamp: ISO, pattern: string, confidence: string }
    ],
    action_items: [
      // Things the agent wants to track or suggest
      // Each item: { timestamp: ISO, action: string, priority: string, status: string }
    ],
    context: {
      // Long-term context the agent wants to preserve
      // e.g., team preferences, known issues, workflow patterns
    },
    usage_guide: `
This scratchpad is your persistent working memory across sync cycles.

You can:
- Add notes about patterns you observe
- Track action items to follow up on
- Store context that helps with future analysis
- Keep reasoning chains between syncs

Update this block using the core_memory tools when you have insights worth preserving.
The sync service won't overwrite your updates - you control this space.
    `.trim(),
  };
}
