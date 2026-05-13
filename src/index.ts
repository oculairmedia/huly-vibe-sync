#!/usr/bin/env node

import 'dotenv/config';

import { createSyncDatabase } from './database';
import { loadConfig, getConfigSummary, isLettaEnabled } from './config';
import { initializeHealthStats } from './HealthService';
import { createApiServer } from './ApiServer';
import { createLettaService } from './LettaService';
import { FileWatcher } from './FileWatcher';
import { CodePerceptionWatcher } from './CodePerceptionWatcher';
import { createAstMemorySync } from './AstMemorySync';
import { logger } from './logger';
import { createBookStackWatcher } from './BookStackWatcher';
import { ProjectRegistry } from './ProjectRegistry';

import { createSyncController } from './SyncController';
import { createEventHandlers } from './EventHandlers';
import { setupScheduler } from './SchedulerSetup';
import { resolveFromAppRoot } from './runtimePaths';

import type { HealthStats } from './HealthService';
import type { SyncDatabase } from './database';

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let temporalOrchestration: Record<string, (...args: unknown[]) => Promise<unknown>> | null = null;
const USE_TEMPORAL_ORCHESTRATION = process.env.USE_TEMPORAL_ORCHESTRATION === 'true';

async function getTemporalOrchestration(): Promise<Record<string, (...args: unknown[]) => Promise<unknown>> | null> {
  if (!temporalOrchestration && USE_TEMPORAL_ORCHESTRATION) {
    try {
      const temporalModule = (await import('../temporal/dist/client.js')) as Record<string, unknown>;

      if (await (temporalModule.isTemporalAvailable as () => Promise<boolean>)()) {
        temporalOrchestration = {
          executeFullSync: temporalModule.executeFullSync as (...args: unknown[]) => Promise<unknown>,
          scheduleFullSync: temporalModule.scheduleFullSync as (...args: unknown[]) => Promise<unknown>,
          startScheduledSync: temporalModule.startScheduledSync as (...args: unknown[]) => Promise<unknown>,
          stopScheduledSync: temporalModule.stopScheduledSync as (...args: unknown[]) => Promise<unknown>,
          getActiveScheduledSync: temporalModule.getActiveScheduledSync as (...args: unknown[]) => Promise<unknown>,
          restartScheduledSync: temporalModule.restartScheduledSync as (...args: unknown[]) => Promise<unknown>,
          isScheduledSyncActive: temporalModule.isScheduledSyncActive as (...args: unknown[]) => Promise<unknown>,
          executeDataReconciliation: temporalModule.executeDataReconciliation as (...args: unknown[]) => Promise<unknown>,
          startScheduledReconciliation: temporalModule.startScheduledReconciliation as (...args: unknown[]) => Promise<unknown>,
          stopScheduledReconciliation: temporalModule.stopScheduledReconciliation as (...args: unknown[]) => Promise<unknown>,
          getActiveScheduledReconciliation: temporalModule.getActiveScheduledReconciliation as (...args: unknown[]) => Promise<unknown>,
        };
        console.log('[Main] Temporal orchestration enabled');
      } else {
        console.warn('[Main] Temporal not available, using legacy sync');
      }
    } catch (err) {
      console.warn('[Main] Failed to load Temporal orchestration:', formatError(err));
    }
  }
  return temporalOrchestration;
}

const config = loadConfig();

const healthStats: HealthStats = initializeHealthStats();

const DB_PATH = process.env.VIBESYNC_DB_PATH || resolveFromAppRoot('logs', 'sync-state.db');

let db: SyncDatabase;
try {
  db = createSyncDatabase(DB_PATH);
  logger.info({ dbPath: DB_PATH }, 'Database initialized successfully');
} catch (dbError) {
  logger.error({ err: dbError }, 'Failed to initialize database, exiting');
  process.exit(1);
}

let projectRegistry: ProjectRegistry | null = null;
try {
  projectRegistry = new ProjectRegistry({ db, logger } as never);
  const scanResult = projectRegistry.scanProjects();
  logger.info(
    { discovered: scanResult.discovered, updated: scanResult.updated },
    'ProjectRegistry initial scan complete',
  );
} catch (registryError) {
  logger.warn(
    { err: registryError },
    'Failed to initialize ProjectRegistry, continuing without it',
  );
}

