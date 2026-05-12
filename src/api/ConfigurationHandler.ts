import { logger } from '../../src/logger';
import type { SSEManager } from './SSEManager';

interface AppConfig {
  huly: { apiUrl: string; useRestApi: boolean };
  sync: { interval: number; dryRun: boolean; incremental: boolean; parallel: boolean; maxWorkers: number; skipEmpty: boolean; apiDelay: number };
  stacks: { baseDir: string };
  letta: { enabled: boolean; baseURL: string };
}

interface ConfigUpdates {
  syncInterval?: number;
  maxWorkers?: number;
  apiDelay?: number;
  dryRun?: boolean;
  incremental?: boolean;
  parallel?: boolean;
  skipEmpty?: boolean;
}

type SendJsonFn = (res: unknown, code: number, data: unknown) => void;
type ErrorFn = (res: unknown, code: number, message: string, details?: Record<string, unknown>) => void;
type ParseFn = (req: unknown) => Promise<Record<string, unknown>>;

export class ConfigurationHandler {
  config: AppConfig;
  onConfigUpdate: ((updates: ConfigUpdates) => void) | null;
  private _sseManager: SSEManager;
  private _parseJsonBody: ParseFn;
  private _sendJson: SendJsonFn;
  private _sendError: ErrorFn;

  constructor(config: AppConfig, onConfigUpdate: ((updates: ConfigUpdates) => void) | null, deps: { sseManager: SSEManager; parseJsonBody: ParseFn; sendJson: SendJsonFn; sendError: ErrorFn }) {
    this.config = config;
    this.onConfigUpdate = onConfigUpdate;
    this._sseManager = deps.sseManager;
    this._parseJsonBody = deps.parseJsonBody;
    this._sendJson = deps.sendJson;
    this._sendError = deps.sendError;
  }

  getConfig(_req: unknown, res: unknown): void {
    this._sendJson(res, 200, { config: this.getSafeConfig(), updatedAt: new Date().toISOString() });
  }

  async updateConfig(req: unknown, res: unknown): Promise<void> {
    try {
      const updates = await this._parseJsonBody(req) as ConfigUpdates;
      const validated = this.validateConfigUpdates(updates);
      this.applyConfigUpdates(validated);
      if (this.onConfigUpdate) this.onConfigUpdate(validated);
      this._sseManager.broadcast('config:updated', { updates: validated, config: this.getSafeConfig() });
      logger.info({ updates: validated }, 'Configuration updated via API');
      this._sendJson(res, 200, { message: 'Configuration updated successfully', config: this.getSafeConfig(), updatedAt: new Date().toISOString() });
    } catch (error) {
      logger.error({ err: error }, 'Failed to update configuration');
      this._sendError(res, 400, 'Failed to update configuration', { error: (error as Error).message });
    }
  }

  resetConfig(_req: unknown, res: unknown): void {
    this._sendJson(res, 200, { message: 'Configuration reset to defaults', config: this.getSafeConfig() });
  }

  getSafeConfig(): Record<string, unknown> {
    return {
      huly: { apiUrl: this.config.huly.apiUrl, useRestApi: this.config.huly.useRestApi },
      sync: { interval: this.config.sync.interval, dryRun: this.config.sync.dryRun, incremental: this.config.sync.incremental, parallel: this.config.sync.parallel, maxWorkers: this.config.sync.maxWorkers, skipEmpty: this.config.sync.skipEmpty, apiDelay: this.config.sync.apiDelay },
      stacks: { baseDir: this.config.stacks.baseDir },
      letta: { enabled: this.config.letta.enabled, baseURL: this.config.letta.baseURL },
    };
  }

  validateConfigUpdates(updates: ConfigUpdates): ConfigUpdates {
    const validated: ConfigUpdates = {};

    if (updates.syncInterval !== undefined) {
      const interval = parseInt(String(updates.syncInterval), 10);
      if (isNaN(interval) || interval < 1000) throw new Error('syncInterval must be >= 1000 milliseconds');
      validated.syncInterval = interval;
    }
    if (updates.maxWorkers !== undefined) {
      const workers = parseInt(String(updates.maxWorkers), 10);
      if (isNaN(workers) || workers < 1 || workers > 20) throw new Error('maxWorkers must be between 1 and 20');
      validated.maxWorkers = workers;
    }
    if (updates.apiDelay !== undefined) {
      const delay = parseInt(String(updates.apiDelay), 10);
      if (isNaN(delay) || delay < 0 || delay > 10000) throw new Error('apiDelay must be between 0 and 10000 milliseconds');
      validated.apiDelay = delay;
    }
    if (updates.dryRun !== undefined) validated.dryRun = Boolean(updates.dryRun);
    if (updates.incremental !== undefined) validated.incremental = Boolean(updates.incremental);
    if (updates.parallel !== undefined) validated.parallel = Boolean(updates.parallel);
    if (updates.skipEmpty !== undefined) validated.skipEmpty = Boolean(updates.skipEmpty);

    return validated;
  }

  applyConfigUpdates(updates: ConfigUpdates): void {
    if (updates.syncInterval !== undefined) this.config.sync.interval = updates.syncInterval;
    if (updates.maxWorkers !== undefined) this.config.sync.maxWorkers = updates.maxWorkers;
    if (updates.apiDelay !== undefined) this.config.sync.apiDelay = updates.apiDelay;
    if (updates.dryRun !== undefined) this.config.sync.dryRun = updates.dryRun;
    if (updates.incremental !== undefined) this.config.sync.incremental = updates.incremental;
    if (updates.parallel !== undefined) this.config.sync.parallel = updates.parallel;
    if (updates.skipEmpty !== undefined) this.config.sync.skipEmpty = updates.skipEmpty;
  }
}
