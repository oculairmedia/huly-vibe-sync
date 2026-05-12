import { Mutex } from 'async-mutex';
import pDebounce from 'p-debounce';
import { logger } from './logger';
import { broadcastSyncEvent } from '../lib/ApiServer.js';
import { recordSuccessfulSync, recordFailedSync } from './HealthService.js';
import type { HealthStats } from './HealthService.js';

interface SyncControllerDeps {
  config: {
    sync: { maxWorkers?: number; dryRun?: boolean; interval: number };
  };
  healthStats: HealthStats;
  lettaService: { clearCache: () => void } | null;
  fileWatcher: { syncWatchedProjects: () => Promise<void> } | null;
  codePerceptionWatcher: { syncWatchedProjects: () => Promise<void> } | null;
  astMemorySync: { syncAllProjects: (stats?: Record<string, unknown>) => Promise<void> } | null;
  getTemporalOrchestration: () => Promise<{
    executeFullSync?: (opts: Record<string, unknown>) => Promise<{ success: boolean; errors: string[]; projectsProcessed: number; issuesSynced: number; durationMs: number }>;
    restartScheduledSync?: (opts: Record<string, unknown>) => Promise<{ workflowId: string } | null>;
  } | null>;
  getSyncTimer: () => ReturnType<typeof setInterval> | null;
  setSyncTimer: (timer: ReturnType<typeof setInterval>) => void;
}

interface SyncControllerResult {
  runSyncWithTimeout: (projectId?: string | null) => Promise<void>;
  handleSyncTrigger: (projectId?: string | null) => Promise<void>;
  handleConfigUpdate: (updates: { syncInterval?: number }) => Promise<void>;
}

export function createSyncController(deps: SyncControllerDeps): SyncControllerResult {
  const {
    config, healthStats, lettaService, fileWatcher, codePerceptionWatcher,
    astMemorySync, getTemporalOrchestration, getSyncTimer, setSyncTimer,
  } = deps;

  const syncMutexes = new Map<string, Mutex>();
  const globalSyncMutex = new Mutex();

  const getSyncMutex = (projectId?: string | null): Mutex => {
    if (!projectId) return globalSyncMutex;
    if (!syncMutexes.has(projectId)) {
      syncMutexes.set(projectId, new Mutex());
    }
    return syncMutexes.get(projectId)!;
  };

  const pendingSyncs = new Map<string, number>();

  const runSyncCore = async (projectId: string | null = null): Promise<void> => {
    const syncStartTime = Date.now();
    broadcastSyncEvent('sync:started', { projectId, timestamp: new Date().toISOString() });

    try {
      const temporal = await getTemporalOrchestration();

      if (temporal) {
        logger.info({ projectId }, 'Starting Temporal orchestration sync');
        const result = await temporal.executeFullSync!({
          projectIdentifier: projectId || undefined,
          enableLetta: !!lettaService,
          batchSize: config.sync.maxWorkers || 5,
        });

        if (!result.success) {
          throw new Error(`Temporal sync failed: ${result.errors.join(', ')}`);
        }

        logger.info({ projectId, projectsProcessed: result.projectsProcessed, issuesSynced: result.issuesSynced, durationMs: result.durationMs }, 'Temporal orchestration sync completed');
      } else {
        throw new Error('Temporal orchestration is required — set USE_TEMPORAL_ORCHESTRATION=true');
      }

      const duration = Date.now() - syncStartTime;
      recordSuccessfulSync(healthStats, duration);
      broadcastSyncEvent('sync:completed', { projectId, duration, status: 'success' });

      lettaService?.clearCache();
      fileWatcher?.syncWatchedProjects().catch((err: unknown) => { logger.warn({ err }, 'Failed to sync file watchers'); });
      codePerceptionWatcher?.syncWatchedProjects().catch((err: unknown) => { logger.warn({ err }, 'Failed to sync code perception watchers'); });
      astMemorySync?.syncAllProjects().catch((err: unknown) => { logger.warn({ err }, 'Failed to sync AST summaries to PM agents'); });
    } catch (error) {
      logger.error({ err: error, timeoutMs: 900000 }, 'Sync exceeded 15-minute timeout, will retry in next cycle');
      recordFailedSync(healthStats, error as Error);
      broadcastSyncEvent('sync:error', { projectId, error: (error as Error).message, stack: (error as Error).stack });
      lettaService?.clearCache();
    }
  };

  const runSyncWithMutex = async (projectId: string | null = null): Promise<void> => {
    const mutex = getSyncMutex(projectId);
    const key = projectId || 'global';

    if (mutex.isLocked()) {
      logger.debug({ projectId: key }, 'Sync already in progress, skipping');
      return;
    }

    await mutex.runExclusive(async () => {
      logger.info({ projectId: key }, 'Acquired sync lock');
      await runSyncCore(projectId);
    });
  };

  const SYNC_DEBOUNCE_MS = 3000;
  const debouncedSyncByProject = new Map<string, () => Promise<void>>();

  const getDebouncedSync = (projectId?: string | null): (() => Promise<void>) => {
    const key = projectId || 'global';
    if (!debouncedSyncByProject.has(key)) {
      debouncedSyncByProject.set(key, pDebounce(async () => { await runSyncWithMutex(projectId); }, SYNC_DEBOUNCE_MS));
    }
    return debouncedSyncByProject.get(key)!;
  };

  const runSyncWithTimeout = async (projectId: string | null = null): Promise<void> => {
    const key = projectId || 'global';
    logger.debug({ projectId: key }, 'Sync requested (will debounce)');
    pendingSyncs.set(key, Date.now());
    return getDebouncedSync(projectId)();
  };

  const handleSyncTrigger = async (projectId: string | null = null): Promise<void> => {
    logger.info({ projectId }, 'Manual sync triggered via API');
    return runSyncWithTimeout(projectId);
  };

  const handleConfigUpdate = async (updates: { syncInterval?: number }): Promise<void> => {
    logger.info({ updates }, 'Configuration updated via API');

    if (updates.syncInterval !== undefined) {
      const newIntervalMinutes = Math.max(1, Math.round(updates.syncInterval / 60000));
      const temporal = await getTemporalOrchestration();
      if (temporal?.restartScheduledSync) {
        try {
          const schedule = await temporal.restartScheduledSync({ intervalMinutes: newIntervalMinutes, syncOptions: { dryRun: config.sync.dryRun } });
          if (schedule) {
            logger.info({ workflowId: schedule.workflowId, intervalMinutes: newIntervalMinutes }, 'Temporal scheduled sync restarted with new interval');
          }
        } catch (err) {
          logger.warn({ err }, 'Failed to restart Temporal schedule, trying legacy');
        }
      }

      const syncTimer = getSyncTimer();
      if (syncTimer) {
        clearInterval(syncTimer);
        logger.info({ oldInterval: config.sync.interval / 1000, newInterval: updates.syncInterval / 1000 }, 'Restarting sync timer with new interval (legacy mode)');
        setSyncTimer(setInterval(() => { runSyncWithTimeout().catch(() => {}); }, updates.syncInterval));
      }
    }
  };

  return { runSyncWithTimeout, handleSyncTrigger, handleConfigUpdate };
}
