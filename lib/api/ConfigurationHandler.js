/**
 * Route handler for configuration endpoints
 */

import { logger } from '../logger.js';

export class ConfigurationHandler {
  constructor(config, onConfigUpdate, { sseManager, parseJsonBody, sendJson, sendError }) {
    this.config = config;
    this.onConfigUpdate = onConfigUpdate;
    this._sseManager = sseManager;
    this._parseJsonBody = parseJsonBody;
    this._sendJson = sendJson;
    this._sendError = sendError;
  }

  getConfig(req, res) {
    this._sendJson(res, 200, {
      config: this.getSafeConfig(),
      updatedAt: new Date().toISOString(),
    });
  }

  async updateConfig(req, res) {
    try {
      const updates = await this._parseJsonBody(req);

      const validatedUpdates = this.validateConfigUpdates(updates);

      this.applyConfigUpdates(validatedUpdates);

      if (this.onConfigUpdate) {
        this.onConfigUpdate(validatedUpdates);
      }

      this._sseManager.broadcast('config:updated', {
        updates: validatedUpdates,
        config: this.getSafeConfig(),
      });

      logger.info({ updates: validatedUpdates }, 'Configuration updated via API');

      this._sendJson(res, 200, {
        message: 'Configuration updated successfully',
        config: this.getSafeConfig(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to update configuration');
      this._sendError(res, 400, 'Failed to update configuration', { error: error.message });
    }
  }

  resetConfig(req, res) {
    this._sendJson(res, 200, {
      message: 'Configuration reset to defaults',
      config: this.getSafeConfig(),
    });
  }

  getSafeConfig() {
    return {
      huly: {
        apiUrl: this.config.huly.apiUrl,
        useRestApi: this.config.huly.useRestApi,
      },
      vibeKanban: {
        apiUrl: this.config.vibeKanban.apiUrl,
        useRestApi: this.config.vibeKanban.useRestApi,
      },
      sync: {
        interval: this.config.sync.interval,
        dryRun: this.config.sync.dryRun,
        incremental: this.config.sync.incremental,
        parallel: this.config.sync.parallel,
        maxWorkers: this.config.sync.maxWorkers,
        skipEmpty: this.config.sync.skipEmpty,
        apiDelay: this.config.sync.apiDelay,
      },
      stacks: {
        baseDir: this.config.stacks.baseDir,
      },
      letta: {
        enabled: this.config.letta.enabled,
        baseURL: this.config.letta.baseURL,
      },
    };
  }

  validateConfigUpdates(updates) {
    const validated = {};

    if (updates.syncInterval !== undefined) {
      const interval = parseInt(updates.syncInterval);
      if (isNaN(interval) || interval < 1000) {
        throw new Error('syncInterval must be >= 1000 milliseconds');
      }
      validated.syncInterval = interval;
    }

    if (updates.maxWorkers !== undefined) {
      const workers = parseInt(updates.maxWorkers);
      if (isNaN(workers) || workers < 1 || workers > 20) {
        throw new Error('maxWorkers must be between 1 and 20');
      }
      validated.maxWorkers = workers;
    }

    if (updates.apiDelay !== undefined) {
      const delay = parseInt(updates.apiDelay);
      if (isNaN(delay) || delay < 0 || delay > 10000) {
        throw new Error('apiDelay must be between 0 and 10000 milliseconds');
      }
      validated.apiDelay = delay;
    }

    if (updates.dryRun !== undefined) {
      validated.dryRun = Boolean(updates.dryRun);
    }

    if (updates.incremental !== undefined) {
      validated.incremental = Boolean(updates.incremental);
    }

    if (updates.parallel !== undefined) {
      validated.parallel = Boolean(updates.parallel);
    }

    if (updates.skipEmpty !== undefined) {
      validated.skipEmpty = Boolean(updates.skipEmpty);
    }

    return validated;
  }

  applyConfigUpdates(updates) {
    if (updates.syncInterval !== undefined) {
      this.config.sync.interval = updates.syncInterval;
    }

    if (updates.maxWorkers !== undefined) {
      this.config.sync.maxWorkers = updates.maxWorkers;
    }

    if (updates.apiDelay !== undefined) {
      this.config.sync.apiDelay = updates.apiDelay;
    }

    if (updates.dryRun !== undefined) {
      this.config.sync.dryRun = updates.dryRun;
    }

    if (updates.incremental !== undefined) {
      this.config.sync.incremental = updates.incremental;
    }

    if (updates.parallel !== undefined) {
      this.config.sync.parallel = updates.parallel;
    }

    if (updates.skipEmpty !== undefined) {
      this.config.sync.skipEmpty = updates.skipEmpty;
    }
  }
}
