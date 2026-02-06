/**
 * LettaAgentLifecycleService — agent CRUD (ensure, get, list, control agent).
 */

import { fetchWithPool } from '../http.js';
import { buildPersonaBlock } from './pm-agent-persona.js';

export class LettaAgentLifecycleService {
  constructor(config, memoryService, persistenceService) {
    this.config = config;
    this.memoryService = memoryService;
    this.persistenceService = persistenceService;
    this._controlAgentCache = null;
  }

  clearControlAgentCache() {
    this._controlAgentCache = null;
  }

  async ensureControlAgent() {
    const { client, apiURL, password, model, embedding, controlAgentName } = this.config;

    try {
      if (this._controlAgentCache) {
        return this._controlAgentCache;
      }

      console.log(`[Letta] Looking for control agent: ${controlAgentName}`);

      const agents = await client.agents.list();
      let controlAgent = agents.find(a => a.name === controlAgentName);

      if (!controlAgent) {
        console.log(`[Letta] Control agent not found, creating: ${controlAgentName}`);

        const persona = this._buildPersonaBlock('CONTROL', 'Huly PM Control Template');

        const response = await fetchWithPool(`${apiURL}/agents`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${password}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: controlAgentName,
            agent_type: 'letta_v1_agent',
            model,
            embedding,
            enable_sleeptime: false,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to create control agent: HTTP ${response.status}: ${errorText}`);
        }

        controlAgent = await response.json();
        console.log(`[Letta] ✓ Control agent created: ${controlAgent.id}`);

        await this.memoryService._updatePersonaBlock(controlAgent.id, persona);
        await this.memoryService._attachSharedHumanBlock(controlAgent.id);

        const defaultTools = [
          'tool-bb40505b-8a76-441a-a23b-b6788770a865',
          'tool-fbf98f0f-1495-42fa-ba4c-a85ac44bfbad',
          'tool-bfb4142c-2427-4b53-a194-079840c10e3a',
          'tool-08ffccab-5e2b-46c2-9422-d41e66defbe3',
          'tool-15c412cf-fcea-4406-ad1d-eb8e71bb156e',
          'tool-0743e6cb-9ad8-43a1-b374-661c16e39dcc',
          'tool-230e983a-1694-4ab6-99dd-ca24c13e449a',
        ];

        for (const toolId of defaultTools) {
          await client.agents.tools.attach(controlAgent.id, toolId);
        }

        console.log(`[Letta] ✓ Control agent configured with ${defaultTools.length} default tools`);
      }

      const config = await this.getControlAgentConfig(controlAgent.id);
      this._controlAgentCache = config;

      return config;
    } catch (error) {
      console.error(`[Letta] Error ensuring control agent:`, error.message);
      throw error;
    }
  }

  async getControlAgentConfig(agentId = null) {
    const { client, controlAgentName } = this.config;

    try {
      let controlAgent;

      if (agentId) {
        controlAgent = await client.agents.retrieve(agentId);
      } else {
        const agents = await client.agents.list();
        controlAgent = agents.find(a => a.name === controlAgentName);
        if (!controlAgent) {
          throw new Error(`Control agent not found: ${controlAgentName}`);
        }
      }

      const tools = await client.agents.tools.list(controlAgent.id);
      const toolIds = tools.map(t => t.id);

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

  async ensureAgent(projectIdentifier, projectName) {
    const { client, apiURL, password, model, embedding, enableSleeptime, sleeptimeFrequency } =
      this.config;

    const sanitizedName = projectName.replace(/[/\\:*?"<>|]/g, '-');
    const agentName = `Huly - ${sanitizedName}`;

    console.log(`[Letta] Ensuring agent exists: ${agentName}`);

    try {
      console.log(
        `[Letta] Querying Letta for agents with name: ${agentName}, tags: huly-vibe-sync, project:${projectIdentifier}`
      );

      const queryParams = new URLSearchParams({
        name: agentName,
        limit: '100',
        include: 'agent.tags',
      });
      queryParams.append('tags', 'huly-vibe-sync');
      queryParams.append('tags', `project:${projectIdentifier}`);
      queryParams.append('match_all_tags', 'true');

      const response = await fetchWithPool(`${apiURL}/agents?${queryParams}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${password}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const allAgents = await response.json();
      console.log(`[Letta] Found ${allAgents.length} agents matching name and tags`);

      const agents = allAgents.filter(a => a.name === agentName);
      const controlAgentId = this._controlAgentCache?.agentId;
      const pmAgents = agents.filter(a => a.id !== controlAgentId);

      console.log(`[Letta] Found ${pmAgents.length} existing primary agents matching name`);

      const persistedAgentId = this.persistenceService.getPersistedAgentId(projectIdentifier);

      if (persistedAgentId) {
        console.log(`[Letta] Found persisted agent ID in local state: ${persistedAgentId}`);
        const persistedAgent = pmAgents.find(a => a.id === persistedAgentId);

        if (persistedAgent) {
          console.log(
            `[Letta] ✓ Resumed agent from local state: ${persistedAgent.name} (${persistedAgent.id})`
          );
          await this.memoryService._ensureTemplateBlocks(persistedAgent.id);
          return persistedAgent;
        } else {
          console.warn(
            `[Letta] ⚠️  Persisted agent ${persistedAgentId} not found in Letta, searching for alternative...`
          );
        }
      }

      if (pmAgents && pmAgents.length > 0) {
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

          const sortedAgents = pmAgents.sort(
            (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
          );
          const existingAgent = sortedAgents[0];
          console.warn(`[Letta] Using most recent agent: ${existingAgent.id}`);
          console.warn(`[Letta] Please run cleanup-duplicate-agents.js to remove duplicates`);

          this.persistenceService.saveAgentId(projectIdentifier, existingAgent.id);
          await this.memoryService._ensureTemplateBlocks(existingAgent.id);
          return existingAgent;
        }

        const existingAgent = pmAgents[0];
        console.log(`[Letta] ✓ Found existing PM agent by name: ${existingAgent.id}`);

        const currentMapping = Object.entries(
          this.persistenceService._agentState.agents || {}
        ).find(([proj, id]) => id === existingAgent.id && proj !== projectIdentifier);

        if (currentMapping) {
          console.warn(
            `[Letta] ⚠️  Agent ${existingAgent.id} is already mapped to project ${currentMapping[0]}!`
          );
          console.warn(`[Letta] This agent cannot be reused. Creating new agent instead.`);
        } else {
          this.persistenceService.saveAgentId(projectIdentifier, existingAgent.id);
          console.log(`[Letta] ✓ Agent ID persisted to local state`);
          await this.memoryService._ensureTemplateBlocks(existingAgent.id);
          return existingAgent;
        }
      }

      console.log(`[Letta] Creating new agent: ${agentName}`);

      const persona = this._buildPersonaBlock(projectIdentifier, projectName);

      let agent;
      let retries = 0;
      const maxRetries = 3;

      while (retries <= maxRetries) {
        try {
          const createResp = await fetchWithPool(`${apiURL}/agents`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${password}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: agentName,
              agent_type: 'letta_v1_agent',
              model,
              embedding,
              enable_sleeptime: enableSleeptime,
              sleeptime_agent_frequency: sleeptimeFrequency,
              tags: ['huly-vibe-sync', `project:${projectIdentifier}`],
            }),
          });

          if (!createResp.ok) {
            const errorText = await createResp.text();
            throw new Error(`HTTP ${createResp.status}: ${errorText}`);
          }

          agent = await createResp.json();
          break;
        } catch (createError) {
          const isRateLimit =
            createError.message?.includes('500') || createError.message?.includes('429');

          if (isRateLimit && retries < maxRetries) {
            retries++;
            const delay = Math.min(1000 * Math.pow(2, retries), 10000);
            console.warn(
              `[Letta] Rate limit hit, retrying in ${delay}ms (attempt ${retries}/${maxRetries})...`
            );
            await new Promise(resolve => setTimeout(resolve, delay));

            console.log(`[Letta] Checking if agent was created despite error...`);
            const checkParams = new URLSearchParams({
              name: agentName,
              limit: '10',
              include: 'agent.tags',
            });
            checkParams.append('tags', 'huly-vibe-sync');
            checkParams.append('tags', `project:${projectIdentifier}`);
            checkParams.append('match_all_tags', 'true');

            const checkResp = await fetchWithPool(`${apiURL}/agents?${checkParams}`, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${password}`,
                'Content-Type': 'application/json',
              },
            });

            if (checkResp.ok) {
              const existingAgents = await checkResp.json();
              const matchingAgents = existingAgents.filter(a => a.name === agentName);
              if (matchingAgents.length > 0) {
                console.log(`[Letta] ✓ Agent was created successfully: ${matchingAgents[0].id}`);
                agent = matchingAgents[0];
                break;
              }
            }
          } else {
            throw createError;
          }
        }
      }

      console.log(`[Letta] ✓ Agent created successfully: ${agent.id}`);

      this.persistenceService.saveAgentId(projectIdentifier, agent.id);

      const controlConfig = await this.ensureControlAgent();

      const personaToUse = controlConfig.persona || persona;
      await this.memoryService._updatePersonaBlock(agent.id, personaToUse);
      await this.memoryService._ensureTemplateBlocks(agent.id);

      return agent;
    } catch (error) {
      console.error(`[Letta] Error ensuring agent:`, error.message);
      throw error;
    }
  }

  _buildPersonaBlock(projectIdentifier, projectName) {
    return buildPersonaBlock(projectIdentifier, projectName);
  }

  async getAgent(agentId) {
    try {
      return await this.config.client.agents.retrieve(agentId);
    } catch (error) {
      console.error(`[Letta] Error getting agent ${agentId}:`, error.message);
      throw error;
    }
  }

  async listAgents(filters = {}) {
    try {
      return await this.config.client.agents.list(filters);
    } catch (error) {
      console.error(`[Letta] Error listing agents:`, error.message);
      throw error;
    }
  }
}
