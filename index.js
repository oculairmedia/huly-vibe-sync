#!/usr/bin/env node

/**
 * Huly → Vibe Kanban Sync Service
 *
 * Syncs projects and issues from Huly to Vibe Kanban
 * Uses Huly REST API and Vibe Kanban MCP servers
 */

import 'dotenv/config';
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { createHulyRestClient } from './lib/HulyRestClient.js';
import { createSyncDatabase } from './lib/database.js';
import { fetchWithPool, getPoolStats } from './lib/http.js';
import { 
  createLettaService,
  buildProjectMeta,
  buildBoardConfig,
  buildBoardMetrics,
  buildHotspots,
  buildBacklogSummary,
  buildChangeLog, buildScratchpad,
} from './lib/LettaService.js';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const config = {
  huly: {
    apiUrl: process.env.HULY_API_URL || process.env.HULY_MCP_URL || 'http://192.168.50.90:3457/api',
    useRestApi: process.env.HULY_USE_REST !== 'false', // Default to REST API
  },
  vibeKanban: {
    mcpUrl: process.env.VIBE_MCP_URL || 'http://192.168.50.90:9717/mcp',
    apiUrl: process.env.VIBE_API_URL || 'http://192.168.50.90:3105/api',
    useRestApi: process.env.VIBE_USE_REST !== 'false', // Default to REST API
  },
  sync: {
    interval: parseInt(process.env.SYNC_INTERVAL || '300000'), // 5 minutes default
    dryRun: process.env.DRY_RUN === 'true',
    incremental: process.env.INCREMENTAL_SYNC !== 'false', // Default to true
    parallel: process.env.PARALLEL_SYNC === 'true', // Parallel processing
    maxWorkers: parseInt(process.env.MAX_WORKERS || '5'), // Max concurrent workers
    skipEmpty: process.env.SKIP_EMPTY_PROJECTS === 'true', // Skip projects with 0 issues
    apiDelay: parseInt(process.env.API_DELAY || '10'), // Delay between API calls (ms) - reduced from 50ms
  },
  stacks: {
    baseDir: process.env.STACKS_DIR || '/opt/stacks',
  },
  letta: {
    enabled: process.env.LETTA_BASE_URL && process.env.LETTA_PASSWORD,
    baseURL: process.env.LETTA_BASE_URL,
    password: process.env.LETTA_PASSWORD,
    hulyMcpUrl: process.env.HULY_MCP_URL || 'http://192.168.50.90:3457/mcp',
    vibeMcpUrl: process.env.VIBE_MCP_URL,
  },
};

// Health tracking
const healthStats = {
  startTime: Date.now(),
  lastSyncTime: null,
  lastSyncDuration: null,
  syncCount: 0,
  errorCount: 0,
  lastError: null,
};

// Database initialization (replaces JSON file state management)
const DB_PATH = path.join(__dirname, 'logs', 'sync-state.db');
const SYNC_STATE_FILE = path.join(__dirname, 'logs', '.sync-state.json'); // For migration

// Initialize database
let db;
try {
  db = createSyncDatabase(DB_PATH);
  console.log('[DB] Database initialized successfully');

  // One-time migration from JSON to SQLite
  if (fs.existsSync(SYNC_STATE_FILE)) {
    // Check if database is empty (new database)
    const lastSync = db.getLastSync();
    if (!lastSync) {
      console.log('[Migration] Detected existing JSON state file, importing data...');
      try {
        const oldState = JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8'));
        db.importFromJSON(oldState);

        // Backup old file
        const backupFile = `${SYNC_STATE_FILE}.backup-${Date.now()}`;
        fs.renameSync(SYNC_STATE_FILE, backupFile);
        console.log(`[Migration] ✓ Migration complete, old file backed up to ${backupFile}`);
      } catch (migrationError) {
        console.error('[Migration] ✗ Failed to migrate JSON data:', migrationError.message);
        console.error('[Migration] Continuing with empty database...');
      }
    }
  }
} catch (dbError) {
  console.error('[DB] Failed to initialize database:', dbError.message);
  console.error('[DB] Exiting...');
  process.exit(1);
}

// Initialize Letta service (if configured)
let lettaService = null;
if (config.letta.enabled) {
  try {
    lettaService = createLettaService();
    console.log('[Letta] Service initialized successfully');
  } catch (lettaError) {
    console.warn('[Letta] Failed to initialize service:', lettaError.message);
    console.warn('[Letta] PM agent integration will be disabled');
  }
} else {
  console.log('[Letta] PM agent integration disabled (LETTA_BASE_URL or LETTA_PASSWORD not set)');
}

console.log('Huly → Vibe Kanban Sync Service');
console.log('Configuration:', {
  hulyApi: config.huly.apiUrl,
  hulyMode: config.huly.useRestApi ? 'REST API' : 'MCP',
  vibeApi: config.vibeKanban.apiUrl,
  vibeMode: 'REST API',
  stacksDir: config.stacks.baseDir,
  syncInterval: `${config.sync.interval / 1000}s`,
  incrementalSync: config.sync.incremental,
  parallelProcessing: config.sync.parallel,
  maxWorkers: config.sync.maxWorkers,
  skipEmptyProjects: config.sync.skipEmpty,
  dryRun: config.sync.dryRun,
});

/**
 * Timeout wrapper for async operations
 */
