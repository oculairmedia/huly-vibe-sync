#!/usr/bin/env node

/**
 * Huly → Vibe Kanban Sync Service
 *
 * Syncs projects and issues from Huly to Vibe Kanban
 * Uses Huly REST API and Vibe Kanban MCP servers
 *
 * Delegates to:
 * - lib/MCPClient.js — MCP protocol client
 * - lib/SyncController.js — sync mutex/debounce control
 * - lib/EventHandlers.js — webhook/SSE/file-change event handlers
 * - lib/SchedulerSetup.js — Temporal scheduled sync + reconciliation
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

import { createHulyRestClient } from './lib/HulyRestClient.js';
import { createVibeRestClient } from './lib/VibeRestClient.js';
import { createSyncDatabase, migrateFromJSON } from './lib/database.js';
import { loadConfig, getConfigSummary, isLettaEnabled } from './lib/config.js';
import { initializeHealthStats } from './lib/HealthService.js';
import { createApiServer } from './lib/ApiServer.js';
import { createWebhookHandler } from './lib/HulyWebhookHandler.js';
import { createLettaService } from './lib/LettaService.js';
import { createLettaCodeService } from './lib/LettaCodeService.js';
import { FileWatcher } from './lib/FileWatcher.js';
import { CodePerceptionWatcher } from './lib/CodePerceptionWatcher.js';
import { createAstMemorySync } from './lib/AstMemorySync.js';
import { logger } from './lib/logger.js';
import { createBeadsWatcher } from './lib/BeadsWatcher.js';
import { createBookStackWatcher } from './lib/BookStackWatcher.js';
import { createVibeEventWatcher } from './lib/VibeEventWatcher.js';
import { MCPClient } from './lib/MCPClient.js';
import { createSyncController } from './lib/SyncController.js';
import { createEventHandlers } from './lib/EventHandlers.js';
import { setupScheduler } from './lib/SchedulerSetup.js';

// Temporal orchestration (lazy-loaded)
let temporalOrchestration = null;
const USE_TEMPORAL_ORCHESTRATION = process.env.USE_TEMPORAL_ORCHESTRATION === 'true';

async function getTemporalOrchestration() {
  if (!temporalOrchestration && USE_TEMPORAL_ORCHESTRATION) {
    try {
      const {
        executeFullSync,
        scheduleFullSync,
        startScheduledSync,
        stopScheduledSync,
        getActiveScheduledSync,
        restartScheduledSync,
        isScheduledSyncActive,
        executeDataReconciliation,
        startScheduledReconciliation,
        stopScheduledReconciliation,
        getActiveScheduledReconciliation,
        isTemporalAvailable,
      } = await import('./temporal/dist/client.js');

      if (await isTemporalAvailable()) {
        temporalOrchestration = {
          executeFullSync,
          scheduleFullSync,
          startScheduledSync,
          stopScheduledSync,
          getActiveScheduledSync,
          restartScheduledSync,
          isScheduledSyncActive,
          executeDataReconciliation,
          startScheduledReconciliation,
          stopScheduledReconciliation,
          getActiveScheduledReconciliation,
        };
        console.log('[Main] Temporal orchestration enabled');
      } else {
        console.warn('[Main] Temporal not available, using legacy sync');
      }
    } catch (err) {
      console.warn('[Main] Failed to load Temporal orchestration:', err.message);
    }
  }
  return temporalOrchestration;
}

// Temporal workflow triggers for bidirectional sync (CommonJS module)
const require = createRequire(import.meta.url);
let triggerSyncFromVibe,
  triggerSyncFromHuly,
  triggerSyncFromBeads,
  triggerBidirectionalSync,
  isTemporalAvailable;
try {
  const temporalTrigger = require('./temporal/dist/trigger.js');
  triggerSyncFromVibe = temporalTrigger.triggerSyncFromVibe;
  triggerSyncFromHuly = temporalTrigger.triggerSyncFromHuly;
  triggerSyncFromBeads = temporalTrigger.triggerSyncFromBeads;
  triggerBidirectionalSync = temporalTrigger.triggerBidirectionalSync;
  isTemporalAvailable = temporalTrigger.isTemporalAvailable;
} catch (err) {
  console.warn('[Temporal] Failed to load trigger module:', err.message);
  isTemporalAvailable = async () => false;
  triggerSyncFromVibe = async () => {
    throw new Error('Temporal not available');
  };
  triggerSyncFromHuly = async () => {
    throw new Error('Temporal not available');
  };
  triggerSyncFromBeads = async () => {
    throw new Error('Temporal not available');
  };
  triggerBidirectionalSync = async () => {
    throw new Error('Temporal not available');
  };
}

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load and validate configuration
const config = loadConfig();

// Health tracking
const healthStats = initializeHealthStats();

// Database initialization
const DB_PATH = path.join(__dirname, 'logs', 'sync-state.db');
const SYNC_STATE_FILE = path.join(__dirname, 'logs', '.sync-state.json');

let db;
try {
  db = createSyncDatabase(DB_PATH);
  logger.info({ dbPath: DB_PATH }, 'Database initialized successfully');
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

// Initialize Letta Code service
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

// Initialize BookStack service (if enabled)
let bookstackService = null;
if (config.bookstack?.enabled) {
  try {
    const { createBookStackService } = await import('./lib/BookStackService.js');
    bookstackService = createBookStackService(config.bookstack, db);
    await bookstackService.initialize();
    logger.info('BookStack sync service initialized');
  } catch (bookstackError) {
    logger.warn(
      { err: bookstackError },
      'Failed to initialize BookStack service, documentation sync disabled'
    );
  }
} else {
  logger.info('BookStack sync disabled (USE_BOOKSTACK_SYNC not set)');
}

healthStats.bookstack = bookstackService
  ? {
      enabled: true,
      url: config.bookstack.url,
      mappings: config.bookstack.projectBookMappings.length,
    }
  : { enabled: false };

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

let codePerceptionWatcher = null;
let astMemorySync = null;

if (config.graphiti?.enabled && config.codePerception?.enabled) {
  try {
    codePerceptionWatcher = new CodePerceptionWatcher({
      config,
      db,
      debounceMs: config.codePerception.debounceMs,
      batchSize: config.codePerception.batchSize,
      maxFileSizeKb: config.codePerception.maxFileSizeKb,
    });
    logger.info('CodePerceptionWatcher initialized - realtime Graphiti sync enabled');

    codePerceptionWatcher.syncWatchedProjects().catch(err => {
      logger.warn({ err }, 'Initial code perception watcher sync failed');
    });
  } catch (codePerceptionError) {
    logger.warn({ err: codePerceptionError }, 'Failed to initialize CodePerceptionWatcher');
  }
}

if (codePerceptionWatcher && lettaService) {
  astMemorySync = createAstMemorySync({
    codePerceptionWatcher,
    lettaService,
    db,
  });
  codePerceptionWatcher.onFileChange = (projectId, filePath, changeType) => {
    astMemorySync.recordFileChange(projectId, filePath, changeType);
  };
  logger.info('AstMemorySync initialized - PM agents will receive codebase summaries');
}

// Temporal workflow orchestration status
let temporalEnabled = false;

logger.info({ service: 'huly-vibe-sync' }, 'Service starting');
logger.info({ config: getConfigSummary(config) }, 'Configuration loaded');

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

  // Check Temporal availability
  try {
    temporalEnabled = await isTemporalAvailable();
    if (temporalEnabled) {
      logger.info('✓ Temporal server available - bidirectional sync via workflows enabled');
    } else {
      logger.warn('✗ Temporal server not available - using legacy sync');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to check Temporal availability - using legacy sync');
    temporalEnabled = false;
  }

  // Track sync interval timer (for dynamic config updates)
  let syncTimer = null;

  // Create SyncController
  const syncController = createSyncController({
    config,
    healthStats,
    lettaService,
    fileWatcher,
    codePerceptionWatcher,
    astMemorySync,
    getTemporalOrchestration,
    getSyncTimer: () => syncTimer,
    setSyncTimer: t => { syncTimer = t; },
  });

  // Create EventHandlers
  const eventHandlers = createEventHandlers({
    db,
    temporalEnabled,
    triggerSyncFromHuly,
    triggerSyncFromVibe,
    triggerSyncFromBeads,
    runSyncWithTimeout: syncController.runSyncWithTimeout,
    bookstackService,
  });

  // Initialize webhook handler
  const webhookHandler = createWebhookHandler({
    db,
    onChangesReceived: eventHandlers.handleWebhookChanges,
  });

  const subscribed = await webhookHandler.subscribe();
  if (subscribed) {
    logger.info('✓ Subscribed to Huly change watcher for real-time updates');
    logger.info('✓ Polling disabled - using webhook-based change detection');
  } else {
    logger.warn('✗ Failed to subscribe to change watcher, will rely on polling');
  }

  // Initialize Beads file watcher
  const beadsWatcher = createBeadsWatcher({
    db,
    onBeadsChange: eventHandlers.handleBeadsChange,
    debounceDelay: 2000,
  });

  const beadsWatchResult = await beadsWatcher.syncWithDatabase();
  if (beadsWatchResult.watching > 0) {
    logger.info(
      { watching: beadsWatchResult.watching, available: beadsWatchResult.available },
      '✓ Beads file watcher active for real-time Beads→Huly sync'
    );
  }

  // Initialize BookStack file watcher
  let bookstackWatcher = null;
  if (bookstackService && config.bookstack?.enabled) {
    bookstackWatcher = createBookStackWatcher({
      db,
      bookstackService,
      onBookStackChange: eventHandlers.handleBookStackChange,
      debounceDelay: 2000,
    });

    const bookstackWatchResult = await bookstackWatcher.syncWithDatabase();
    if (bookstackWatchResult.watching > 0) {
      logger.info(
        { watching: bookstackWatchResult.watching, available: bookstackWatchResult.available },
        '✓ BookStack file watcher active for real-time local→BookStack import'
      );
    }
  }

  // Initialize Vibe SSE event watcher
  const vibeEventWatcher = createVibeEventWatcher({
    db,
    onTaskChange: eventHandlers.handleVibeChange,
  });

  const vibeConnected = await vibeEventWatcher.start();
  if (vibeConnected) {
    logger.info('✓ Vibe SSE watcher active for real-time Vibe→Huly sync');
  } else {
    logger.warn('✗ Failed to connect to Vibe SSE stream, Vibe changes may not sync in real-time');
  }

  // Start API server
  createApiServer({
    config,
    healthStats,
    db,
    onSyncTrigger: syncController.handleSyncTrigger,
    onConfigUpdate: syncController.handleConfigUpdate,
    lettaCodeService,
    webhookHandler,
    getTemporalClient: getTemporalOrchestration,
    codePerceptionWatcher,
  });

  // Run initial sync
  await syncController.runSyncWithTimeout();

  // Schedule periodic syncs
  await setupScheduler({
    config,
    subscribed,
    getTemporalOrchestration,
    runSyncWithTimeout: syncController.runSyncWithTimeout,
    setSyncTimer: t => { syncTimer = t; },
  });
}

// Run the service
main().catch(error => {
  logger.fatal({ err: error }, 'Fatal error, exiting');
  process.exit(1);
});