let doltHubProvisioner: unknown = null;
if (config.doltHub?.enabled || config.doltHub?.dryRun) {
  try {
    const mod = (await import('./DoltHubProvisioningService.js')) as unknown as {
      createDoltHubProvisioningService: (opts: Record<string, unknown>) => unknown;
    };
    doltHubProvisioner = mod.createDoltHubProvisioningService({
      config: config.doltHub,
      db,
      logger,
    });
    logger.info(
      { dryRun: config.doltHub.dryRun, owner: config.doltHub.owner },
      'DoltHub Beads remote provisioning service initialized',
    );
  } catch (doltHubError) {
    logger.warn(
      { err: doltHubError },
      'Failed to initialize DoltHub provisioning service, Beads remote provisioning disabled',
    );
  }
} else {
  logger.info('DoltHub Beads remote provisioning disabled');
}

let beadsIssueService: unknown = null;
let beadsAdapter: unknown = null;
let beadsIssueMirror: unknown = null;
try {
  const issueMod = (await import('./beads/BeadsIssueService.js')) as unknown as {
    createBeadsIssueService: (opts: Record<string, unknown>) => unknown;
  };
  const adapterMod = (await import('./beads/BeadsAdapter.js')) as unknown as {
    BeadsAdapter: new (opts: Record<string, unknown>) => unknown;
  };
  beadsIssueService = issueMod.createBeadsIssueService({ db, logger });
  beadsAdapter = new adapterMod.BeadsAdapter({ actor: 'vibesync', readonly: true });
  logger.info('Beads issue mutation service initialized');

  if (process.env.BEADS_MIRROR !== 'false') {
    const mirrorMod = await import('./beads/BeadsIssueMirror.js');
    beadsIssueMirror = mirrorMod.createBeadsIssueMirror(
      { db: db as never, beadsAdapter: beadsAdapter as never },
      {
        freshnessMs: parseInt(process.env.BEADS_MIRROR_FRESHNESS_MS || '30000', 10),
      },
    );
    const mirror = beadsIssueMirror as { preloadAll: (opts: { concurrency: number }) => Promise<unknown> };
    mirror.preloadAll({
      concurrency: parseInt(process.env.BEADS_MIRROR_PRELOAD_CONCURRENCY || '4', 10),
    }).catch((err: unknown) => {
      logger.warn({ err }, 'Beads mirror preload failed');
    });
    logger.info('Beads issue mirror initialized (preloading in background)');
  }
} catch (beadsIssueError) {
  logger.warn({ err: beadsIssueError }, 'Failed to initialize Beads issue mutation service');
}

let lettaService: ReturnType<typeof createLettaService> | null = null;
if (isLettaEnabled(config)) {
  try {
    lettaService = createLettaService();
    logger.info('Letta service initialized successfully');
  } catch (lettaError) {
    logger.warn(
      { err: lettaError },
      'Failed to initialize Letta service, PM agent integration disabled',
    );
  }
} else {
  logger.info('Letta PM agent integration disabled (credentials not set)');
}

if (lettaService && process.env.LETTA_AGENT_RECONCILE !== 'false') {
  const { reconcileLettaAgents } = await import('./LettaAgentReconciler.js');
  reconcileLettaAgents(
    db as unknown as Parameters<typeof reconcileLettaAgents>[0],
    lettaService as unknown as Parameters<typeof reconcileLettaAgents>[1],
    {
      concurrency: parseInt(process.env.LETTA_AGENT_RECONCILE_CONCURRENCY || '6', 10),
      timeoutMs: parseInt(process.env.LETTA_AGENT_RECONCILE_TIMEOUT_MS || '5000', 10),
    },
  ).catch((err: unknown) => {
    logger.warn({ err }, 'Letta agent reconciliation failed');
  });
}

let bookstackService: import('./BookStackService').BookStackService | null = null;
if (config.bookstack?.enabled) {
  try {
    const mod = (await import('./BookStackService.js')) as unknown as {
      createBookStackService: (cfg: Record<string, unknown>, db: Record<string, unknown>) => import('./BookStackService').BookStackService;
    };
    bookstackService = mod.createBookStackService(
      config.bookstack as unknown as Record<string, unknown>,
      db as unknown as Record<string, unknown>,
    );
    await bookstackService.initialize();
    logger.info('BookStack sync service initialized');
  } catch (bookstackError) {
    logger.warn(
      { err: bookstackError },
      'Failed to initialize BookStack service, documentation sync disabled',
    );
  }
} else {
  logger.info('BookStack sync disabled (USE_BOOKSTACK_SYNC not set)');
}