async function withTimeout(promise, timeoutMs, operation) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms: ${operation}`)), timeoutMs)
    )
  ]);
}

// Simple MCP client with session support
class MCPClient {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.requestId = 1;
    this.sessionId = null;
  }

  async initialize() {
    console.log(`[${this.name}] Initializing MCP session...`);

    // Initialize session
    const initResult = await this.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'huly-vibe-sync',
        version: '1.0.0',
      },
    });

    console.log(`[${this.name}] ✓ Session initialized`);
    return initResult;
  }

  async call(method, params = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };

    // Add session ID to headers if we have one (use lowercase for compatibility)
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    const response = await fetchWithPool(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.requestId++,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check for session ID in response headers (try multiple header names)
    const newSessionId = response.headers.get('mcp-session-id') ||
                        response.headers.get('Mcp-Session-Id') ||
                        response.headers.get('X-Session-ID');
    if (newSessionId && !this.sessionId) {
      this.sessionId = newSessionId;
      console.log(`[${this.name}] Session ID: ${newSessionId}`);
    }

    // Check if response is SSE or JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
      // Parse SSE response
      const text = await response.text();
      const lines = text.split('\n');
      let jsonData = null;

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.substring(6);
          try {
            jsonData = JSON.parse(dataStr);
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }

      if (!jsonData) {
        throw new Error('No valid JSON data in SSE response');
      }

      if (jsonData.error) {
        throw new Error(`MCP Error: ${jsonData.error.message}`);
      }

      return jsonData.result;
    } else {
      // Parse JSON response
      const data = await response.json();

      if (data.error) {
        throw new Error(`MCP Error: ${data.error.message}`);
      }

      return data.result;
    }
  }

  async callTool(name, args) {
    // Wrap MCP call with 60-second timeout
    const result = await withTimeout(
      this.call('tools/call', { name, arguments: args }),
      60000,
      `MCP ${this.name} callTool(${name})`
    );

    if (result && result.content && result.content[0]) {
      const content = result.content[0];
      if (content.type === 'text') {
        try {
          return JSON.parse(content.text);
        } catch (e) {
          return content.text;
        }
      }
    }

    return result;
  }
}

/**
 * Parse projects from Huly MCP text response
 */
function parseProjectsFromText(text) {
  const projects = [];
  const lines = text.split('\n');

  let currentProject = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Project header: 📁 Project Name (CODE)
    if (trimmed.startsWith('📁 ') && trimmed.includes('(') && trimmed.endsWith(')')) {
      if (currentProject) {
        projects.push(currentProject);
      }

      // Extract name and identifier
      const content = trimmed.substring(2); // Remove "📁 "
      const lastParen = content.lastIndexOf('(');
      const name = content.substring(0, lastParen).trim();
      const identifier = content.substring(lastParen + 1, content.length - 1).trim();

      currentProject = {
        name,
        identifier,
        description: '',
        issues: 0,
        status: 'active',
      };
    }
    // Description line
    else if (trimmed.startsWith('Description: ') && currentProject) {
      currentProject.description = trimmed.substring(13).trim();
    }
    // Issues count
    else if (trimmed.startsWith('Issues: ') && currentProject) {
      try {
        currentProject.issues = parseInt(trimmed.substring(8).split()[0], 10);
      } catch (e) {
        currentProject.issues = 0;
      }
    }
    // Status
    else if (trimmed.startsWith('Status: ') && currentProject) {
      currentProject.status = trimmed.substring(8).trim().toLowerCase();
    }
    // Filesystem path (special handling for our synced projects)
    else if (trimmed.startsWith('Filesystem: ') && currentProject) {
      if (!currentProject.description.includes('Filesystem:')) {
        currentProject.description += `\n\n---\n${trimmed}`;
      }
    }
    else if (trimmed.includes('Filesystem:') && !trimmed.startsWith('Description:') && currentProject) {
      // Sometimes filesystem path appears on its own line
      if (!currentProject.description.includes('Filesystem:')) {
        currentProject.description += `\n\n---\n${trimmed}`;
      }
    }
  }

  // Add the last project
  if (currentProject) {
    projects.push(currentProject);
  }

  return projects;
}

/**
 * Extract filesystem path from Huly project description
 */
function extractFilesystemPath(description) {
  if (!description) return null;

  // Match patterns like: Path:, Filesystem:, Directory:, Location:
  const patterns = [
    /(?:Path|Filesystem|Directory|Location):\s*([^\n\r]+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const path = match[1].trim();
      // Clean up common suffixes
      return path.replace(/[,;.]$/, '').trim();
    }
  }
  
  return null;
}

/**
 * Get git URL from local repository
 */
function getGitUrl(repoPath) {
  try {
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      return null;
    }

    const url = execSync('git remote get-url origin', {
      cwd: repoPath,
      encoding: 'utf8',
    }).trim();

    return url || null;
  } catch (error) {
    return null;
  }
}

/**
 * Fetch projects from Huly using REST API
 */
async function fetchHulyProjects(hulyClient) {
  console.log('\n[Huly] Fetching projects...');

  try {
    // Use the REST API's listProjects method
    const projects = await hulyClient.listProjects();

    console.log(`[Huly] Found ${projects.length} projects`);

    // Debug: show first project structure
    if (projects.length > 0 && config.sync.dryRun) {
      console.log('[Huly] Sample project:', JSON.stringify(projects[0], null, 2));
    }

    return projects;
  } catch (error) {
    console.error('[Huly] Error fetching projects:', error.message);
    return [];
  }
}

/**
 * Extract full description from Huly issue detail response
 * The detail response has a ## Description section with full multi-line content
 * The description ends at specific top-level sections like "Recent Comments"
 */
function extractFullDescription(detailText) {
  const lines = detailText.split('\n');
  let inDescription = false;
  let description = [];

  // Top-level sections that mark the end of description
  const endSections = ['## Recent Comments', '## Sub-issues', '## Attachments'];

  for (const line of lines) {
    // Start capturing after ## Description header
    if (line.trim() === '## Description') {
      inDescription = true;
      continue;
    }

    // Stop at known end sections (not subsections within description)
    if (inDescription) {
      const trimmedLine = line.trim();
      if (endSections.some(section => trimmedLine === section)) {
        break;
      }
    }

    // Capture all description lines (including subsections like ## Summary, etc.)
    if (inDescription) {
      description.push(line);
    }
  }

  // Join and trim the description
  return description.join('\n').trim();
}

/**
 * Parse issues from Huly MCP text response
 */
function parseIssuesFromText(text, projectId) {
  const issues = [];
  const lines = text.split('\n');

  let currentIssue = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Issue header: 📋 **PROJ-123**: Issue Title
    if (trimmed.startsWith('📋 **') && trimmed.includes('**:')) {
      if (currentIssue) {
        issues.push(currentIssue);
      }

      // Extract identifier and title
      const parts = trimmed.split('**:', 1);
      const identifier = parts[0].substring(5).trim(); // Remove "📋 **"
      const title = trimmed.substring(trimmed.indexOf('**:') + 3).trim();

      currentIssue = {
        identifier,
        title,
        description: '',
        status: 'unknown',
        priority: 'medium',
        component: null,
        milestone: null,
      };
    }
    // Status line
    else if (trimmed.startsWith('Status: ') && currentIssue) {
      currentIssue.status = trimmed.substring(8).trim().toLowerCase();
    }
    // Priority line
    else if (trimmed.startsWith('Priority: ') && currentIssue) {
      currentIssue.priority = trimmed.substring(10).trim().toLowerCase();
    }
    // Description line
    else if (trimmed.startsWith('Description: ') && currentIssue) {
      currentIssue.description = trimmed.substring(13).trim();
    }
  }

  // Add the last issue
  if (currentIssue) {
    issues.push(currentIssue);
  }

  return issues;
}

/**
 * Fetch issues for a specific Huly project
 */
async function fetchHulyIssues(hulyClient, projectIdentifier, lastSyncTime = null) {
  const isIncremental = config.sync.incremental && lastSyncTime;

  if (isIncremental) {
    console.log(`[Huly] Incremental fetch for ${projectIdentifier} (modified after ${new Date(lastSyncTime).toISOString()})`);
  } else {
    console.log(`[Huly] Full fetch for project ${projectIdentifier}...`);
  }

  try {
    // Use the REST API's listIssues method which returns all issues with full details in one call
    const options = {
      limit: 1000, // Fetch up to 1000 issues
    };

    // Add time filter for incremental sync
    if (isIncremental) {
      options.modifiedAfter = new Date(lastSyncTime).toISOString();
    }

    // The REST API returns complete issue data with descriptions in a single call!
    const issues = await hulyClient.listIssues(projectIdentifier, options);

    console.log(`[Huly] Found ${issues.length} issues in ${projectIdentifier}`);

    return issues;
  } catch (error) {
    console.error(`[Huly] Error fetching issues for ${projectIdentifier}:`, error.message);
    return [];
  }
}

/**
 * Process batch of promises with concurrency limit
 */
async function processBatch(items, batchSize, processFunction) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(processFunction));
    results.push(...batchResults);
  }
  return results;
}

/**
 * List existing Vibe Kanban projects (using HTTP API for reliability)
 */
async function listVibeProjects(vibeClient) {
  console.log('\n[Vibe] Listing existing projects...');

  try {
    const response = await fetchWithPool(`${config.vibeKanban.apiUrl}/projects`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Failed to list projects');
    }

    const projects = result.data || [];
    console.log(`[Vibe] Found ${projects.length} existing projects`);
    return projects;
  } catch (error) {
    console.error('[Vibe] Error listing projects:', error.message);
    return [];
  }
}

/**
 * Determine git repo path for Vibe Kanban project
 */
function determineGitRepoPath(hulyProject) {
  // Priority 1: Extract filesystem path from Huly description
  const filesystemPath = extractFilesystemPath(hulyProject.description);
  if (filesystemPath && fs.existsSync(filesystemPath)) {
    console.log(`[Vibe] Using filesystem path from Huly: ${filesystemPath}`);
    return filesystemPath;
  }

  // Priority 2: Use placeholder in /opt/stacks (mounted in Docker)
  const placeholder = `/opt/stacks/huly-sync-placeholders/${hulyProject.identifier}`;
  console.log(`[Vibe] Using placeholder path: ${placeholder}`);
  return placeholder;
}

/**
 * Create a project in Vibe Kanban via HTTP API
 */
async function createVibeProject(hulyProject) {
  if (config.sync.dryRun) {
    console.log(`[Vibe] [DRY RUN] Would create project: ${hulyProject.name}`);
    return null;
  }

  console.log(`[Vibe] Creating project: ${hulyProject.name}`);

  try {
    const gitRepoPath = determineGitRepoPath(hulyProject);

    const response = await fetchWithPool(`${config.vibeKanban.apiUrl}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: hulyProject.name,
        git_repo_path: gitRepoPath,
        use_existing_repo: fs.existsSync(gitRepoPath),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Project creation failed');
    }

    console.log(`[Vibe] ✓ Created project: ${hulyProject.name}`);
    return result.data;
  } catch (error) {
    console.error(`[Vibe] ✗ Error creating project ${hulyProject.name}:`, error.message);
    return null;
  }
}

