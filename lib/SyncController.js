/**
 * SyncController - Mutex + Debounce sync control
 *
 * Prevents sync storms by combining per-project mutexes with debouncing.
 * Extracted from index.js main() closure.
 */

import { Mutex } from 'async-mutex';
import pDebounce from 'p-debounce';
import { logger } from './logger.js';
import { broadcastSyncEvent } from './ApiServer.js';
import {
  recordSuccessfulSync,
  recordFailedSync,
} from './HealthService.js';

/**
 * Create a SyncController instance.
 *
 * @param {object} deps - Dependencies from the main() closure
 * @param {object} deps.config
 * @param {object} deps.healthStats
 * @param {object|null} deps.lettaService
 * @param {object|null} deps.fileWatcher
 * @param {object|null} deps.codePerceptionWatcher
 * @param {object|null} deps.astMemorySync
 * @param {function} deps.getTemporalOrchestration
 * @param {function} deps.getSyncTimer - getter for syncTimer
 * @param {function} deps.setSyncTimer - setter for syncTimer
 * @returns {object}
 */
export function createSyncController(deps) {
  const {
    config,
    healthStats,
    lettaService,
    fileWatcher,
    codePerceptionWatcher,
    astMemorySync,
    getTemporalOrchestration,
    getSyncTimer,
    setSyncTimer,
  } = deps;

  // Per-project mutexes to prevent concurrent syncs for same project
  const syncMutexes = new Map();
  const globalSyncMutex = new Mutex();

  const getSyncMutex = projectId => {
    if (!projectId) return globalSyncMutex;
    if (!syncMutexes.has(projectId)) {
      syncMutexes.set(projectId, new Mutex());
    }
    return syncMutexes.get(projectId);
  };

  // Pending sync requests (for coalescing)
  const pendingSyncs = new Map();

  // Core sync function
  const runSyncCore = async (projectId = null) => {
    const syncStartTime = Date.now();

    broadcastSyncEvent('sync:started', {
      projectId,
      timestamp: new Date().toISOString(),
    });

    try {
      const temporal = await getTemporalOrchestration();

      if (temporal) {
        logger.info({ projectId }, 'Starting Temporal orchestration sync');

        const result = await temporal.executeFullSync({
          projectIdentifier: projectId || undefined,
          enableBeads: config.beads?.enabled ?? true,
          enableLetta: !!lettaService,
          batchSize: config.sync.maxWorkers || 5,
        });

        if (!result.success) {
          throw new Error(`Temporal sync failed: ${result.errors.join(', ')}`);
        }

        logger.info(
          {
            projectId,
            projectsProcessed: result.projectsProcessed,
            issuesSynced: result.issuesSynced,
            durationMs: result.durationMs,
          },
          'Temporal orchestration sync completed'
        );
      } else {
        throw new Error(
          'Temporal orchestration is required — set USE_TEMPORAL_ORCHESTRATION=true'
        );
      }

      const duration = Date.now() - syncStartTime;
      recordSuccessfulSync(healthStats, duration);

      broadcastSyncEvent('sync:completed', {
        projectId,
        duration,
        status: 'success',
      });

      if (lettaService) {
        lettaService.clearCache();
      }

      if (fileWatcher) {
        fileWatcher.syncWatchedProjects().catch(err => {
          logger.warn({ err }, 'Failed to sync file watchers');
        });
      }

      if (codePerceptionWatcher) {
        codePerceptionWatcher.syncWatchedProjects().catch(err => {
          logger.warn({ err }, 'Failed to sync code perception watchers');
        });
      }

      if (astMemorySync) {
        astMemorySync.syncAllProjects().catch(err => {
          logger.warn({ err }, 'Failed to sync AST summaries to PM agents');
        });
      }
    } catch (error) {
      logger.error(
        { err: error, timeoutMs: 900000 },
        'Sync exceeded 15-minute timeout, will retry in next cycle'
      );

      recordFailedSync(healthStats, error);

      broadcastSyncEvent('sync:error', {
        projectId,
        error: error.message,
        stack: error.stack,
      });

      if (lettaService) {
        lettaService.clearCache();
      }
    }
  };

  // Wrapper with mutex
  const runSyncWithMutex = async (projectId = null) => {
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

  // Debounced sync
  const SYNC_DEBOUNCE_MS = 3000;
  const debouncedSyncByProject = new Map();

  const getDebouncedSync = projectId => {
    const key = projectId || 'global';
    if (!debouncedSyncByProject.has(key)) {
      const debounced = pDebounce(async () => {
        await runSyncWithMutex(projectId);
      }, SYNC_DEBOUNCE_MS);
      debouncedSyncByProject.set(key, debounced);
    }
    return debouncedSyncByProject.get(key);
  };

  const runSyncWithTimeout = async (projectId = null) => {
    const key = projectId || 'global';
    logger.debug({ projectId: key }, 'Sync requested (will debounce)');
    pendingSyncs.set(key, Date.now());
    return getDebouncedSync(projectId)();
  };

  const handleSyncTrigger = async (projectId = null) => {
    logger.info({ projectId }, 'Manual sync triggered via API');
    return runSyncWithTimeout(projectId);
  };

  const handleConfigUpdate = async updates => {
    logger.info({ updates }, 'Configuration updated via API');

    if (updates.syncInterval !== undefined) {
      const newIntervalMinutes = Math.max(1, Math.round(updates.syncInterval / 60000));

      const temporal = await getTemporalOrchestration();
      if (temporal?.restartScheduledSync) {
        try {
          const schedule = await temporal.restartScheduledSync({
            intervalMinutes: newIntervalMinutes,
            syncOptions: { dryRun: config.sync.dryRun },
          });
          if (schedule) {
            logger.info(
              { workflowId: schedule.workflowId, intervalMinutes: newIntervalMinutes },
              'Temporal scheduled sync restarted with new interval'
            );
          }
        } catch (err) {
          logger.warn({ err }, 'Failed to restart Temporal schedule, trying legacy');
        }
      }

      const syncTimer = getSyncTimer();
      if (syncTimer) {
        clearInterval(syncTimer);
        logger.info(
          {
            oldInterval: config.sync.interval / 1000,
            newInterval: updates.syncInterval / 1000,
          },
          'Restarting sync timer with new interval (legacy mode)'
        );
        setSyncTimer(setInterval(() => runSyncWithTimeout(), updates.syncInterval));
      }
    }
  };

  return {
    runSyncWithTimeout,
    handleSyncTrigger,
    handleConfigUpdate,
  };
}
