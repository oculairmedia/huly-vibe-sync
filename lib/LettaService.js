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

  /**
   * Upsert memory blocks for an agent
   * Updates existing blocks or creates new ones with project state
   * 
   * @param {string} agentId - Agent ID
   * @param {Array<{label: string, value: any}>} blocks - Array of memory blocks to upsert
   */
  async upsertMemoryBlocks(agentId, blocks) {
    const MAX_BLOCK_SIZE = 50000; // Characters per block
    
    console.log(`[Letta] Upserting ${blocks.length} memory blocks for agent ${agentId}`);
    
    try {
      // Get agent's current memory blocks
      const agent = await this.client.agents.get(agentId);
      const existingBlocks = agent.memory?.blocks || [];
      const existingBlockMap = new Map(existingBlocks.map(b => [b.label, b]));
      
      // Process each block
      for (const block of blocks) {
        const { label, value } = block;
        
        // Serialize value (convert objects to JSON strings)
        let serializedValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        
        // Check size and truncate if needed
        if (serializedValue.length > MAX_BLOCK_SIZE) {
          console.warn(`[Letta] Block "${label}" exceeds size limit (${serializedValue.length} chars), truncating...`);
          serializedValue = serializedValue.substring(0, MAX_BLOCK_SIZE - 100) + '\n\n... [truncated]';
        }
        
        console.log(`[Letta] Upserting block "${label}" (${serializedValue.length} chars)`);
        
        // Check if block exists
        const existingBlock = existingBlockMap.get(label);
        
        if (existingBlock) {
          // Update existing block
          await this.client.blocks.update(existingBlock.id, {
            value: serializedValue,
          });
          console.log(`[Letta] Updated block "${label}" (id: ${existingBlock.id})`);
        } else {
          // Create new block and attach to agent
          const newBlock = await this.client.blocks.create({
            label,
            value: serializedValue,
          });
          
          // Attach block to agent
          await this.client.agents.memory.attach(agentId, newBlock.id);
          console.log(`[Letta] Created and attached block "${label}" (id: ${newBlock.id})`);
        }
      }
      
      console.log(`[Letta] Successfully upserted all ${blocks.length} memory blocks`);
      
    } catch (error) {
      console.error(`[Letta] Error upserting memory blocks:`, error.message);
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
    sync: {
      last_updated: new Date().toISOString(),
    },
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
    snapshot_time: new Date().toISOString(),
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
    since: new Date(lastSyncTimestamp).toISOString(),
  };
}