/**
 * Map Huly issue status to Vibe Kanban task status
 */
function mapHulyStatusToVibe(hulyStatus) {
  if (!hulyStatus) return 'todo';

  const status = hulyStatus.toLowerCase();

  if (status.includes('backlog') || status.includes('todo')) return 'todo';
  if (status.includes('progress')) return 'inprogress';
  if (status.includes('review')) return 'inreview';
  if (status.includes('done') || status.includes('completed')) return 'done';
  if (status.includes('cancel')) return 'cancelled';

  return 'todo';
}

/**
 * Create a task in Vibe Kanban
 */
async function createVibeTask(vibeClient, vibeProjectId, hulyIssue) {
  if (config.sync.dryRun) {
    console.log(`[Vibe] [DRY RUN] Would create task: ${hulyIssue.title}`);
    return null;
  }

  console.log(`[Vibe] Creating task: ${hulyIssue.title}`);

  try {
    // Add Huly issue ID to description for tracking
    const description = hulyIssue.description
      ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.identifier}`
      : `Synced from Huly: ${hulyIssue.identifier}`;

    const vibeStatus = mapHulyStatusToVibe(hulyIssue.status);

    const response = await fetchWithPool(`${config.vibeKanban.apiUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: vibeProjectId,
        title: hulyIssue.title,
        description: description,
        status: vibeStatus,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Task creation failed');
    }

    console.log(`[Vibe] ✓ Created task: ${hulyIssue.title}`);
    return result.data;
  } catch (error) {
    console.error(`[Vibe] ✗ Error creating task ${hulyIssue.title}:`, error.message);
    return null;
  }
}

/**
 * Update task status in Vibe Kanban
 */
async function updateVibeTaskStatus(vibeClient, taskId, status) {
  if (config.sync.dryRun) {
    console.log(`[Vibe] [DRY RUN] Would update task ${taskId} status to: ${status}`);
    return;
  }

  try {
    const response = await fetchWithPool(`${config.vibeKanban.apiUrl}/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Task update failed');
    }

    console.log(`[Vibe] ✓ Updated task ${taskId} status to: ${status}`);
  } catch (error) {
    console.error(`[Vibe] Error updating task ${taskId} status:`, error.message);
  }
}

/**
 * Update Vibe task description
 */
async function updateVibeTaskDescription(vibeClient, taskId, description) {
  if (config.sync.dryRun) {
    console.log(`[Vibe] [DRY RUN] Would update task ${taskId} description`);
    return;
  }

  try {
    const response = await fetchWithPool(`${config.vibeKanban.apiUrl}/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Task description update failed');
    }

    console.log(`[Vibe] ✓ Updated task ${taskId} description`);
  } catch (error) {
    console.error(`[Vibe] Error updating task ${taskId} description:`, error.message);
  }
}

