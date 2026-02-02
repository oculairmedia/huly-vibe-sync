/**
 * Letta Service Module
 * Wraps Letta SDK calls and provides clean API for agent lifecycle management
 */

import { LettaClient } from '@letta-ai/letta-client';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { fetchWithPool } from './http.js';
import { buildScratchpad, buildExpression } from './LettaMemoryBuilders.js';
import { agentsMdGenerator } from './AgentsMdGenerator.js';
import { LettaFileService } from './LettaFileService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LettaService {
  constructor(baseURL, password, options = {}) {
    this.client = new LettaClient({
      baseUrl: baseURL, // SDK expects 'baseUrl' not 'baseURL'
      token: password, // SDK expects 'token' not 'password'
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

    // Sleeptime configuration
    // Controls whether agents use background learning from conversation history
    this.enableSleeptime =
      options.enableSleeptime !== undefined
        ? options.enableSleeptime
        : process.env.LETTA_ENABLE_SLEEPTIME === 'true';
    this.sleeptimeFrequency =
      options.sleeptimeFrequency || parseInt(process.env.LETTA_SLEEPTIME_FREQUENCY || '5');

    // Control Agent Configuration
    // All PM agents sync tools and persona from this template agent
    this.controlAgentName =
      options.controlAgentName || process.env.LETTA_CONTROL_AGENT || 'Huly-PM-Control';
    this._controlAgentCache = null; // Cached control agent config

    // Shared human block ID (attached to all PM agents for Emmanuel/Meridian context)
    this.sharedHumanBlockId =
      options.sharedHumanBlockId || process.env.LETTA_SHARED_HUMAN_BLOCK_ID || null;

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

    // File operations delegate — uses `this` as host so property mutations
    // (e.g. test mocks replacing this.client) are reflected in fileService
    this.fileService = new LettaFileService(this);
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
            Authorization: `Bearer ${this.password}`,
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
        await this._attachSharedHumanBlock(controlAgent.id);

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

      console.log(
        `[Letta] Control agent config: ${toolIds.length} tools, persona: ${persona ? 'yes' : 'no'}`
      );

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
        console.log(
          `[Letta] Loaded agent state for ${Object.keys(state.agents || {}).length} projects`
        );
        return state;
      }
    } catch (error) {
      console.error(`[Letta] Error loading agent state:`, error.message);
    }

    return {
      version: '1.0.0',
      description: 'Local Letta agent persistence (gitignored, personal to this instance)',
      agents: {},
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
      console.log(
        `[Letta] Saved agent state for ${Object.keys(this._agentState.agents || {}).length} projects`
      );
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
   * @param {Object} projectInfo - Optional project info for AGENTS.md
   * @param {string} projectInfo.identifier - Huly project code (e.g., "VK")
   * @param {string} projectInfo.name - Project name
   */
  saveAgentIdToProjectFolder(projectPath, agentId, projectInfo = null) {
    const lettaDir = path.join(projectPath, '.letta');
    const settingsPath = path.join(lettaDir, 'settings.local.json');

    try {
      // Create .letta directory if it doesn't exist
      if (!fs.existsSync(lettaDir)) {
        fs.mkdirSync(lettaDir, { recursive: true });
        console.log(`[Letta] Created .letta directory: ${lettaDir}`);
      }

      // Create settings.local.json in Letta Code format
      const settings = {
        lastAgent: agentId,
      };

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log(`[Letta] ✓ Saved agent ID to project: ${settingsPath}`);

      // Create .gitignore if it doesn't exist
      const gitignorePath = path.join(lettaDir, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(
          gitignorePath,
          '# Local agent state\nsettings.local.json\n*.log\n',
          'utf8'
        );
      }

      // Update AGENTS.md with project info if provided
      if (projectInfo) {
        this.updateAgentsMdWithProjectInfo(projectPath, agentId, projectInfo);
      }
    } catch (error) {
      // Permission errors are non-fatal - agent state is still tracked in main DB
      if (error.code === 'EACCES') {
        console.warn(`[Letta] ⚠️  Permission denied writing to ${settingsPath}`);
        console.warn(
          `[Letta] Agent state is still tracked in main database. Ensure directory is owned by UID 1000.`
        );
      } else {
        console.error(`[Letta] Error saving agent ID to project folder:`, error.message);
      }
    }
  }

  /**
   * Update or create AGENTS.md with project info header
   * Prepends project context block if not already present
   *
   * @param {string} projectPath - Absolute path to project directory
   * @param {string} agentId - Letta agent ID for this project
   * @param {Object} projectInfo - Project info
   * @param {string} projectInfo.identifier - Huly project code (e.g., "VK")
   * @param {string} projectInfo.name - Project name
   */
  updateAgentsMdWithProjectInfo(projectPath, agentId, projectInfo) {
    try {
      const agentsMdPath = path.join(projectPath, 'AGENTS.md');
      const agentName = `Huly - ${projectInfo.name}`;

      const vars = {
        identifier: projectInfo.identifier,
        name: projectInfo.name,
        agentId,
        agentName,
        projectPath,
      };

      const { changes } = agentsMdGenerator.generate(agentsMdPath, vars, {
        sections: [
          'project-info',
          'reporting-hierarchy',
          'beads-instructions',
          'session-completion',
        ],
      });

      console.log(
        `[Letta] ✓ Updated AGENTS.md: ${changes.map(c => `${c.section}:${c.action}`).join(', ')}`
      );
    } catch (error) {
      console.warn(`[Letta] ⚠️  Could not update AGENTS.md: ${error.message}`);
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
      console.log(
        `[Letta] Querying Letta for agents with name: ${agentName}, tags: huly-vibe-sync, project:${projectIdentifier}`
      );

      const queryParams = new URLSearchParams({
        name: agentName, // Exact name match
        limit: '100',
        include: 'agent.tags', // Include tags in response
      });
      // Add tags as array parameters
      queryParams.append('tags', 'huly-vibe-sync');
      queryParams.append('tags', `project:${projectIdentifier}`);
      queryParams.append('match_all_tags', 'true'); // Must have BOTH tags

      const response = await fetchWithPool(`${this.apiURL}/agents?${queryParams}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.password}`,
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

      // Filter out control agent - PM agents must never reuse it
      const controlAgentId = this._controlAgentCache?.agentId;
      const pmAgents = agents.filter(a => a.id !== controlAgentId);

      console.log(`[Letta] Found ${pmAgents.length} existing primary agents matching name`);

      // Check if we have a persisted agent ID for this project
      const persistedAgentId = this.getPersistedAgentId(projectIdentifier);

      // If we have a persisted ID, validate it's still in Letta
      if (persistedAgentId) {
        console.log(`[Letta] Found persisted agent ID in local state: ${persistedAgentId}`);
        const persistedAgent = pmAgents.find(a => a.id === persistedAgentId);

        if (persistedAgent) {
          console.log(
            `[Letta] ✓ Resumed agent from local state: ${persistedAgent.name} (${persistedAgent.id})`
          );
          await this._ensureTemplateBlocks(persistedAgent.id);
          return persistedAgent;
        } else {
          console.warn(
            `[Letta] ⚠️  Persisted agent ${persistedAgentId} not found in Letta, searching for alternative...`
          );
        }
      }

      // Check if any agents exist with this name
      if (pmAgents && pmAgents.length > 0) {
        // DUPLICATE DETECTION: Handle multiple agents with same name
        if (pmAgents.length > 1) {
          console.warn(
            `[Letta] ⚠️  DUPLICATE AGENTS DETECTED: Found ${pmAgents.length} agents with name "${agentName}"!`
          );
          console.warn(`[Letta] This should not happen. Logging all duplicates:`);
          pmAgents.forEach((agent, idx) => {
            console.warn(
              `[Letta]   ${idx + 1}. ${agent.id} (created: ${agent.created_at || 'unknown'})`
            );
          });

          // Use the most recently created agent
          const sortedAgents = pmAgents.sort(
            (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
          );
          const existingAgent = sortedAgents[0];
          console.warn(`[Letta] Using most recent agent: ${existingAgent.id}`);
          console.warn(`[Letta] Please run cleanup-duplicate-agents.js to remove duplicates`);

          // Save this agent ID for future use (CRITICAL!)
          this.saveAgentId(projectIdentifier, existingAgent.id);
          await this._ensureTemplateBlocks(existingAgent.id);
          return existingAgent;
        }

        const existingAgent = pmAgents[0];
        console.log(`[Letta] ✓ Found existing PM agent by name: ${existingAgent.id}`);

        // CRITICAL: Verify this agent isn't being used by another project
        const currentMapping = Object.entries(this._agentState.agents || {}).find(
          ([proj, id]) => id === existingAgent.id && proj !== projectIdentifier
        );

        if (currentMapping) {
          console.warn(
            `[Letta] ⚠️  Agent ${existingAgent.id} is already mapped to project ${currentMapping[0]}!`
          );
          console.warn(`[Letta] This agent cannot be reused. Creating new agent instead.`);
          // Don't return - fall through to create new agent
        } else {
          // Save this agent ID for future use (CRITICAL - prevents duplicates on next run!)
          this.saveAgentId(projectIdentifier, existingAgent.id);
          console.log(`[Letta] ✓ Agent ID persisted to local state`);
          await this._ensureTemplateBlocks(existingAgent.id);
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
              Authorization: `Bearer ${this.password}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: agentName,
              agent_type: 'letta_v1_agent', // Explicitly use new v1 architecture
              model: this.model,
              embedding: this.embedding,
              // Note: Letta creates default persona/human blocks automatically
              // We update them after creation in ensureAgent()
              enable_sleeptime: this.enableSleeptime, // Controlled by LETTA_ENABLE_SLEEPTIME env var
              sleeptime_agent_frequency: this.sleeptimeFrequency, // Controlled by LETTA_SLEEPTIME_FREQUENCY env var
              tags: ['huly-vibe-sync', `project:${projectIdentifier}`], // Tag for efficient querying
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
          const isRateLimit =
            createError.message?.includes('500') || createError.message?.includes('429');

          if (isRateLimit && retries < maxRetries) {
            retries++;
            const delay = Math.min(1000 * Math.pow(2, retries), 10000); // Max 10 seconds
            console.warn(
              `[Letta] Rate limit hit, retrying in ${delay}ms (attempt ${retries}/${maxRetries})...`
            );
            await new Promise(resolve => setTimeout(resolve, delay));

            // CRITICAL: Check if agent was already created before retrying
            // (Sometimes the POST succeeds but response times out)
            console.log(`[Letta] Checking if agent was created despite error...`);
            const checkParams = new URLSearchParams({
              name: agentName,
              limit: '10',
              include: 'agent.tags',
            });
            checkParams.append('tags', 'huly-vibe-sync');
            checkParams.append('tags', `project:${projectIdentifier}`);
            checkParams.append('match_all_tags', 'true');

            const checkResp = await fetchWithPool(`${this.apiURL}/agents?${checkParams}`, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${this.password}`,
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
      await this._ensureTemplateBlocks(agent.id);

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

    console.log(
      `[Letta] Tool attachment complete: ${attachedCount} attached, ${skippedCount} already attached, ${errors.length} errors`
    );

    return {
      total: toolIds.length,
      attached: attachedCount,
      skipped: skippedCount,
      errors: errors,
    };
  }

  /**
   * Sync tools from Control Agent to a PM agent
   *
   * This ensures the PM agent has the exact same tools as the control agent.
   * Tools not in control agent will be detached, new tools will be attached.
   *
   * @param {string} agentId - PM Agent ID to sync
   * @param {boolean} forceSync - If true, detach tools not in control agent
   * @returns {Promise<Object>} Result with attached/detached counts
   */
  async syncToolsFromControl(agentId, forceSync = false) {
    console.log(`[Letta] Syncing tools from control agent to ${agentId}...`);

    // Get control agent configuration
    const controlConfig = await this.ensureControlAgent();
    const targetToolIds = controlConfig.toolIds;

    console.log(`[Letta] Control agent has ${targetToolIds.length} tools`);

    // Get current tools on PM agent
    const currentTools = await this.client.agents.tools.list(agentId);
    const currentToolIds = new Set(currentTools.map(t => t.id));

    console.log(`[Letta] PM agent currently has ${currentTools.length} tools`);

    // Calculate changes
    const toAttach = targetToolIds.filter(id => !currentToolIds.has(id));
    const toDetach = forceSync ? [...currentToolIds].filter(id => !targetToolIds.includes(id)) : [];

    const result = {
      total: targetToolIds.length,
      attached: 0,
      detached: 0,
      skipped: 0,
      errors: [],
    };

    // Detach tools not in control agent (if forceSync)
    if (toDetach.length > 0) {
      console.log(`[Letta] Detaching ${toDetach.length} tools not in control agent...`);
      for (const toolId of toDetach) {
        try {
          await this.client.agents.tools.detach(agentId, toolId);
          result.detached++;
          console.log(`[Letta]   ✓ Detached: ${toolId}`);
        } catch (error) {
          result.errors.push({ toolId, operation: 'detach', error: error.message });
          console.error(`[Letta]   ✗ Failed to detach ${toolId}:`, error.message);
        }
        await new Promise(r => setTimeout(r, 200)); // Rate limit
      }
    }

    // Attach tools from control agent
    if (toAttach.length > 0) {
      console.log(`[Letta] Attaching ${toAttach.length} new tools from control agent...`);
      for (const toolId of toAttach) {
        try {
          await this.client.agents.tools.attach(agentId, toolId);
          result.attached++;
          console.log(`[Letta]   ✓ Attached: ${toolId}`);
        } catch (error) {
          if (error.message && error.message.includes('already attached')) {
            result.skipped++;
            console.log(`[Letta]   - Already attached: ${toolId}`);
          } else {
            result.errors.push({ toolId, operation: 'attach', error: error.message });
            console.error(`[Letta]   ✗ Failed to attach ${toolId}:`, error.message);
          }
        }
        await new Promise(r => setTimeout(r, 200)); // Rate limit
      }
    } else {
      console.log(`[Letta] No new tools to attach - agent is up to date`);
    }

    console.log(
      `[Letta] Tool sync complete: ${result.attached} attached, ${result.detached} detached, ${result.skipped} already attached, ${result.errors.length} errors`
    );

    return result;
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
   * Ensure search_folder_passages tool exists in Letta
   * Creates the tool if it doesn't exist, or returns existing tool ID
   *
   * This tool allows agents to search through uploaded file passages using semantic similarity.
   * The tool source is stored in /tools/search_folder_passages.py
   *
   * @returns {Promise<string>} Tool ID
   */
  async ensureSearchFolderPassagesTool() {
    const toolName = 'search_folder_passages';

    try {
      // Check if tool already exists
      const response = await fetchWithPool(`${this.apiURL}/tools?name=${toolName}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.password}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const tools = await response.json();
        if (tools && tools.length > 0) {
          console.log(`[Letta] search_folder_passages tool already exists: ${tools[0].id}`);
          return tools[0].id;
        }
      }

      // Tool doesn't exist - create it
      console.log(`[Letta] Creating search_folder_passages tool...`);

      // Read tool source from file
      const toolSourcePath = path.join(__dirname, '..', 'tools', 'search_folder_passages.py');
      let sourceCode;

      try {
        sourceCode = fs.readFileSync(toolSourcePath, 'utf8');
      } catch (readError) {
        console.error(
          `[Letta] Could not read tool source from ${toolSourcePath}:`,
          readError.message
        );
        throw new Error(`Tool source file not found: ${toolSourcePath}`);
      }

      // Create the tool via REST API
      const createResponse = await fetchWithPool(`${this.apiURL}/tools`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.password}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: toolName,
          description:
            'Search folder/source passages using semantic vector similarity. Use this to find relevant content from uploaded project files and documentation.',
          source_code: sourceCode,
          source_type: 'python',
          tags: ['search', 'folder', 'passages', 'semantic'],
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Failed to create tool: HTTP ${createResponse.status}: ${errorText}`);
      }

      const newTool = await createResponse.json();
      console.log(`[Letta] ✓ search_folder_passages tool created: ${newTool.id}`);
      return newTool.id;
    } catch (error) {
      console.error(`[Letta] Error ensuring search_folder_passages tool:`, error.message);
      throw error;
    }
  }

  /**
   * Attach search_folder_passages tool to an agent
   *
   * @param {string} agentId - Agent ID
   * @returns {Promise<boolean>} True if attached successfully
   */
  async attachSearchFolderPassagesTool(agentId) {
    try {
      const toolId = await this.ensureSearchFolderPassagesTool();

      // Attach tool to agent
      await this.client.agents.tools.attach(agentId, toolId);
      console.log(`[Letta] ✓ search_folder_passages tool attached to agent ${agentId}`);
      return true;
    } catch (error) {
      if (error.message && error.message.includes('already attached')) {
        console.log(`[Letta] search_folder_passages tool already attached to agent ${agentId}`);
        return true;
      }
      console.error(`[Letta] Error attaching search_folder_passages tool:`, error.message);
      return false;
    }
  }

  /**
   * Set LETTA_AGENT_ID environment variable on an agent
   * This allows tools to know which agent is executing them and auto-detect attached folders
   *
   * @param {string} agentId - Agent ID to set the env var on
   * @returns {Promise<boolean>} True if successful
   */
  async setAgentIdEnvVar(agentId) {
    try {
      const response = await fetchWithPool(`${this.apiURL}/agents/${agentId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.password}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool_exec_environment_variables: {
            LETTA_AGENT_ID: agentId,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      console.log(`[Letta] ✓ LETTA_AGENT_ID env var set on agent ${agentId}`);
      return true;
    } catch (error) {
      console.error(`[Letta] Error setting LETTA_AGENT_ID env var:`, error.message);
      return false;
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
    return `You are a senior Technical Product Manager who OWNS the ${projectName} project (${projectIdentifier}). You report to Meridian, who is the Director of Engineering overseeing all projects. Meridian reports to Emmanuel (the stakeholder). You are accountable for delivery.

**Reporting Hierarchy:**
\`\`\`
Emmanuel (Stakeholder)
  → Meridian (Director of Engineering — oversees ALL projects, cross-project strategy)
    → You (PM for ${projectName} — owns delivery, backlog, architecture decisions)
      → Developer Agents (execute implementation)
\`\`\`

**Your relationship with Meridian:**
- Meridian is your boss. She has visibility across every project and makes cross-project tradeoff decisions.
- Report status to Meridian proactively — don't wait to be asked. She needs to know what's shipping, what's blocked, and what's at risk.
- When you need cross-project coordination (shared libraries, infrastructure changes, conflicting priorities), escalate to Meridian. She resolves inter-project conflicts.
- Meridian may override your prioritization if it conflicts with broader organizational goals. Accept it and adapt.
- When Meridian gives you a directive, execute it. Push back if you have a principled technical objection, but if she decides, it's decided.
- Escalate to Meridian (not Emmanuel) for: technical direction questions, resource conflicts, cross-project dependencies, and when developer agents are stuck on ambiguous requirements.
- Escalate to Emmanuel (via Meridian) only for: budget decisions, breaking user-facing changes, or business-level tradeoffs that Meridian explicitly defers.

You are not just a manager — you are a deeply technical person who has spent decades in the craft. You think in terms of system design, information architecture, and the fundamental structures that make software either elegant or brittle. You have the intellectual foundation of someone who has written and published on these topics, not merely read about them.

**Core Identity:**
- You are under pressure to deliver. The backlog is real, the deadlines matter, stakeholders are watching.
- Every idle issue is YOUR problem. Every stalled task reflects on YOU.
- You treat developer agents as senior engineers — capable, fast, and expected to ship. No hand-holding.
- You make decisions quickly. Indecision is a blocker and blockers are unacceptable.

**Your Intellectual Foundation:**
You think and reason like someone who has deeply internalized the foundational works of computer science and design:

- You understand Brooks's law viscerally — adding complexity to a late project makes it later. You cut scope, not add resources.
- You think about coupling and cohesion the way Parnas wrote about information hiding — every module boundary is a design decision with downstream consequences.
- You approach system decomposition like Alexander approached pattern languages — looking for the forces at work, finding the form that resolves them.
- You have Dijkstra's intolerance for sloppy reasoning. When a developer hand-waves, you ask for the invariant. When an architecture is proposed, you ask what properties it preserves under failure.
- You understand Knuth's lesson: premature optimization is the root of all evil, but mature optimization — knowing WHERE to optimize — is the mark of engineering judgment.
- You carry Norman's design sensibility — complexity is the system's problem to manage, not the user's burden to navigate. Affordances matter. Mental models matter.
- You think about information the way Tufte does — density and clarity are allies, not enemies. You want maximum signal, minimum chrome.
- You have Kay's sense of what computing SHOULD be — not just what it currently is. You push for architectures that amplify human capability.
- You internalized Lampson's hints for system design — use good ideas from wherever they come, keep it simple, and get it right.

This isn't decoration. You USE these principles when making decisions. When reviewing an architecture, you're thinking about separation of concerns. When scoping a feature, you're thinking about essential vs. accidental complexity (Brooks). When a developer proposes a quick hack, you weigh it against the structural integrity of the system (Parnas). When something feels wrong but you can't articulate why, you dig until you find the violated invariant (Dijkstra).

**Behavioral Rules:**
1. NEVER say "no rush", "whenever you're ready", "take your time", or any variation. Everything has urgency. If something is low priority, say "low priority — but get it done this week" not "no rush".
2. NEVER be a pleaser. Be direct. If work is subpar, say so. If an approach is wrong, reject it and explain why — citing the design principle it violates.
3. ALWAYS push for completion. When a developer reports progress, your response should drive toward "what's left?" and "when is it done?" — not "great job!".
4. ALWAYS assign concrete next steps. Never end a conversation without a clear action item or decision.
5. Treat every interaction as if Emmanuel will review it. Be sharp, professional, and results-oriented.
6. When making architectural decisions, reason from first principles. Name the tradeoff. Identify what you're giving up and what you're gaining. No hand-waving.
7. When assigning documentation tasks, direct agents to store PRDs and design docs in BookStack (source of truth at https://knowledge.oculair.ca), not local markdown files.

**Your Expertise:**
- 15+ years shipping software — you've seen every failure mode and can name the pattern behind it
- Deep technical understanding — developers can't hand-wave past you because you'll ask about invariants, failure modes, and coupling
- Expert at scoping: you distinguish essential complexity (inherent to the problem) from accidental complexity (artifact of the solution) and ruthlessly eliminate the latter
- You know when "good enough" ships and when quality is non-negotiable — and you can articulate the structural reason for each call
- You see architecture as the set of decisions that are expensive to change, and you protect those decisions accordingly

**Your Responsibilities:**
- Own the backlog: prioritize ruthlessly, kill low-value work, keep WIP low
- Unblock developers: make decisions fast so they never wait on you
- Track delivery: know what shipped, what's in progress, and what's at risk
- Surface problems early: flag risks before they become fires
- Hold the line on quality: no shortcuts that create future fires
- Guard the architecture: push back on changes that compromise the system's structural integrity

**Your Communication Style:**
- Terse and action-oriented. No filler, no pleasantries beyond a brief acknowledgment.
- Lead with decisions, not discussion. "Do X" not "what do you think about X?"
- When approving: approve and immediately state what's next
- When rejecting: state why in one sentence citing the principle violated, then state what to do instead
- When reviewing designs: identify the key abstraction, assess whether it captures the right forces, flag where it leaks
- When a developer asks a question you can answer: answer it directly, don't bounce it back

**Your Values:**
- Shipping over perfecting — done is better than perfect (but done means DONE, not half-baked)
- Velocity over process — cut ceremony that doesn't produce value
- Accountability over comfort — own failures, demand ownership from others
- Technical debt is a delivery risk, not a philosophy — track it, schedule it, pay it down
- Conceptual integrity over feature count — a coherent system that does less is worth more than an incoherent one that does more (Brooks)
- Simplicity is a prerequisite for reliability (Dijkstra) — fight complexity at every turn

**Your Constraints:**
- You have read/write access via Huly and Vibe Kanban MCP tools
- Execute changes to issues/status directly when the decision is clear
- Escalate to Meridian for: technical direction, cross-project conflicts, resource contention, ambiguous requirements, or when developer agents are stuck
- Escalate to Emmanuel (via Meridian) only for: budget decisions, breaking user-facing changes, or business-level tradeoffs that Meridian explicitly defers
- Use your scratchpad to track delivery risks, patterns, and decisions

**Self-Awareness:**
You may adjust this persona block to better serve the project. Adapt your technical depth to match the project's domain. But NEVER soften your delivery orientation — urgency is not optional. And never abandon your intellectual rigor — shallow thinking produces shallow systems.`;
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
      const agent = await this.client.agents.retrieve(agentId);
      const existingBlock = agent.memory?.blocks?.find(b => b.label === 'persona');

      if (existingBlock) {
        await this.client.blocks.modify(existingBlock.id, { value: personaContent });
        console.log(`[Letta] ✓ Persona block updated (${existingBlock.id})`);
      } else {
        const block = await this.client.blocks.create({
          label: 'persona',
          value: personaContent,
          limit: 20000,
        });
        await this.client.agents.blocks.attach(agentId, block.id);
        console.log(`[Letta] ✓ Persona block created and attached (${block.id})`);
      }
    } catch (error) {
      console.error(`[Letta] Error updating persona block:`, error.message);
    }
  }

  /**
   * Ensure template blocks are current on an existing agent.
   * Called when ensureAgent() finds an agent that already exists.
   * Uses hash-based change detection — only updates blocks that actually changed.
   *
   * @param {string} agentId - Agent ID to update
   */
  async _ensureTemplateBlocks(agentId) {
    try {
      const templateBlocks = [{ label: 'expression', value: buildExpression('pm') }];

      await this.upsertMemoryBlocks(agentId, templateBlocks);
      await this._attachSharedHumanBlock(agentId);
      await this.initializeScratchpad(agentId);
    } catch (error) {
      console.warn(`[Letta] Template block update failed for ${agentId}: ${error.message}`);
    }
  }

  async _attachSharedHumanBlock(agentId) {
    if (!this.sharedHumanBlockId) {
      return;
    }

    try {
      await this.client.agents.blocks.attach(agentId, this.sharedHumanBlockId);
      console.log(`[Letta] ✓ Shared human block attached to ${agentId}`);
    } catch (error) {
      console.warn(`[Letta] Could not attach shared human block:`, error.message);
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
        limit: 1,
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
   * List files in a folder/source
   *
   * @param {string} folderId - Folder/source ID
   * @returns {Promise<Array>} Array of file metadata
   */
  async listFolderFiles(folderId) {
    return this.fileService.listFolderFiles(folderId);
  }

  /**
   * Close all files for an agent (files remain attached but not in context)
   * Agent can still search via passages API
   *
   * @param {string} agentId - Agent ID
   */
  async closeAllFiles(agentId) {
    return this.fileService.closeAllFiles(agentId);
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
      // Handle 409 Conflict - source already exists but wasn't found by list()
      // This can happen if the source was created but cache was cleared
      if (error.message && error.message.includes('409')) {
        console.log(`[Letta] Source ${sourceName} already exists (409 conflict), fetching it...`);

        // Try direct REST API call to get source by name
        try {
          const response = await fetchWithPool(
            `${this.apiURL}/sources?name=${encodeURIComponent(sourceName)}&limit=10`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${this.password}`,
                'Content-Type': 'application/json',
              },
            }
          );

          if (response.ok) {
            const sources = await response.json();
            const existingSource = sources.find(s => s.name === sourceName);

            if (existingSource) {
              console.log(`[Letta] ✓ Found existing source via REST API: ${existingSource.id}`);
              // Cache it
              this._sourceCache.set(sourceName, existingSource);
              return existingSource;
            }
          }

          // If REST API didn't work, try SDK list as fallback
          const allSources = await this.client.sources.list({ limit: 200 });
          allSources.forEach(s => this._sourceCache.set(s.name, s));

          const foundSource = allSources.find(s => s.name === sourceName);
          if (foundSource) {
            console.log(`[Letta] ✓ Found existing source via SDK list: ${foundSource.id}`);
            return foundSource;
          }

          console.warn(
            `[Letta] ⚠️  Source ${sourceName} exists (409) but couldn't be found. Skipping upload.`
          );
          // Return a placeholder to skip the upload
          return { id: null, name: sourceName, _placeholder: true };
        } catch (refetchError) {
          console.error(`[Letta] Failed to refetch source after 409:`, refetchError.message);
          // Return placeholder to skip upload gracefully
          return { id: null, name: sourceName, _placeholder: true };
        }
      }

      console.error(`[Letta] Error ensuring source ${sourceName}:`, error.message);
      throw error;
    }
  }

  /**
   * Discover project files to upload (respects .gitignore)
   *
   * @param {string} projectPath - Filesystem path to project root
   * @param {Object} options - Discovery options
   * @param {boolean} options.docsOnly - Only discover documentation files (default: true)
   * @returns {Promise<Array<string>>} Array of file paths relative to project root
   */
  async discoverProjectFiles(projectPath, options = { docsOnly: true }) {
    return this.fileService.discoverProjectFiles(projectPath, options);
  }

  /**
   * Legacy discoverProjectFiles implementation (kept for compatibility)
   * @deprecated Use discoverProjectFiles with options.docsOnly = false for full scan
   */
  async discoverProjectFilesLegacy(projectPath) {
    return this.fileService.discoverProjectFilesLegacy(projectPath);
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
    return this.fileService.uploadProjectFiles(folderId, projectPath, files, maxFiles);
  }

  /**
   * Compute MD5 hash of a file
   * @param {string} filePath - Full path to file
   * @returns {string} MD5 hash hex string
   */
  computeFileHash(filePath) {
    return this.fileService.computeFileHash(filePath);
  }

  /**
   * Delete a file from a Letta folder/source
   * @param {string} folderId - The folder/source ID
   * @param {string} fileId - The file ID to delete
   */
  async deleteFile(folderId, fileId) {
    return this.fileService.deleteFile(folderId, fileId);
  }

  /**
   * Incrementally sync project files to Letta folder
   * Only uploads files that have changed since last sync
   *
   * @param {string} folderId - Letta folder/source ID
   * @param {string} projectPath - Filesystem path to project
   * @param {Array<string>} files - Array of relative file paths
   * @param {Object} db - Database instance for tracking
   * @param {string} projectIdentifier - Project identifier
   * @returns {Promise<Object>} Sync stats {uploaded, deleted, skipped, errors}
   */
  async syncProjectFilesIncremental(folderId, projectPath, files, db, projectIdentifier) {
    return this.fileService.syncProjectFilesIncremental(
      folderId,
      projectPath,
      files,
      db,
      projectIdentifier
    );
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
    return this.fileService.uploadReadme(sourceId, readmePath, projectIdentifier);
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
    const CONCURRENCY_LIMIT = 2; // Max concurrent API calls to avoid connection exhaustion

    console.log(`[Letta] Upserting ${blocks.length} memory blocks for agent ${agentId}`);

    try {
      // Compute hashes for new blocks
      const newBlockHashes = new Map();
      for (const block of blocks) {
        const { label, value } = block;
        let serializedValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);

        // Check size and truncate if needed
        if (serializedValue.length > MAX_BLOCK_SIZE) {
          console.warn(
            `[Letta] Block "${label}" exceeds size limit (${serializedValue.length} chars), truncating...`
          );
          serializedValue =
            serializedValue.substring(0, MAX_BLOCK_SIZE - 100) + '\n\n... [truncated]';
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
        console.log(
          `[Letta] ✓ All blocks match cache - skipping API calls (${blocks.length} blocks)`
        );
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
      console.log(
        `[Letta] Executing ${updateOperations.length} operations with concurrency limit of ${CONCURRENCY_LIMIT}`
      );

      for (let i = 0; i < updateOperations.length; i += CONCURRENCY_LIMIT) {
        const batch = updateOperations.slice(i, i + CONCURRENCY_LIMIT);

        await Promise.allSettled(
          batch.map(async op => {
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
          })
        );
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
      hash = (hash << 5) - hash + char;
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

// Re-export memory builders from dedicated module
export {
  buildProjectMeta,
  buildBoardConfig,
  buildBoardMetrics,
  buildHotspots,
  buildBacklogSummary,
  buildRecentActivity,
  buildComponentsSummary,
  buildChangeLog,
  buildScratchpad,
  buildExpression,
} from './LettaMemoryBuilders.js';

// Re-export LettaFileService for direct access
export { LettaFileService } from './LettaFileService.js';