healthStats.bookstack = bookstackService ? { enabled: true } : { enabled: false };

let fileWatcher: FileWatcher | null = null;
if (lettaService && process.env.LETTA_FILE_WATCH !== 'false') {
  try {
    fileWatcher = new FileWatcher(
      lettaService as never,
      db as never,
      {
        debounceMs: parseInt(process.env.LETTA_FILE_WATCH_DEBOUNCE || '1000', 10),
        batchIntervalMs: parseInt(process.env.LETTA_FILE_WATCH_BATCH_INTERVAL || '5000', 10),
      },
    );
    logger.info('FileWatcher initialized - realtime file sync enabled');
  } catch (fileWatchError) {
    logger.warn(
      { err: fileWatchError },
      'Failed to initialize FileWatcher, falling back to periodic sync',
    );
  }
}

let codePerceptionWatcher: CodePerceptionWatcher | null = null;
let astMemorySync: ReturnType<typeof createAstMemorySync> | null = null;

if (config.graphiti?.enabled && config.codePerception?.enabled) {
  try {
    codePerceptionWatcher = new CodePerceptionWatcher({
      config: config as never,
      db: db as never,
      debounceMs: config.codePerception.debounceMs,
      batchSize: config.codePerception.batchSize,
      maxFileSizeKb: config.codePerception.maxFileSizeKb,
    });
    logger.info('CodePerceptionWatcher initialized - realtime Graphiti sync enabled');

    codePerceptionWatcher.syncWatchedProjects().catch((err: unknown) => {
      logger.warn({ err }, 'Initial code perception watcher sync failed');
    });
  } catch (codePerceptionError) {
    logger.warn({ err: codePerceptionError }, 'Failed to initialize CodePerceptionWatcher');
  }
}

if (codePerceptionWatcher && lettaService) {
  astMemorySync = createAstMemorySync({
    codePerceptionWatcher: codePerceptionWatcher as never,
    lettaService: lettaService as never,
    db: db as never,
  });
  codePerceptionWatcher.onFileChange = ((projectId: string, filePath: string, changeType: unknown) => {
    astMemorySync?.recordFileChange(projectId, filePath, changeType as never);
  }) as never;
  logger.info('AstMemorySync initialized - PM agents will receive codebase summaries');
}

logger.info({ service: 'vibesync' }, 'Service starting');
logger.info({ config: getConfigSummary(config) }, 'Configuration loaded');

async function main(): Promise<void> {
  logger.info('Starting sync service');

  let syncTimer: ReturnType<typeof setInterval> | null = null;

  const syncController = createSyncController({
    config: { sync: { ...config.sync } },
    healthStats,
    lettaService: lettaService as never,
    fileWatcher: fileWatcher as never,
    codePerceptionWatcher: codePerceptionWatcher as never,
    astMemorySync: astMemorySync as never,
    getTemporalOrchestration: getTemporalOrchestration as never,
    getSyncTimer: () => syncTimer,
    setSyncTimer: (t: ReturnType<typeof setInterval>) => { syncTimer = t; },
  });

  const eventHandlers = createEventHandlers({
    db,
    runSyncWithTimeout: syncController.runSyncWithTimeout,
    bookstackService,
  });

  let bookstackWatcher: ReturnType<typeof createBookStackWatcher> | null = null;
  if (bookstackService && config.bookstack?.enabled) {
    bookstackWatcher = createBookStackWatcher({
      db,
      bookstackService,
      onBookStackChange: eventHandlers.handleBookStackChange as never,
      debounceDelay: 2000,
    } as never);

    const bookstackWatchResult = await bookstackWatcher.syncWithDatabase();
    if (bookstackWatchResult.watching > 0) {
      logger.info(
        { watching: bookstackWatchResult.watching, available: bookstackWatchResult.available },
        'BookStack file watcher active for real-time local→BookStack import',
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
    doltHubProvisioner,
    beadsIssueService,
    beadsAdapter,
    beadsIssueMirror,
  } as never);

  await syncController.runSyncWithTimeout();

  await setupScheduler({
    config: { sync: { ...config.sync }, reconciliation: config.reconciliation },
    subscribed: false,
    getTemporalOrchestration: getTemporalOrchestration as never,
    runSyncWithTimeout: syncController.runSyncWithTimeout,
    setSyncTimer: (t: ReturnType<typeof setInterval>) => { syncTimer = t; },
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Fatal error, exiting');
  process.exit(1);
});