/**
 * Update Huly issue status
 */
async function updateHulyIssueStatus(hulyClient, issueIdentifier, status) {
  if (config.sync.dryRun) {
    console.log(`[Huly] [DRY RUN] Would update issue ${issueIdentifier} status to: ${status}`);
    return true;
  }

  try {
    // Check if using REST API client or MCP client
    if (typeof hulyClient.updateIssue === 'function') {
      // HulyRestClient
      await hulyClient.updateIssue(issueIdentifier, 'status', status);
    } else if (typeof hulyClient.callTool === 'function') {
      // MCPClient
      await hulyClient.callTool('huly_issue_ops', {
        operation: 'update',
        issue_identifier: issueIdentifier,
        update: {
          field: 'status',
          value: status
        }
      });
    } else {
      throw new Error('Unsupported client type');
    }

    console.log(`[Huly] ✓ Updated issue ${issueIdentifier} status to: ${status}`);
    return true;
  } catch (error) {
    console.error(`[Huly] Error updating issue ${issueIdentifier} status:`, error.message);
    return false;
  }
}

/**
 * Update Huly issue description
 */
async function updateHulyIssueDescription(hulyClient, issueIdentifier, description) {
  if (config.sync.dryRun) {
    console.log(`[Huly] [DRY RUN] Would update issue ${issueIdentifier} description`);
    return true;
  }

  try {
    // Check if using REST API client or MCP client
    if (typeof hulyClient.updateIssue === 'function') {
      // HulyRestClient
      await hulyClient.updateIssue(issueIdentifier, 'description', description);
    } else if (typeof hulyClient.callTool === 'function') {
      // MCPClient
      await hulyClient.callTool('huly_issue_ops', {
        operation: 'update',
        issue_identifier: issueIdentifier,
        update: {
          field: 'description',
          value: description
        }
      });
    } else {
      throw new Error('Unsupported client type');
    }

    console.log(`[Huly] ✓ Updated issue ${issueIdentifier} description`);
    return true;
  } catch (error) {
    console.error(`[Huly] Error updating issue ${issueIdentifier} description:`, error.message);
    return false;
  }
}

/**
 * Extract Huly issue identifier from Vibe task description
 */
function extractHulyIdentifier(description) {
  if (!description) return null;

  const match = description.match(/Huly Issue: ([A-Z]+-\d+)/);
  return match ? match[1] : null;
}

/**
 * Map Vibe status to Huly status
 */
function mapVibeStatusToHuly(vibeStatus) {
  const statusMap = {
    'todo': 'Backlog',
    'inprogress': 'In Progress',
    'inreview': 'In Review',
    'done': 'Done',
    'cancelled': 'Cancelled'
  };

  return statusMap[vibeStatus] || 'Backlog';
}

/**
 * Sync task status changes from Vibe back to Huly (bidirectional)
 */
async function syncVibeTaskToHuly(hulyClient, vibeTask, hulyIssues, projectIdentifier, phase1UpdatedTasks = new Set()) {
  // Skip if this task was just updated in Phase 1
  if (phase1UpdatedTasks.has(vibeTask.id)) {
    console.log(`[Skip Phase 2] Task "${vibeTask.title}" was just updated in Phase 1`);
    return;
  }

  // Extract Huly identifier from task description
  const hulyIdentifier = extractHulyIdentifier(vibeTask.description);

  if (!hulyIdentifier) {
    return; // Not synced from Huly, skip
  }

  // Find corresponding Huly issue
  const hulyIssue = hulyIssues.find(issue => issue.identifier === hulyIdentifier);

  if (!hulyIssue) {
    console.log(`[Skip] Huly issue ${hulyIdentifier} not found`);
    return;
  }

  // Map Vibe status to Huly status
  const vibeStatusMapped = mapVibeStatusToHuly(vibeTask.status);
  const hulyStatusNormalized = hulyIssue.status || 'Backlog';

  // Check database to see if Huly recently changed
  const dbIssue = db.getIssue(hulyIdentifier);
  const lastKnownHulyStatus = dbIssue?.status;

  // Check for description changes (Vibe → Huly)
  // Extract description without the Huly identifier footer
  const vibeDescWithoutFooter = vibeTask.description?.replace(/\n\n---\nHuly Issue: [A-Z]+-\d+$/,'' ) || '';
  const hulyDesc = hulyIssue.description || '';
  
  if (vibeDescWithoutFooter !== hulyDesc) {
    // Description differs - check if Vibe's description changed
    const lastKnownHulyDesc = dbIssue?.description;
    const hulyDescChanged = lastKnownHulyDesc && hulyDesc !== lastKnownHulyDesc;
    
    if (!hulyDescChanged) {
      // Only Vibe description changed - update Huly
      console.log(`[Vibe→Huly] Updating issue "${vibeTask.title}" description`);
      await updateHulyIssueDescription(hulyClient, hulyIdentifier, vibeDescWithoutFooter);
      
      // Update database with new description
      db.upsertIssue({
        identifier: hulyIdentifier,
        project_identifier: projectIdentifier,
        description: vibeDescWithoutFooter,
      });
    }
  }

  // Only update if statuses differ
  if (vibeStatusMapped !== hulyStatusNormalized) {
    // Check if Huly changed (if so, skip - Phase 1 will handle it)
    const hulyChanged = lastKnownHulyStatus && hulyIssue.status !== lastKnownHulyStatus;
    
    if (hulyChanged) {
      // Huly changed - don't overwrite! Phase 1 should handle this
      console.log(`[Skip Phase 2] Huly changed for "${vibeTask.title}", letting Phase 1 handle it`);
      return;
    }
    
    // Vibe changed and Huly didn't - safe to update
    console.log(`[Vibe→Huly] Task "${vibeTask.title}" status changed: ${hulyStatusNormalized} → ${vibeStatusMapped}`);
    const success = await updateHulyIssueStatus(hulyClient, hulyIdentifier, vibeStatusMapped);
    
    if (success) {
      // Update database with new status
      db.upsertIssue({
        identifier: hulyIdentifier,
        project_identifier: projectIdentifier,
        status: vibeStatusMapped,
        vibe_task_id: vibeTask.id,
      });
    }
  }
}

/**
 * Sync all projects and issues (bidirectional)
 */
