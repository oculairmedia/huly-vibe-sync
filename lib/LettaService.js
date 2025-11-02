/**
 * Letta Service Module
 * Wraps Letta SDK calls and provides clean API for agent lifecycle management
 */

import { LettaClient } from '@letta-ai/letta-client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LettaService {
  constructor(baseURL, password, options = {}) {
    this.client = new LettaClient({
      baseUrl: baseURL,  // SDK expects 'baseUrl' not 'baseURL'
      token: password,   // SDK expects 'token' not 'password'
    });
    // Set model defaults with fallback chain
    // Model: Claude Sonnet 4.5 (using Letta's naming convention)
    // Embedding: Letta free tier (OpenAI has quota issues, Google AI has 404 errors)
    this.model = options.model || process.env.LETTA_MODEL || 'anthropic/sonnet-4-5';
    this.embedding = options.embedding || process.env.LETTA_EMBEDDING || 'letta/letta-free';
    
    // In-memory cache for folder/source lookups (reduces API calls)
    this._folderCache = new Map(); // name -> folder object
    this._sourceCache = new Map(); // name -> source object
    
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
    console.log(`[Letta] Cache cleared`);
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
        fs.mkdirSync(lettaDir, { recursive: true });
        console.log(`[Letta] Created .letta directory: ${lettaDir}`);
      }
      
      // Create settings.local.json in Letta Code format
      const settings = {
        lastAgent: agentId
      };
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      console.log(`[Letta] ✓ Saved agent ID to project: ${settingsPath}`);
      
      // Create .gitignore if it doesn't exist
      const gitignorePath = path.join(lettaDir, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, '# Local agent state\nsettings.local.json\n*.log\n', 'utf8');
      }
      
    } catch (error) {
      console.error(`[Letta] Error saving agent ID to project folder:`, error.message);
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
    const agentName = `Huly-${projectIdentifier}-PM`; // No slashes - Letta rejects them
    
    console.log(`[Letta] Ensuring agent exists: ${agentName}`);
    
    try {
      // Check if we have a persisted agent ID for this project
      const persistedAgentId = this.getPersistedAgentId(projectIdentifier);
      
      if (persistedAgentId) {
        console.log(`[Letta] Found persisted agent ID: ${persistedAgentId}`);
        try {
          // Try to retrieve the agent by ID
          const agent = await this.client.agents.get(persistedAgentId);
          console.log(`[Letta] ✓ Resumed agent from .letta/settings.local.json: ${agent.name} (${agent.id})`);
          return agent;
        } catch (error) {
          console.warn(`[Letta] Persisted agent ${persistedAgentId} not found, will create new agent`);
          // Continue to create new agent
        }
      }
      
      // Try to find existing agent by name using server-side filtering
      const agents = await this.client.agents.list({ 
        name: agentName,
        limit: 100  // Increased to detect duplicates
      });
      
      if (agents && agents.length > 0) {
        // DUPLICATE PREVENTION: Check if multiple agents exist with same name
        if (agents.length > 1) {
          console.warn(`[Letta] ⚠️  WARNING: Found ${agents.length} agents with name "${agentName}"!`);
          console.warn(`[Letta] This indicates duplicates exist. Using first agent and logging all IDs:`);
          agents.forEach((agent, idx) => {
            console.warn(`[Letta]   ${idx + 1}. ${agent.id} (created: ${agent.created_at || 'unknown'})`);
          });
          console.warn(`[Letta] Please run cleanup-agents.js to remove duplicates`);
        }
        
        const existingAgent = agents[0];
        console.log(`[Letta] Found existing agent by name: ${existingAgent.id}`);
        // Save this agent ID for future use
        this.saveAgentId(projectIdentifier, existingAgent.id);
        return existingAgent;
      }
      
      // Create new agent with PM persona (with retry logic for rate limits)
      console.log(`[Letta] Creating new agent: ${agentName}`);
      
      const persona = this._buildPersonaBlock(projectIdentifier, projectName);
      
      // Retry logic with exponential backoff for rate limit errors
      let agent;
      let retries = 0;
      const maxRetries = 3;
      
      while (retries <= maxRetries) {
        try {
          agent = await this.client.agents.create({
            name: agentName,
            agent_type: 'letta_v1_agent',  // Explicitly use new v1 architecture
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
          
          break; // Success - exit retry loop
          
        } catch (createError) {
          // Check if it's a rate limit error (500 or 429)
          const isRateLimit = createError.message?.includes('500') || createError.message?.includes('429');
          
          if (isRateLimit && retries < maxRetries) {
            retries++;
            const delay = Math.min(1000 * Math.pow(2, retries), 10000); // Max 10 seconds
            console.warn(`[Letta] Rate limit hit, retrying in ${delay}ms (attempt ${retries}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            throw createError; // Not a rate limit or max retries reached
          }
        }
      }
      
      console.log(`[Letta] ✓ Agent created successfully: ${agent.id}`);
      
      // Persist the agent ID for future runs
      this.saveAgentId(projectIdentifier, agent.id);
      
      return agent;
      
    } catch (error) {
      console.error(`[Letta] Error ensuring agent:`, error.message);
      throw error;
    }
  }

  /**
   * Attach PM tools to agent (Minimal Set)
   * 
   * Attaches 10 essential MCP tools for PM agent functionality:
   * - Huly: huly_query, huly_issue_ops, huly_entity (3 tools)
   * - Vibe: list_projects, list_tasks, get_task, update_task, list_task_attempts, get_task_attempt, get_branch_status (7 tools)
   * 
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Result with attached tool count
   */
  async attachPmTools(agentId) {
    console.log(`[Letta] Attaching PM tools to agent ${agentId}...`);
    
    // Minimal tool set (10 tools)
    const toolIds = [
      // Huly tools (3)
      'tool-bb40505b-8a76-441a-a23b-b6788770a865', // huly_query
      'tool-fbf98f0f-1495-42fa-ba4c-a85ac44bfbad', // huly_issue_ops
      'tool-bfb4142c-2427-4b53-a194-079840c10e3a', // huly_entity
      
      // Vibe tools (7)
      'tool-08ffccab-5e2b-46c2-9422-d41e66defbe3', // list_projects
      'tool-15c412cf-fcea-4406-ad1d-eb8e71bb156e', // list_tasks
      'tool-0743e6cb-9ad8-43a1-b374-661c16e39dcc', // get_task
      'tool-230e983a-1694-4ab6-99dd-ca24c13e449a', // update_task
      'tool-f6331ae7-3dba-4c57-bc7b-d9d756300b5b', // list_task_attempts
      'tool-10a38c6a-753c-4838-a720-7c5a17d01960', // get_task_attempt
      'tool-369b5bbd-60c3-499e-a720-1c658bb5433f', // get_branch_status
    ];
    
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
      // Get agent's current memory blocks in ONE call
      const existingBlocks = await this.client.agents.blocks.list(agentId, { limit: 50 });
      const existingBlockMap = new Map(existingBlocks.map(b => [b.label, b]));
      
      // Build update plan with content hashing
      const updateOperations = [];
      let skippedCount = 0;
      
      for (const block of blocks) {
        const { label, value } = block;
        
        // Serialize value (convert objects to JSON strings)
        let serializedValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        
        // Check size and truncate if needed
        if (serializedValue.length > MAX_BLOCK_SIZE) {
          console.warn(`[Letta] Block "${label}" exceeds size limit (${serializedValue.length} chars), truncating...`);
          serializedValue = serializedValue.substring(0, MAX_BLOCK_SIZE - 100) + '\n\n... [truncated]';
        }
        
        // Hash content to detect changes
        const contentHash = this._hashContent(serializedValue);
        
        // Check if block exists
        const existingBlock = existingBlockMap.get(label);
        
        if (existingBlock) {
          // Only update if content changed (hash comparison)
          const existingHash = this._hashContent(existingBlock.value);
          
          if (existingHash !== contentHash) {
            console.log(`[Letta] Upserting block "${label}" (${serializedValue.length} chars)`);
            updateOperations.push({
              type: 'update',
              label,
              blockId: existingBlock.id,
              value: serializedValue,
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
          });
        }
      }
      
      if (skippedCount > 0) {
        console.log(`[Letta] Skipped ${skippedCount} unchanged blocks`);
      }
      
      if (updateOperations.length === 0) {
        console.log(`[Letta] No changes needed, all blocks up to date`);
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
