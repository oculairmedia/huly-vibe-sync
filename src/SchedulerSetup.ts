import { logger } from './logger';

interface SchedulerDeps {
  config: {
    sync: { interval: number; dryRun?: boolean };
    reconciliation?: {
      enabled?: boolean;
      intervalMinutes: number;
      action?: string;
      dryRun?: boolean;
    };
  };
  subscribed: boolean;
  getTemporalOrchestration: () => Promise<{
    startScheduledSync?: (opts: { intervalMinutes: number; syncOptions: Record<string, unknown> }) => Promise<{ workflowId: string }>;
    getActiveScheduledSync?: () => Promise<{ workflowId: string; startTime: string } | null>;
    startScheduledReconciliation?: (opts: { intervalMinutes: number; reconcileOptions: Record<string, unknown> }) => Promise<{ workflowId: string }>;
    getActiveScheduledReconciliation?: () => Promise<{ workflowId: string; startTime: string } | null>;
  } | null>;
  runSyncWithTimeout: () => Promise<void>;
  setSyncTimer: (timer: ReturnType<typeof setInterval>) => void;
}

export async function setupScheduler(deps: SchedulerDeps): Promise<void> {
  const { config, subscribed, getTemporalOrchestration, runSyncWithTimeout, setSyncTimer } = deps;

  if (config.sync.interval <= 0) {
    logger.info('One-time sync completed, exiting');
    process.exit(0);
  }

  const intervalMinutes = Math.max(1, Math.round(config.sync.interval / 60000));

  if (subscribed) {
    logger.info('Webhook mode active - real-time sync via mutation watcher, no scheduled sync needed');
  } else {
    const temporal = await getTemporalOrchestration();
    if (temporal?.startScheduledSync) {
      try {
        const existing = await temporal.getActiveScheduledSync?.();
        if (existing) {
          logger.info({ workflowId: existing.workflowId, startTime: existing.startTime }, 'Temporal scheduled sync already active, skipping new schedule');
        } else {
          const schedule = await temporal.startScheduledSync({ intervalMinutes, syncOptions: { dryRun: config.sync.dryRun } });
          logger.info({ workflowId: schedule.workflowId, intervalMinutes }, '✓ Temporal scheduled sync started (durable, survives restarts)');
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to start Temporal scheduled sync, falling back to setInterval');
        setSyncTimer(setInterval(() => { runSyncWithTimeout().catch(() => {}); }, config.sync.interval));
      }
    } else {
      logger.info({ intervalSeconds: config.sync.interval / 1000 }, 'Scheduling periodic syncs (legacy mode)');
      setSyncTimer(setInterval(() => { runSyncWithTimeout().catch(() => {}); }, config.sync.interval));
    }
  }

  if (config.reconciliation?.enabled) {
    const reconcileIntervalMinutes = Math.max(1, config.reconciliation.intervalMinutes);
    const temporalForReconcile = await getTemporalOrchestration();

    if (temporalForReconcile?.startScheduledReconciliation) {
      try {
        const existing = await temporalForReconcile.getActiveScheduledReconciliation?.();
        if (existing) {
          logger.info({ workflowId: existing.workflowId, startTime: existing.startTime }, 'Temporal scheduled reconciliation already active, skipping new schedule');
        } else {
          const schedule = await temporalForReconcile.startScheduledReconciliation({
            intervalMinutes: reconcileIntervalMinutes,
            reconcileOptions: { action: config.reconciliation?.action, dryRun: config.reconciliation?.dryRun },
          });
          logger.info({ workflowId: schedule.workflowId, intervalMinutes: reconcileIntervalMinutes }, '✓ Temporal scheduled reconciliation started');
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to start Temporal scheduled reconciliation');
      }
    } else {
      logger.info('Temporal reconciliation scheduling not available');
    }
  }
}