async function syncHulyToVibe(hulyClient, vibeClient) {
  console.log('\n='.repeat(60));
  console.log(`Starting bidirectional sync at ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  // Start tracking this sync run
  const syncId = db.startSyncRun();
  const syncStartTime = Date.now();

  // Get last sync timestamp from database
  const lastSync = db.getLastSync();
  if (lastSync) {
    console.log(`[Sync] Last sync: ${new Date(lastSync).toISOString()}`);
  }

  // Setup heartbeat logging
  const heartbeatInterval = setInterval(() => {
    console.log(`[HEARTBEAT] Sync still running... ${new Date().toISOString()}`);
  }, 30000); // Log every 30 seconds

  try {
    // Fetch Huly projects
    const hulyProjects = await fetchHulyProjects(hulyClient);
    if (hulyProjects.length === 0) {
      console.log('No Huly projects found. Skipping sync.');
      clearInterval(heartbeatInterval);
      return;
    }

    console.log(`[Huly] Found ${hulyProjects.length} projects\n`);

    // Get existing Vibe projects
    const vibeProjects = await listVibeProjects(vibeClient);
    console.log(`[Vibe] Found ${vibeProjects.length} existing projects\n`);
    // Use lowercase names for case-insensitive matching
    const vibeProjectsByName = new Map(vibeProjects.map(p => [p.name.toLowerCase(), p]));

    // Filter projects if skip empty is enabled (using database with change detection)
    let projectsToProcess = hulyProjects;
    if (config.sync.skipEmpty) {
      console.log('[DB] Querying projects to sync (checking for changes and skipping recently checked empty projects)...');
      
      // Compute description hashes for all projects
      const { SyncDatabase } = await import('./lib/database.js');
      const descriptionHashes = {};
      for (const project of hulyProjects) {
        const identifier = project.identifier || project.name;
        descriptionHashes[identifier] = SyncDatabase.computeDescriptionHash(project.description);
      }
      
      const projectsNeedingSync = db.getProjectsToSync(300000, descriptionHashes); // 5 minute cache
      const projectsNeedingSyncSet = new Set(projectsNeedingSync.map(p => p.identifier));

      const activeProjects = hulyProjects.filter(project => {
        const identifier = project.identifier || project.name;
        return projectsNeedingSyncSet.has(identifier);
      });

      const skippedCount = hulyProjects.length - activeProjects.length;
      projectsToProcess = activeProjects;

      if (skippedCount > 0) {
        console.log(`[Skip] ${skippedCount} empty projects (cached in database)`);
      }
    }

    // Function to process a single project
    const processProject = async (hulyProject) => {
      try {
        console.log(`\n--- Processing Huly project: ${hulyProject.name} ---`);

        const projectIdentifier = hulyProject.identifier || hulyProject.name;
        const filesystemPath = extractFilesystemPath(hulyProject.description);
        
        // Compute description hash for change detection
        const { SyncDatabase } = await import('./lib/database.js');
        const descriptionHash = SyncDatabase.computeDescriptionHash(hulyProject.description);

        // Upsert project to database with description hash
        db.upsertProject({
          identifier: projectIdentifier,
          name: hulyProject.name,
          filesystem_path: filesystemPath,
          description_hash: descriptionHash,
        });

        // Check if project exists in Vibe (case-insensitive)
        let vibeProject = vibeProjectsByName.get(hulyProject.name.toLowerCase());

        if (!vibeProject) {
          // Try to create the project via HTTP API
          console.log(`[Vibe] Project not found, attempting to create: ${hulyProject.name}`);
          const createdProject = await createVibeProject(hulyProject);

          if (createdProject) {
            vibeProject = createdProject;
            // Add to map for subsequent iterations
            vibeProjectsByName.set(hulyProject.name.toLowerCase(), vibeProject);

            // Update database with Vibe ID
            db.upsertProject({
              identifier: projectIdentifier,
              name: hulyProject.name,
              vibe_id: vibeProject.id,
              filesystem_path: filesystemPath,
            });
          } else {
            console.log(`[Skip] Could not create project: ${hulyProject.name}`);
            return { success: false, project: hulyProject.name };
          }
        } else {
          console.log(`[Vibe] ✓ Found existing project: ${hulyProject.name}`);

          // Update database with Vibe ID
          db.upsertProject({
            identifier: projectIdentifier,
            name: hulyProject.name,
            vibe_id: vibeProject.id,
            filesystem_path: filesystemPath,
          });
        }

        // Ensure Letta PM agent (if Letta is enabled)
        if (lettaService && !config.sync.dryRun) {
          try {
            const lettaInfo = db.getProjectLettaInfo(projectIdentifier);
            
            // ALWAYS call ensureAgent - it will reuse existing or create new
            console.log(`[Letta] Ensuring PM agent for project: ${hulyProject.name}`);
            const agent = await lettaService.ensureAgent(projectIdentifier, hulyProject.name);
            
            // CRITICAL: Always persist to database, whether new or reused
            // This ensures DB stays in sync even if agent was found by name
            db.setProjectLettaAgent(projectIdentifier, { agentId: agent.id });
            lettaService.saveAgentId(projectIdentifier, agent.id);
            
            // Save agent ID to project's .letta folder (for letta CLI)
            if (filesystemPath && fs.existsSync(filesystemPath)) {
              lettaService.saveAgentIdToProjectFolder(filesystemPath, agent.id);
            }
            
            console.log(`[Letta] ✓ Agent ensured and persisted: ${agent.id}`);
            
            // Sync tools from control agent (if enabled)
            if (process.env.LETTA_SYNC_TOOLS_FROM_CONTROL === 'true') {
              try {
                console.log(`[Letta] Syncing tools from control agent...`);
                const forceSync = process.env.LETTA_SYNC_TOOLS_FORCE === 'true';
                const syncResult = await lettaService.syncToolsFromControl(agent.id, forceSync);
                
                if (syncResult.attached > 0 || syncResult.detached > 0) {
                  console.log(`[Letta] ✓ Tools synced: ${syncResult.attached} attached, ${syncResult.detached} detached`);
                } else {
                  console.log(`[Letta] ✓ Tools already in sync with control agent`);
                }
                
                if (syncResult.errors.length > 0) {
                  console.warn(`[Letta] ⚠️  ${syncResult.errors.length} tool sync errors (check logs)`);
                }
              } catch (syncError) {
                console.error(`[Letta] Error syncing tools from control:`, syncError.message);
                console.error(`[Letta] Continuing with existing tool configuration`);
              }
            }
            
            // Only do first-time setup if this is a new agent (no DB record)
            if (!lettaInfo || !lettaInfo.letta_agent_id) {
              console.log(`[Letta] Performing first-time setup for new agent`);
              
              // Attach MCP tools
              await lettaService.attachMcpTools(
                agent.id,
                config.letta.hulyMcpUrl,
                config.letta.vibeMcpUrl
              );
              
              // Initialize scratchpad for agent working memory
              await lettaService.initializeScratchpad(agent.id);
              
              // Attach project root folder to agent filesystem if path exists
              if (filesystemPath) {
                try {
                  console.log(`[Letta] Attaching project root folder: ${filesystemPath}`);
                  const fsFolder = await lettaService.ensureFolder(`${projectIdentifier}-root`, filesystemPath);
                  await lettaService.attachFolderToAgent(agent.id, fsFolder.id);
                  console.log(`[Letta] ✓ Project root folder attached to agent filesystem`);
                  
                  // Upload project files to folder (first time only)
                  if (process.env.LETTA_UPLOAD_PROJECT_FILES === 'true') {
                    console.log(`[Letta] Discovering and uploading project files...`);
                    const files = await lettaService.discoverProjectFiles(filesystemPath);
                    if (files.length > 0) {
                      await lettaService.uploadProjectFiles(fsFolder.id, filesystemPath, files, 50);
                      console.log(`[Letta] ✓ Project files uploaded to agent folder`);
                    } else {
                      console.log(`[Letta] No files found to upload`);
                    }
                  }
                } catch (fsFolderError) {
                  console.error(`[Letta] Error attaching filesystem folder:`, fsFolderError.message);
                  console.error(`[Letta] Continuing without filesystem folder`);
                }
              }
              
              console.log(`[Letta] ✓ First-time setup complete`);
              // Agent already exists in DB, ensureAgent() already validated and returned it
              console.log(`[Letta] ✓ Using existing agent (already validated by ensureAgent)`);
            }
          } catch (lettaError) {
            console.error(`[Letta] Error ensuring agent for ${hulyProject.name}:`, lettaError.message);
            console.error(`[Letta] Continuing without PM agent for this project`);
          }
        } else if (config.sync.dryRun) {
          console.log(`[Letta] DRY RUN: Would ensure PM agent for project: ${hulyProject.name}`);
        }

        // Fetch issues from both systems (with incremental sync support from database)
        const dbProject = db.getProject(projectIdentifier);
        const lastProjectSync = dbProject?.last_sync_at || lastSync;
        const hulyIssues = await fetchHulyIssues(hulyClient, projectIdentifier, lastProjectSync);
        const vibeTasks = await listVibeTasks(vibeProject.id);

        // Update Letta PM agent memory with project state (after fetching data)
        if (lettaService && !config.sync.dryRun) {
          try {
            const lettaInfo = db.getProjectLettaInfo(projectIdentifier);
            if (lettaInfo && lettaInfo.letta_agent_id) {
              const memoryUpdateStart = Date.now();
              console.log(`\n[Letta] Building project state snapshot for agent ${lettaInfo.letta_agent_id}...`);
              
              // Build all memory blocks
              const projectMeta = buildProjectMeta(
                hulyProject,
                vibeProject,
                filesystemPath,
                getGitUrl(filesystemPath)
              );
              
              const boardConfig = buildBoardConfig();
              const boardMetrics = buildBoardMetrics(hulyIssues, vibeTasks);
              const hotspots = buildHotspots(hulyIssues, vibeTasks);
              const backlogSummary = buildBacklogSummary(hulyIssues, vibeTasks);
              const changeLog = buildChangeLog(
                hulyIssues,
                lastProjectSync,
                db,
                projectIdentifier
              );
              
              // Collect all blocks for upsert
              const memoryBlocks = [
                { label: 'project', value: projectMeta },
                { label: 'board_config', value: boardConfig },
                { label: 'board_metrics', value: boardMetrics },
                { label: 'hotspots', value: hotspots },
                { label: 'backlog_summary', value: backlogSummary },
                { label: 'change_log', value: changeLog },
              ];
              
              // Upsert memory blocks
              await lettaService.upsertMemoryBlocks(lettaInfo.letta_agent_id, memoryBlocks);
              
              // Update last sync timestamp
              db.setProjectLettaSyncAt(projectIdentifier, Date.now());
              
              const memoryUpdateTime = Date.now() - memoryUpdateStart;
              console.log(`[Letta] ✓ Memory updated in ${memoryUpdateTime}ms`);
              
              // Upload README if enabled and filesystem path exists
              if (process.env.LETTA_ATTACH_REPO_DOCS === 'true' && filesystemPath) {
                try {
                  const readmeUploadStart = Date.now();
                  console.log(`[Letta] Checking for README in ${filesystemPath}...`);
                  
                  const path = await import('path');
                  const readmePath = path.join(filesystemPath, 'README.md');
                  
                  // Ensure folder exists
                  const folder = await lettaService.ensureFolder(projectIdentifier);
                  db.setProjectLettaFolderId(projectIdentifier, folder.id);
                  
                  // Ensure source exists
                  const source = await lettaService.ensureSource(`${projectIdentifier}-README`, folder.id);
                  db.setProjectLettaSourceId(projectIdentifier, source.id);
                  
                  // Upload README
                  const fileMetadata = await lettaService.uploadReadme(source.id, readmePath, projectIdentifier);
                  
                  if (fileMetadata) {
                    // Attach source to agent (idempotent)
                    await lettaService.attachSourceToAgent(lettaInfo.letta_agent_id, source.id);
                    
                    const readmeUploadTime = Date.now() - readmeUploadStart;
                    console.log(`[Letta] ✓ README uploaded and attached in ${readmeUploadTime}ms`);
                  } else {
                    console.log(`[Letta] No README found, skipping upload`);
                  }
                } catch (readmeUploadError) {
                  console.error(`[Letta] Error uploading README for ${hulyProject.name}:`, readmeUploadError.message);
                  console.error(`[Letta] Continuing sync without README upload`);
                }
              }
            }
          } catch (lettaMemoryError) {
            console.error(`[Letta] Error updating memory for ${hulyProject.name}:`, lettaMemoryError.message);
            console.error(`[Letta] Continuing sync without memory update`);
          }
        } else if (config.sync.dryRun) {
          console.log(`[Letta] DRY RUN: Would update PM agent memory with current state`);
        }

        // Update project activity in database
        db.updateProjectActivity(projectIdentifier, hulyIssues.length);

        console.log(`\n[Sync] Huly: ${hulyIssues.length} issues, Vibe: ${vibeTasks.length} tasks`);

        // Track tasks updated in Phase 1 to skip in Phase 2
        const phase1UpdatedTasks = new Set();

        // Phase 1: Sync Huly → Vibe (create missing tasks)
        console.log('[Phase 1] Syncing Huly → Vibe...');
        const vibeTasksByTitle = new Map(vibeTasks.map(t => [t.title.toLowerCase(), t]));

        for (const hulyIssue of hulyIssues) {
          // Skip issues without titles
          if (!hulyIssue.title) {
            console.log(`[Skip] Issue ${hulyIssue.identifier} has no title`);
            continue;
          }

          // Get last known status from database BEFORE updating
          const dbIssue = db.getIssue(hulyIssue.identifier);
          const lastKnownHulyStatus = dbIssue?.status;

          // Save issue to database
          db.upsertIssue({
            identifier: hulyIssue.identifier,
            project_identifier: projectIdentifier,
            title: hulyIssue.title,
            description: hulyIssue.description,
            status: hulyIssue.status,
            priority: hulyIssue.priority,
          });

          const existingTask = vibeTasksByTitle.get(hulyIssue.title.toLowerCase());

          if (!existingTask) {
            const createdTask = await createVibeTask(vibeClient, vibeProject.id, hulyIssue);

            if (createdTask) {
              // Update database with Vibe task ID
              db.upsertIssue({
                identifier: hulyIssue.identifier,
                project_identifier: projectIdentifier,
                vibe_task_id: createdTask.id,
              });
            }
          } else {
            // Task exists, check if description needs updating
            const hulyIdentifier = extractHulyIdentifier(existingTask.description);
            if (!hulyIdentifier || hulyIdentifier !== hulyIssue.identifier) {
              // Update description to include Huly identifier
              console.log(`[Vibe] Updating task "${existingTask.title}" with Huly identifier`);
              // We could add update logic here if needed
            }

            // Check if description changed in Huly
            const fullHulyDescription = `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.identifier}`;
            if (existingTask.description !== fullHulyDescription) {
              // Description changed - check if Huly changed or just initial sync
              const dbIssueDesc = dbIssue?.description;
              if (dbIssueDesc && dbIssueDesc !== hulyIssue.description) {
                // Huly description changed - update Vibe
                console.log(`[Huly→Vibe] Updating task "${existingTask.title}" description`);
                await updateVibeTaskDescription(vibeClient, existingTask.id, fullHulyDescription);
                phase1UpdatedTasks.add(existingTask.id);
              }
            }

            // Check for status conflicts
            const vibeStatus = mapHulyStatusToVibe(hulyIssue.status);
            const lastKnownVibeStatus = dbIssue ? mapHulyStatusToVibe(lastKnownHulyStatus) : null;

            // Determine if statuses are currently in sync
            const statusesMatch = vibeStatus === existingTask.status;

            if (!dbIssue || !lastKnownHulyStatus) {
              // First time seeing this issue - sync Huly → Vibe if they don't match
              if (!statusesMatch) {
                console.log(`[Huly→Vibe] First sync for "${existingTask.title}": ${existingTask.status} → ${vibeStatus}`);
                await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus);
              }
            } else {
              // We have history - check what changed
              const hulyChanged = hulyIssue.status !== lastKnownHulyStatus;
              const vibeChanged = existingTask.status !== lastKnownVibeStatus;

              if (hulyChanged && vibeChanged) {
                // Both changed - conflict! Huly wins
                console.log(`[Conflict] Both systems changed "${existingTask.title}". Huly wins: ${hulyIssue.status}`);
                if (!statusesMatch) {
                  await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus);
                  phase1UpdatedTasks.add(existingTask.id);
                }
              } else if (hulyChanged && !vibeChanged) {
                // Only Huly changed - update Vibe
                if (!statusesMatch) {
                  console.log(`[Huly→Vibe] Updating task "${existingTask.title}" status: ${existingTask.status} → ${vibeStatus}`);
                  await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus);
                  phase1UpdatedTasks.add(existingTask.id);
                }
              } else if (vibeChanged && !hulyChanged) {
                // Only Vibe changed - will be synced in Phase 2
                console.log(`[Vibe changed] Skipping Huly→Vibe for "${existingTask.title}", will sync Vibe→Huly in Phase 2`);
              } else {
                // Neither changed - no action needed
              }
            }

            // Update database with Vibe task ID and current Huly status
            db.upsertIssue({
              identifier: hulyIssue.identifier,
              project_identifier: projectIdentifier,
              status: hulyIssue.status,  // Save current Huly status
              vibe_task_id: existingTask.id,
            });
          }

          // Small delay to avoid overwhelming the API (configurable)
          await new Promise(resolve => setTimeout(resolve, config.sync.apiDelay));
        }

        // Phase 2: Sync Vibe → Huly (update statuses)
        console.log('[Phase 2] Syncing Vibe → Huly...');
        for (const vibeTask of vibeTasks) {
          await syncVibeTaskToHuly(hulyClient, vibeTask, hulyIssues, projectIdentifier, phase1UpdatedTasks);

          // Small delay to avoid overwhelming the API (configurable)
          await new Promise(resolve => setTimeout(resolve, config.sync.apiDelay));
        }

        return { success: true, project: hulyProject.name };
      } catch (error) {
        console.error(`\n[ERROR] Failed to process project ${hulyProject.name}:`, error.message);
        console.log('[INFO] Continuing with next project...');
        return { success: false, project: hulyProject.name, error: error.message };
      }
    };

    // Process projects (parallel or sequential based on config)
    let results;
    if (config.sync.parallel) {
      console.log(`[Sync] Processing ${projectsToProcess.length} projects in parallel (max ${config.sync.maxWorkers} workers)...`);
      results = await processBatch(projectsToProcess, config.sync.maxWorkers, processProject);
    } else {
      console.log(`[Sync] Processing ${projectsToProcess.length} projects sequentially...`);
      results = [];
      for (const project of projectsToProcess) {
        const result = await processProject(project);
        results.push({ status: 'fulfilled', value: result });
      }
    }

    // Count successful and failed projects
    const projectsProcessed = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const projectsFailed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
    const errors = results
      .filter(r => r.value?.error)
      .map(r => ({ project: r.value.project, error: r.value.error }));

    console.log('\n' + '='.repeat(60));
    console.log(`Bidirectional sync completed at ${new Date().toISOString()}`);
    console.log(`Processed ${projectsProcessed}/${projectsToProcess.length} projects successfully`);
    if (projectsFailed > 0) {
      console.log(`Failed: ${projectsFailed} projects`);
    }
    if (config.sync.skipEmpty && projectsToProcess.length < hulyProjects.length) {
      console.log(`Skipped: ${hulyProjects.length - projectsToProcess.length} cached empty projects`);
    }
    console.log('='.repeat(60));

    // Save sync completion to database
    db.setLastSync(syncStartTime);
    db.completeSyncRun(syncId, {
      projectsProcessed,
      projectsFailed,
      issuesSynced: 0, // Could track this
      errors,
      durationMs: Date.now() - syncStartTime,
    });

    // Show database stats
    const dbStats = db.getStats();
    console.log(`[DB] Stats: ${dbStats.activeProjects} active, ${dbStats.emptyProjects} empty, ${dbStats.totalIssues} total issues`);
    console.log(`[Sync] State saved - Next sync will be incremental from ${new Date(syncStartTime).toISOString()}`);
  } catch (error) {
    console.error('\n[ERROR] Sync failed:', error);

    // Record failed sync in database
    db.completeSyncRun(syncId, {
      projectsProcessed: 0,
      projectsFailed: 0,
      errors: [{ error: error.message }],
      durationMs: Date.now() - syncStartTime,
    });
  } finally {
    clearInterval(heartbeatInterval);
  }
}

/**
 * Health check HTTP server
 * Provides /health endpoint for monitoring
 */
function startHealthServer() {
  const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3099');
  
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      const uptime = Date.now() - healthStats.startTime;
      const health = {
        status: 'healthy',
        service: 'huly-vibe-sync',
        version: '1.0.0',
        uptime: {
          milliseconds: uptime,
          seconds: Math.floor(uptime / 1000),
          human: formatDuration(uptime),
        },
        sync: {
          lastSyncTime: healthStats.lastSyncTime 
            ? new Date(healthStats.lastSyncTime).toISOString() 
            : null,
          lastSyncDuration: healthStats.lastSyncDuration 
            ? `${healthStats.lastSyncDuration}ms` 
            : null,
          totalSyncs: healthStats.syncCount,
          errorCount: healthStats.errorCount,
          successRate: healthStats.syncCount > 0 
            ? `${(((healthStats.syncCount - healthStats.errorCount) / healthStats.syncCount) * 100).toFixed(2)}%`
            : 'N/A',
        },
        lastError: healthStats.lastError 
          ? {
              message: healthStats.lastError.message,
              timestamp: new Date(healthStats.lastError.timestamp).toISOString(),
              age: formatDuration(Date.now() - healthStats.lastError.timestamp),
            }
          : null,
        config: {
          syncInterval: `${config.sync.interval / 1000}s`,
          apiDelay: `${config.sync.apiDelay}ms`,
          parallelSync: config.sync.parallel,
          maxWorkers: config.sync.maxWorkers,
          dryRun: config.sync.dryRun,
          lettaEnabled: !!config.letta.enabled,
        },
        memory: {
          rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
        },
        connectionPool: getPoolStats(),
      };
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } else if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Huly-Vibe Sync Service\nHealth check: /health');
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  
  server.listen(HEALTH_PORT, () => {
    console.log(`[Health] Health check endpoint running at http://localhost:${HEALTH_PORT}/health`);
  });
  
  return server;
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * List tasks for a Vibe project (using HTTP API)
 */
