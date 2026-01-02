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
import { Mutex } from 'async-mutex';
import pDebounce from 'p-debounce';
import http from 'http';
import { createHulyRestClient } from './lib/HulyRestClient.js';
import { createVibeRestClient } from './lib/VibeRestClient.js';
import { createSyncDatabase, migrateFromJSON } from './lib/database.js';
import { fetchWithPool, getPoolStats } from './lib/http.js';
import { withTimeout, processBatch, formatDuration } from './lib/utils.js';
import {
  extractFilesystemPath,
  extractFullDescription,
  extractHulyIdentifier,
  getGitUrl,
  determineGitRepoPath,
} from './lib/textParsers.js';
import {
  mapHulyStatusToVibe,
  mapVibeStatusToHuly,
  normalizeStatus,
  areStatusesEquivalent,
} from './lib/statusMapper.js';
import { loadConfig, getConfigSummary, isLettaEnabled } from './lib/config.js';
import {
  createHulyService,
  fetchHulyProjects,
  fetchHulyIssues,
  updateHulyIssueStatus,
  updateHulyIssueDescription,
} from './lib/HulyService.js';
import { syncHulyToVibe } from './lib/SyncOrchestrator.js';
import {
  createVibeService,
  listVibeProjects,
  createVibeProject,
  listVibeTasks,
  createVibeTask,
  updateVibeTaskStatus,
  updateVibeTaskDescription,
} from './lib/VibeService.js';
import {
  initializeHealthStats,
  recordSuccessfulSync,
  recordFailedSync,
} from './lib/HealthService.js';
import { createApiServer, broadcastSyncEvent, recordIssueMapping } from './lib/ApiServer.js';
import { createWebhookHandler } from './lib/HulyWebhookHandler.js';
import {
  createLettaService,
  buildProjectMeta,
  buildBoardConfig,
  buildBoardMetrics,
  buildHotspots,
  buildBacklogSummary,
  buildChangeLog,
  buildScratchpad,
} from './lib/LettaService.js';
import { createLettaCodeService } from './lib/LettaCodeService.js';
import { FileWatcher } from './lib/FileWatcher.js';
import { logger } from './lib/logger.js';
import { createBeadsWatcher } from './lib/BeadsWatcher.js';
import { createVibeEventWatcher } from './lib/VibeEventWatcher.js';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load and validate configuration
const config = loadConfig();

// Health tracking
const healthStats = initializeHealthStats();

// Database initialization (replaces JSON file state management)
const DB_PATH = path.join(__dirname, 'logs', 'sync-state.db');
const SYNC_STATE_FILE = path.join(__dirname, 'logs', '.sync-state.json'); // For migration

// Initialize database
let db;
try {
  db = createSyncDatabase(DB_PATH);
  logger.info({ dbPath: DB_PATH }, 'Database initialized successfully');

  // One-time migration from JSON to SQLite
  migrateFromJSON(db, SYNC_STATE_FILE);
} catch (dbError) {
  logger.error({ err: dbError }, 'Failed to initialize database, exiting');
  process.exit(1);
}

// Initialize Letta service (if configured)
let lettaService = null;
if (isLettaEnabled(config)) {
  try {
    lettaService = createLettaService();
    logger.info('Letta service initialized successfully');
  } catch (lettaError) {
    logger.warn(
      { err: lettaError },
      'Failed to initialize Letta service, PM agent integration disabled'
    );
  }
} else {
  logger.info('Letta PM agent integration disabled (credentials not set)');
}

// Initialize Letta Code service for filesystem-based agent operations
let lettaCodeService = null;
try {
  lettaCodeService = createLettaCodeService({
    lettaBaseUrl: config.letta.baseURL,
    lettaApiKey: config.letta.password,
    projectRoot: config.stacks.baseDir || '/opt/stacks',
    stateDir: path.join(__dirname, '.letta-code'),
  });
  logger.info('Letta Code service initialized successfully');
} catch (lettaCodeError) {
  logger.warn(
    { err: lettaCodeError },
    'Failed to initialize Letta Code service, filesystem mode disabled'
  );
}

