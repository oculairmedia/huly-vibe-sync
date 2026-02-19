/**
 * SchedulerSetup - Temporal scheduled sync and reconciliation
 *
 * Sets up periodic sync schedules using Temporal workflows (with legacy setInterval fallback).
 * Extracted from index.js main() closure.
 */

import { logger } from './logger.js';

/**
 * Set up periodic sync scheduling.
 *
 * @param {object} deps
 * @param {object} deps.config
 * @param {boolean} deps.subscribed - Whether webhook subscription is active
 * @param {function} deps.getTemporalOrchestration
 * @param {function} deps.runSyncWithTimeout
 * @param {function} deps.setSyncTimer - setter for syncTimer
 */
export async function setupScheduler(deps) {
  const { config, subscribed, getTemporalOrchestration, runSyncWithTimeout, setSyncTimer } = deps;

  if (config.sync.interval <= 0) {
    logger.info('One-time sync completed, exiting');
    process.exit(0);
  }

  const intervalMinutes = Math.max(1, Math.round(config.sync.interval / 60000));

  if (subscribed) {
    // Webhook mode + mutation watcher handles real-time sync.
    // No safety-net scheduler needed.
    logger.info(
      'Webhook mode active - real-time sync via mutation watcher, no scheduled sync needed'
    );
  } else {
    // No webhooks — run full sync at normal interval
    const temporal = await getTemporalOrchestration();
    if (temporal?.startScheduledSync) {
      try {
        const existing = await temporal.getActiveScheduledSync();
        if (existing) {
          logger.info(
            { workflowId: existing.workflowId, startTime: existing.startTime },
            'Temporal scheduled sync already active, skipping new schedule'
          );
        } else {
          const schedule = await temporal.startScheduledSync({
            intervalMinutes,
            syncOptions: { dryRun: config.sync.dryRun },
          });
          logger.info(
            { workflowId: schedule.workflowId, intervalMinutes },
            '✓ Temporal scheduled sync started (durable, survives restarts)'
          );
        }
      } catch (err) {
        logger.warn(
          { err },
          'Failed to start Temporal scheduled sync, falling back to setInterval'
        );
        setSyncTimer(setInterval(() => runSyncWithTimeout(), config.sync.interval));
      }
    } else {
      logger.info(
        { intervalSeconds: config.sync.interval / 1000 },
        'Scheduling periodic syncs (legacy mode)'
      );
      setSyncTimer(setInterval(() => runSyncWithTimeout(), config.sync.interval));
    }
  }

  // Schedule periodic reconciliation
  if (config.reconciliation?.enabled) {
    const reconcileIntervalMinutes = Math.max(1, config.reconciliation.intervalMinutes);
    const temporalForReconcile = await getTemporalOrchestration();

    if (temporalForReconcile?.startScheduledReconciliation) {
      try {
        const existing = await temporalForReconcile.getActiveScheduledReconciliation?.();
        if (existing) {
          logger.info(
            { workflowId: existing.workflowId, startTime: existing.startTime },
            'Temporal scheduled reconciliation already active, skipping new schedule'
          );
        } else {
          const schedule = await temporalForReconcile.startScheduledReconciliation({
            intervalMinutes: reconcileIntervalMinutes,
            reconcileOptions: {
              action: config.reconciliation.action,
              dryRun: config.reconciliation.dryRun,
            },
          });
          logger.info(
            { workflowId: schedule.workflowId, intervalMinutes: reconcileIntervalMinutes },
            '✓ Temporal scheduled reconciliation started'
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to start Temporal scheduled reconciliation');
      }
    } else {
      logger.info('Temporal reconciliation scheduling not available');
    }
  }
}