async function listVibeTasks(projectId) {
  try {
    const response = await fetchWithPool(`${config.vibeKanban.apiUrl}/tasks?project_id=${projectId}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Failed to list tasks');
    }

    return result.data || [];
  } catch (error) {
    console.error(`[Vibe] Error listing tasks for project ${projectId}:`, error.message);
    return [];
  }
}

/**
 * Start the sync service
 */
async function main() {
  console.log('\nStarting sync service...\n');

  // Initialize Huly client (REST API or MCP)
  let hulyClient;
  if (config.huly.useRestApi) {
    console.log('[Huly] Using REST API client');
    console.log(`  - API URL: ${config.huly.apiUrl}`);
    hulyClient = createHulyRestClient(config.huly.apiUrl, { name: 'Huly REST' });
  } else {
    console.log('[Huly] Using MCP client');
    console.log(`  - MCP URL: ${config.huly.apiUrl}`);
    hulyClient = new MCPClient(config.huly.apiUrl, 'Huly');
  }

  // Vibe Kanban uses REST API (no client initialization needed)
  const vibeClient = null; // Not used when using REST API
  console.log('[Vibe] Using REST API');
  console.log(`  - API URL: ${config.vibeKanban.apiUrl}\n`);

  // Initialize Huly client
  try {
    await hulyClient.initialize();
  } catch (error) {
    console.error('\n[ERROR] Failed to initialize Huly client:', error);
    process.exit(1);
  }

  console.log('\n[✓] All clients initialized successfully\n');

  // Start health check server
  startHealthServer();

  // Wrapper function to run sync with timeout
  const runSyncWithTimeout = async () => {
    const syncStartTime = Date.now();
    try {
      await withTimeout(
        syncHulyToVibe(hulyClient, vibeClient),
        900000, // 15-minute timeout for entire sync
        'Full sync cycle'
      );
      
      // Update health stats on success
      healthStats.lastSyncTime = Date.now();
      healthStats.lastSyncDuration = Date.now() - syncStartTime;
      healthStats.syncCount++;
      
      // Clear Letta cache after successful sync to prevent memory leak
      if (lettaService) {
        lettaService.clearCache();
      }
    } catch (error) {
      console.error('\n[TIMEOUT] Sync exceeded 15-minute timeout:', error.message);
      console.log('[INFO] Will retry in next cycle...\n');
      
      // Update health stats on error
      healthStats.errorCount++;
      healthStats.lastError = {
        message: error.message,
        timestamp: Date.now(),
      };
      
      // Clear cache even on error to prevent memory buildup
      if (lettaService) {
        lettaService.clearCache();
      }
    }
  };

  // Run initial sync
  await runSyncWithTimeout();

  // Schedule periodic syncs
  if (config.sync.interval > 0) {
    console.log(`\nScheduling syncs every ${config.sync.interval / 1000} seconds...`);
    setInterval(runSyncWithTimeout, config.sync.interval);
  } else {
    console.log('\nOne-time sync completed. Exiting...');
    process.exit(0);
  }
}

// Run the service
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
