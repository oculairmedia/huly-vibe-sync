#!/usr/bin/env node

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

import { createSyncDatabase } from './lib/database.js';
import { loadConfig, getConfigSummary, isLettaEnabled } from './lib/config.js';
import { initializeHealthStats } from './lib/HealthService.js';
import { createApiServer } from './lib/ApiServer.js';
import { createLettaService } from './lib/LettaService.js';
import { FileWatcher } from './lib/FileWatcher.js';
import { CodePerceptionWatcher } from './lib/CodePerceptionWatcher.js';
import { createAstMemorySync } from './lib/AstMemorySync.js';
import { logger } from './lib/logger.js';
import { createBookStackWatcher } from './lib/BookStackWatcher.js';
import { ProjectRegistry } from './lib/ProjectRegistry.js';

import { createSyncController } from './lib/SyncController.js';
import { createEventHandlers } from './lib/EventHandlers.js';
import { setupScheduler } from './lib/SchedulerSetup.js';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = loadConfig();

const healthStats = initializeHealthStats();

const DB_PATH = path.join(__dirname, 'logs', 'sync-state.db');

let db;
try {
  db = createSyncDatabase(DB_PATH);
  logger.info({ dbPath: DB_PATH }, 'Database initialized successfully');
} catch (dbError) {
  logger.error({ err: dbError }, 'Failed to initialize database, exiting');
  process.exit(1);
}

let projectRegistry = null;
try {
  projectRegistry = new ProjectRegistry({ db, logger });
  const scanResult = projectRegistry.scanProjects();
  logger.info(
    { discovered: scanResult.discovered, updated: scanResult.updated },
    'ProjectRegistry initial scan complete'
  );
} catch (registryError) {
  logger.warn(
    { err: registryError },
    'Failed to initialize ProjectRegistry, continuing without it'
  );
}

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

logger.info({ service: 'huly-vibe-sync' }, 'Service starting');
logger.info({ config: getConfigSummary(config) }, 'Configuration loaded');

async function main() {
  logger.info('Starting sync service');

  let syncTimer = null;

  const syncController = createSyncController({
    config,
    healthStats,
    lettaService,
    fileWatcher,
    codePerceptionWatcher,
    astMemorySync,
    getTemporalOrchestration,
    getSyncTimer: () => syncTimer,
    setSyncTimer: t => {
      syncTimer = t;
    },
  });

  const eventHandlers = createEventHandlers({
    db,
    runSyncWithTimeout: syncController.runSyncWithTimeout,
    bookstackService,
  });

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
        'BookStack file watcher active for real-time local→BookStack import'
      );
    }
  }

  createApiServer({
    config,
    healthStats,
    db,
    onSyncTrigger: syncController.handleSyncTrigger,
    onConfigUpdate: syncController.handleConfigUpdate,
    getTemporalClient: getTemporalOrchestration,
    codePerceptionWatcher,
    projectRegistry,
  });

  await syncController.runSyncWithTimeout();

  await setupScheduler({
    config,
    subscribed: false,
    getTemporalOrchestration,
    runSyncWithTimeout: syncController.runSyncWithTimeout,
    setSyncTimer: t => {
      syncTimer = t;
    },
  });
}

main().catch(error => {
  logger.fatal({ err: error }, 'Fatal error, exiting');
  process.exit(1);
});
