/**
 * LettaToolService — tool management (attach, sync, MCP tools).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithPool } from '../http.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LettaToolService {
  constructor(config, lifecycleService) {
    this.config = config;
    this.lifecycleService = lifecycleService;
  }

  async attachPmTools(agentId) {
    const client = this.config.client;
    console.log(`[Letta] Attaching PM tools to agent ${agentId}...`);

    const controlConfig = await this.lifecycleService.ensureControlAgent();
    const toolIds = controlConfig.toolIds;

    console.log(`[Letta] Control agent has ${toolIds.length} tools - ensuring all are attached`);

    let attachedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const toolId of toolIds) {
      try {
        await client.agents.tools.attach(agentId, toolId);
        attachedCount++;
        console.log(`[Letta]   ✓ Attached tool: ${toolId}`);
        await new Promise(r => setTimeout(r, 200));
      } catch (error) {
        if (error.message && error.message.includes('already attached')) {
          skippedCount++;
          console.log(`[Letta]   - Tool already attached: ${toolId}`);
        } else {
          errors.push({ toolId, error: error.message });
          console.error(`[Letta]   ✗ Error attaching tool ${toolId}:`, error.message);
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(
      `[Letta] Tool attachment complete: ${attachedCount} attached, ${skippedCount} already attached, ${errors.length} errors`
    );

    return { total: toolIds.length, attached: attachedCount, skipped: skippedCount, errors };
  }

  async syncToolsFromControl(agentId, forceSync = false) {
    const client = this.config.client;
    console.log(`[Letta] Syncing tools from control agent to ${agentId}...`);

    const controlConfig = await this.lifecycleService.ensureControlAgent();
    const targetToolIds = controlConfig.toolIds;

    console.log(`[Letta] Control agent has ${targetToolIds.length} tools`);

    const currentTools = await client.agents.tools.list(agentId);
    const currentToolIds = new Set(currentTools.map(t => t.id));

    console.log(`[Letta] PM agent currently has ${currentTools.length} tools`);

    const toAttach = targetToolIds.filter(id => !currentToolIds.has(id));
    const toDetach = forceSync ? [...currentToolIds].filter(id => !targetToolIds.includes(id)) : [];

    const result = { total: targetToolIds.length, attached: 0, detached: 0, skipped: 0, errors: [] };

    if (toDetach.length > 0) {
      console.log(`[Letta] Detaching ${toDetach.length} tools not in control agent...`);
      for (const toolId of toDetach) {
        try {
          await client.agents.tools.detach(agentId, toolId);
          result.detached++;
          console.log(`[Letta]   ✓ Detached: ${toolId}`);
        } catch (error) {
          result.errors.push({ toolId, operation: 'detach', error: error.message });
          console.error(`[Letta]   ✗ Failed to detach ${toolId}:`, error.message);
        }
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (toAttach.length > 0) {
      console.log(`[Letta] Attaching ${toAttach.length} new tools from control agent...`);
      for (const toolId of toAttach) {
        try {
          await client.agents.tools.attach(agentId, toolId);
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
        await new Promise(r => setTimeout(r, 200));
      }
    } else {
      console.log(`[Letta] No new tools to attach - agent is up to date`);
    }

    console.log(
      `[Letta] Tool sync complete: ${result.attached} attached, ${result.detached} detached, ${result.skipped} already attached, ${result.errors.length} errors`
    );

    return result;
  }

  async attachMcpTools(agentId, hulyMcpUrl, vibeMcpUrl) {
    console.log(`[Letta] Redirecting to attachPmTools()...`);
    return await this.attachPmTools(agentId);
  }

  async _ensureMcpTool(name, url) {
    const client = this.config.client;
    try {
      const tools = await client.tools.mcp.list();
      const existing = tools.find(t => t.name === name);

      if (existing) {
        console.log(`[Letta] MCP tool already exists: ${name}`);
        return existing;
      }

      console.log(`[Letta] Creating MCP tool: ${name} at ${url}`);
      const tool = await client.tools.mcp.create({ name, transport: 'http', url });
      console.log(`[Letta] MCP tool created: ${tool.id}`);
      return tool;
    } catch (error) {
      console.error(`[Letta] Error ensuring MCP tool ${name}:`, error.message);
      throw error;
    }
  }

  async ensureSearchFolderPassagesTool() {
    const toolName = 'search_folder_passages';
    const { apiURL, password } = this.config;

    try {
      const response = await fetchWithPool(`${apiURL}/tools?name=${toolName}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${password}`,
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

      console.log(`[Letta] Creating search_folder_passages tool...`);

      const toolSourcePath = path.join(__dirname, '..', '..', 'tools', 'search_folder_passages.py');
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

      const createResponse = await fetchWithPool(`${apiURL}/tools`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${password}`,
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

  async attachSearchFolderPassagesTool(agentId) {
    try {
      const toolId = await this.ensureSearchFolderPassagesTool();
      await this.config.client.agents.tools.attach(agentId, toolId);
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

  async setAgentIdEnvVar(agentId) {
    const { apiURL, password } = this.config;
    try {
      const response = await fetchWithPool(`${apiURL}/agents/${agentId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${password}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool_exec_environment_variables: { LETTA_AGENT_ID: agentId },
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
}