// Initialize FileWatcher for realtime file change detection
let fileWatcher = null;
if (lettaService && process.env.LETTA_FILE_WATCH !== 'false') {
  try {
    fileWatcher = new FileWatcher(lettaService, db, {
      debounceMs: parseInt(process.env.LETTA_FILE_WATCH_DEBOUNCE || '1000', 10),
      batchIntervalMs: parseInt(process.env.LETTA_FILE_WATCH_BATCH_INTERVAL || '5000', 10),
    });
    logger.info('FileWatcher initialized - realtime file sync enabled');
  } catch (fileWatchError) {
    logger.warn(
      { err: fileWatchError },
      'Failed to initialize FileWatcher, falling back to periodic sync'
    );
  }
}

logger.info({ service: 'huly-vibe-sync' }, 'Service starting');
logger.info({ config: getConfigSummary(config) }, 'Configuration loaded');

// Utility functions imported from lib/utils.js

// Simple MCP client with session support
class MCPClient {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.requestId = 1;
    this.sessionId = null;
  }

  async initialize() {
    logger.debug({ client: this.name }, 'Initializing MCP session');

    // Initialize session
    const initResult = await this.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'huly-vibe-sync',
        version: '1.0.0',
      },
    });

    logger.info({ client: this.name }, 'MCP session initialized successfully');
    return initResult;
  }

  async call(method, params = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
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
    const newSessionId =
      response.headers.get('mcp-session-id') ||
      response.headers.get('Mcp-Session-Id') ||
      response.headers.get('X-Session-ID');
    if (newSessionId && !this.sessionId) {
      this.sessionId = newSessionId;
      logger.debug({ client: this.name, sessionId: newSessionId }, 'MCP session ID received');
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
 * Parse issues from Huly MCP text response (legacy - kept for MCP compatibility)
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
 * Start the sync service
 */
async function main() {
  logger.info('Starting sync service');

  // Initialize Huly client (REST API or MCP)
  let hulyClient;
  if (config.huly.useRestApi) {
    logger.info({ apiUrl: config.huly.apiUrl }, 'Using Huly REST API client');
    hulyClient = createHulyRestClient(config.huly.apiUrl, { name: 'Huly REST' });
  } else {
    logger.info({ mcpUrl: config.huly.apiUrl }, 'Using Huly MCP client');
    hulyClient = new MCPClient(config.huly.apiUrl, 'Huly');
  }

  // Initialize Vibe Kanban REST client
  logger.info({ apiUrl: config.vibeKanban.apiUrl }, 'Using Vibe Kanban REST API client');
  const vibeClient = createVibeRestClient(config.vibeKanban.apiUrl, { name: 'Vibe REST' });

  // Initialize both clients
  try {
    await Promise.all([hulyClient.initialize(), vibeClient.initialize()]);
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize clients, exiting');
    process.exit(1);
  }

  logger.info('All clients initialized successfully');

  // Track sync interval timer (for dynamic config updates)
  let syncTimer = null;

  // ============================================================
  // SYNC CONTROL: Mutex + Debounce to prevent sync storms
  // ============================================================
  
  // Per-project mutexes to prevent concurrent syncs for same project
  const syncMutexes = new Map(); // projectId -> Mutex
  const globalSyncMutex = new Mutex(); // For full syncs (projectId = null)
  
  // Get or create mutex for a project
  const getSyncMutex = (projectId) => {
    if (!projectId) return globalSyncMutex;
    if (!syncMutexes.has(projectId)) {
      syncMutexes.set(projectId, new Mutex());
    }
    return syncMutexes.get(projectId);
  };

  // Pending sync requests (for coalescing)
  const pendingSyncs = new Map(); // projectId -> timestamp

  // Core sync function (called by debounced wrapper)
  const runSyncCore = async (projectId = null) => {
    const syncStartTime = Date.now();

    // Broadcast sync started event
    broadcastSyncEvent('sync:started', {
      projectId,
      timestamp: new Date().toISOString(),
    });

    try {
      await withTimeout(
        syncHulyToVibe(hulyClient, vibeClient, db, config, lettaService, projectId),
        900000, // 15-minute timeout for entire sync
        'Full sync cycle'
      );

      // Update health stats on success
      const duration = Date.now() - syncStartTime;
      recordSuccessfulSync(healthStats, duration);

      // Broadcast sync completed event
      broadcastSyncEvent('sync:completed', {
        projectId,
        duration,
        status: 'success',
      });

      // Clear Letta cache after successful sync to prevent memory leak
      if (lettaService) {
        lettaService.clearCache();
      }

      // Sync file watchers to pick up new projects with Letta folders
      if (fileWatcher) {
        fileWatcher.syncWatchedProjects().catch(err => {
          logger.warn({ err }, 'Failed to sync file watchers');
        });
      }
    } catch (error) {
      logger.error(
        { err: error, timeoutMs: 900000 },
        'Sync exceeded 15-minute timeout, will retry in next cycle'
      );

      // Update health stats on error
      recordFailedSync(healthStats, error);

      // Broadcast sync error event
      broadcastSyncEvent('sync:error', {
        projectId,
        error: error.message,
        stack: error.stack,
      });

      // Clear cache even on error to prevent memory buildup
      if (lettaService) {
        lettaService.clearCache();
      }
    }
  };

  // Wrapper with mutex to prevent concurrent syncs for same project
  const runSyncWithMutex = async (projectId = null) => {
    const mutex = getSyncMutex(projectId);
    const key = projectId || 'global';
    
    // Check if sync is already running for this project
    if (mutex.isLocked()) {
      logger.debug({ projectId: key }, 'Sync already in progress, skipping');
      return;
    }

    // Acquire mutex and run sync
    await mutex.runExclusive(async () => {
      logger.info({ projectId: key }, 'Acquired sync lock');
      await runSyncCore(projectId);
    });
  };

  // Debounced sync - waits 3 seconds for triggers to settle before syncing
  // This coalesces rapid webhook/SSE events into a single sync
  const SYNC_DEBOUNCE_MS = 3000;
  const debouncedSyncByProject = new Map(); // projectId -> debounced function
  
  const getDebouncedSync = (projectId) => {
    const key = projectId || 'global';
    if (!debouncedSyncByProject.has(key)) {
      const debounced = pDebounce(async () => {
        await runSyncWithMutex(projectId);
      }, SYNC_DEBOUNCE_MS);
      debouncedSyncByProject.set(key, debounced);
    }
    return debouncedSyncByProject.get(key);
  };

  // Public sync function - debounced + mutex protected
  const runSyncWithTimeout = async (projectId = null) => {
    const key = projectId || 'global';
    logger.debug({ projectId: key }, 'Sync requested (will debounce)');
    pendingSyncs.set(key, Date.now());
    return getDebouncedSync(projectId)();
  };

  // Callback for manual sync trigger via API
  const handleSyncTrigger = async (projectId = null) => {
    logger.info({ projectId }, 'Manual sync triggered via API');
    return runSyncWithTimeout(projectId);
  };

  // Callback for configuration updates via API
  const handleConfigUpdate = updates => {
    logger.info({ updates }, 'Configuration updated via API');

    // If sync interval changed, restart the timer
    if (updates.syncInterval !== undefined && syncTimer) {
      clearInterval(syncTimer);
      logger.info(
        {
          oldInterval: config.sync.interval / 1000,
          newInterval: updates.syncInterval / 1000,
        },
        'Restarting sync timer with new interval'
      );

      syncTimer = setInterval(() => runSyncWithTimeout(), updates.syncInterval);
    }
  };

  // Callback for webhook changes from huly-change-watcher
  const handleWebhookChanges = async changeData => {
    logger.info(
      {
        type: changeData.type,
        changeCount: changeData.changes.length,
        projects: Array.from(changeData.byProject.keys()),
      },
      'Processing changes from webhook'
    );

    // For now, trigger a full sync when changes are detected
    // TODO: Optimize to only sync the specific projects/issues that changed
    await runSyncWithTimeout();

    return { success: true, processed: changeData.changes.length };
  };

  // Initialize webhook handler
  const webhookHandler = createWebhookHandler({
    db,
    onChangesReceived: handleWebhookChanges,
  });

  // Subscribe to change watcher on startup
  const subscribed = await webhookHandler.subscribe();
  if (subscribed) {
    logger.info('✓ Subscribed to Huly change watcher for real-time updates');
    logger.info('✓ Polling disabled - using webhook-based change detection');
  } else {
    logger.warn('✗ Failed to subscribe to change watcher, will rely on polling');
  }

  // Initialize Beads file watcher for .beads directory changes
  const handleBeadsChange = async changeData => {
    logger.info(
      {
        project: changeData.projectIdentifier,
        fileCount: changeData.changedFiles.length,
      },
      'Processing Beads file changes'
    );

    // Trigger sync for the specific project that changed
    await runSyncWithTimeout(changeData.projectIdentifier);

    return { success: true, project: changeData.projectIdentifier };
  };

  const beadsWatcher = createBeadsWatcher({
    db,
    onBeadsChange: handleBeadsChange,
    debounceDelay: 2000, // Wait 2 seconds for changes to settle
  });

  // Start watching all projects with .beads directories
  const beadsWatchResult = await beadsWatcher.syncWithDatabase();
  if (beadsWatchResult.watching > 0) {
    logger.info(
      { watching: beadsWatchResult.watching, available: beadsWatchResult.available },
      '✓ Beads file watcher active for real-time Beads→Huly sync'
    );
  }

  // Initialize Vibe SSE event watcher for real-time Vibe→Huly sync
  const handleVibeChange = async changeData => {
    logger.info(
      {
        vibeProject: changeData.vibeProjectId,
        hulyProject: changeData.hulyProjectIdentifier,
        taskCount: changeData.changedTaskIds.length,
      },
      'Processing Vibe task changes from SSE'
    );

    // Trigger sync for the specific project that changed
    if (changeData.hulyProjectIdentifier) {
      await runSyncWithTimeout(changeData.hulyProjectIdentifier);
    }

    return { success: true, project: changeData.hulyProjectIdentifier };
  };

  const vibeEventWatcher = createVibeEventWatcher({
    db,
    onTaskChange: handleVibeChange,
  });

  const vibeConnected = await vibeEventWatcher.start();
  if (vibeConnected) {
    logger.info('✓ Vibe SSE watcher active for real-time Vibe→Huly sync');
  } else {
    logger.warn('✗ Failed to connect to Vibe SSE stream, Vibe changes may not sync in real-time');
  }

  // Start API server with extended endpoints
  createApiServer({
    config,
    healthStats,
    db,
    onSyncTrigger: handleSyncTrigger,
    onConfigUpdate: handleConfigUpdate,
    lettaCodeService, // Enable filesystem mode for agents
    webhookHandler, // Enable webhook endpoint
  });

  // Run initial sync
  await runSyncWithTimeout();

  // Schedule periodic syncs only if webhooks are not active
  if (subscribed) {
    logger.info('Webhook mode active - periodic polling disabled');
  } else if (config.sync.interval > 0) {
    logger.info({ intervalSeconds: config.sync.interval / 1000 }, 'Scheduling periodic syncs');
    syncTimer = setInterval(() => runSyncWithTimeout(), config.sync.interval);
  } else {
    logger.info('One-time sync completed, exiting');
    process.exit(0);
  }
}

// Run the service
main().catch(error => {
  logger.fatal({ err: error }, 'Fatal error, exiting');
  process.exit(1);
});
