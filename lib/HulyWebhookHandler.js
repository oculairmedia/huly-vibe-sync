/**
 * Huly Webhook Handler
 *
 * Handles webhooks from the huly-change-watcher service for real-time
 * change notifications instead of polling.
 *
 * @module HulyWebhookHandler
 */

import { logger } from './logger.js';

/**
 * Default change watcher configuration
 */
const DEFAULT_CHANGE_WATCHER_URL =
  process.env.HULY_CHANGE_WATCHER_URL || 'http://huly-change-watcher:3459';
const WEBHOOK_CALLBACK_URL =
  process.env.WEBHOOK_CALLBACK_URL || 'http://huly-vibe-sync:3000/webhook';

/**
 * Webhook payload from change watcher
 * @typedef {Object} WebhookPayload
 * @property {string} type - Event type (e.g., 'task.changed')
 * @property {string} timestamp - ISO timestamp
 * @property {Array<ChangeItem>} changes - Array of changed items
 */

/**
 * Individual change item
 * @typedef {Object} ChangeItem
 * @property {string} id - Task/issue ID
 * @property {string} class - Huly class (e.g., 'tracker:class:Issue')
 * @property {number} modifiedOn - Modification timestamp
 * @property {Object} data - Full task data
 */

/**
 * Webhook handler result
 * @typedef {Object} WebhookResult
 * @property {boolean} success - Whether processing succeeded
 * @property {number} processed - Number of items processed
 * @property {number} skipped - Number of items skipped
 * @property {Array<string>} errors - Any error messages
 */

/**
 * HulyWebhookHandler class
 * Manages webhook subscriptions and processes incoming change notifications
 */
export class HulyWebhookHandler {
  /**
   * Create a new webhook handler
   * @param {Object} options - Handler options
   * @param {Object} options.db - Database instance
   * @param {Function} options.onChangesReceived - Callback when changes are received
   * @param {string} [options.changeWatcherUrl] - Change watcher service URL
   * @param {string} [options.callbackUrl] - Webhook callback URL
   */
  constructor({ db, onChangesReceived, changeWatcherUrl, callbackUrl }) {
    this.db = db;
    this.onChangesReceived = onChangesReceived;
    this.changeWatcherUrl = changeWatcherUrl || DEFAULT_CHANGE_WATCHER_URL;
    this.callbackUrl = callbackUrl || WEBHOOK_CALLBACK_URL;
    this.subscribed = false;
    this.lastWebhookReceived = null;
    this.stats = {
      webhooksReceived: 0,
      changesProcessed: 0,
      errors: 0,
    };
  }

  /**
   * Subscribe to the change watcher service
   * @returns {Promise<boolean>} Whether subscription succeeded
   */
  async subscribe() {
    try {
      const response = await fetch(`${this.changeWatcherUrl}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: this.callbackUrl,
          events: ['task.changed', 'project.changed'],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ status: response.status, error }, 'Failed to subscribe to change watcher');
        return false;
      }

      const result = await response.json();
      this.subscribed = true;
      logger.info({ callbackUrl: this.callbackUrl, result }, 'Subscribed to Huly change watcher');
      return true;
    } catch (error) {
      logger.error(
        { err: error, changeWatcherUrl: this.changeWatcherUrl },
        'Error subscribing to change watcher'
      );
      return false;
    }
  }

  /**
   * Unsubscribe from the change watcher service
   * @returns {Promise<boolean>} Whether unsubscription succeeded
   */
  async unsubscribe() {
    try {
      const response = await fetch(`${this.changeWatcherUrl}/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: this.callbackUrl,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.warn(
          { status: response.status, error },
          'Failed to unsubscribe from change watcher'
        );
        return false;
      }

      this.subscribed = false;
      logger.info('Unsubscribed from Huly change watcher');
      return true;
    } catch (error) {
      logger.warn({ err: error }, 'Error unsubscribing from change watcher');
      return false;
    }
  }

  /**
   * Check if the change watcher service is healthy
   * @returns {Promise<boolean>} Whether service is healthy
   */
  async checkHealth() {
    try {
      const response = await fetch(`${this.changeWatcherUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch (error) {
      logger.debug({ err: error }, 'Change watcher health check failed');
      return false;
    }
  }

  /**
   * Get change watcher stats
   * @returns {Promise<Object|null>} Stats or null if unavailable
   */
  async getWatcherStats() {
    try {
      const response = await fetch(`${this.changeWatcherUrl}/stats`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Handle incoming webhook payload
   * @param {WebhookPayload} payload - Webhook payload
   * @returns {Promise<WebhookResult>} Processing result
   */
  async handleWebhook(payload) {
    const result = {
      success: true,
      processed: 0,
      skipped: 0,
      errors: [],
    };

    this.stats.webhooksReceived++;
    this.lastWebhookReceived = new Date().toISOString();

    // Validate payload
    if (!payload || !payload.type) {
      result.success = false;
      result.errors.push('Invalid webhook payload: missing type');
      this.stats.errors++;
      return result;
    }

    logger.info(
      {
        type: payload.type,
        timestamp: payload.timestamp,
        changeCount: payload.changes?.length || 0,
      },
      'Received webhook from change watcher'
    );

    // Handle different event types
    switch (payload.type) {
      case 'task.changed':
      case 'task.updated':
        return await this.handleTaskChanges(payload.changes || [], result);

      case 'project.created':
      case 'project.updated':
        return await this.handleProjectChanges(payload.changes || [], result);

      default:
        logger.warn({ type: payload.type }, 'Unknown webhook event type');
        result.skipped = payload.changes?.length || 0;
        return result;
    }
  }

  /**
   * Handle task change events
   * @param {Array<ChangeItem>} changes - Changed items
   * @param {WebhookResult} result - Result object to populate
   * @returns {Promise<WebhookResult>} Processing result
   */
  async handleTaskChanges(changes, result) {
    if (!changes || changes.length === 0) {
      logger.debug('No changes in webhook payload');
      return result;
    }

    // Filter to Issue and Project class changes
    const issueChanges = changes.filter(c => c.class === 'tracker:class:Issue');
    const projectChanges = changes.filter(c => c.class === 'tracker:class:Project');
    const relevantChanges = [...issueChanges, ...projectChanges];

    if (relevantChanges.length === 0) {
      logger.debug(
        { totalChanges: changes.length },
        'No Issue or Project changes in payload, skipping'
      );
      result.skipped = changes.length;
      return result;
    }

    logger.info(
      {
        totalChanges: changes.length,
        issueChanges: issueChanges.length,
        projectChanges: projectChanges.length,
      },
      'Processing issue and project changes from webhook'
    );

    // Group changes by project for efficient processing
    const changesByProject = this.groupChangesByProject(relevantChanges);

    // Notify the sync orchestrator about the changes
    if (this.onChangesReceived) {
      try {
        await this.onChangesReceived({
          type: 'task.changed',
          changes: relevantChanges,
          byProject: changesByProject,
          timestamp: new Date().toISOString(),
        });
        result.processed = relevantChanges.length;
        this.stats.changesProcessed += relevantChanges.length;
      } catch (error) {
        logger.error({ err: error }, 'Error processing webhook changes');
        result.success = false;
        result.errors.push(error.message);
        this.stats.errors++;
      }
    } else {
      // No handler registered, just log
      logger.warn('No change handler registered, webhook changes not processed');
      result.skipped = issueChanges.length;
    }

    return result;
  }

  /**
   * Handle project change events
   * @param {Array<ChangeItem>} changes - Changed items
   * @param {WebhookResult} result - Result object to populate
   * @returns {Promise<WebhookResult>} Processing result
   */
  async handleProjectChanges(changes, result) {
    if (!changes || changes.length === 0) {
      logger.debug('No project changes in webhook payload');
      return result;
    }

    logger.info(
      {
        projectChanges: changes.length,
      },
      'Processing project changes from webhook'
    );

    // Notify the sync orchestrator about the project changes
    if (this.onChangesReceived) {
      try {
        await this.onChangesReceived({
          type: 'project.changed',
          changes: changes,
          timestamp: new Date().toISOString(),
        });
        result.processed = changes.length;
        this.stats.changesProcessed += changes.length;
      } catch (error) {
        logger.error({ err: error }, 'Error processing project webhook changes');
        result.success = false;
        result.errors.push(error.message);
        this.stats.errors++;
      }
    } else {
      logger.warn('No change handler registered, project webhook changes not processed');
      result.skipped = changes.length;
    }

    return result;
  }

  /**
   * Group changes by project identifier
   * @param {Array<ChangeItem>} changes - Changed items
   * @returns {Map<string, Array<ChangeItem>>} Changes grouped by project
   */
  groupChangesByProject(changes) {
    const byProject = new Map();

    for (const change of changes) {
      // Extract project identifier from the issue data
      // The identifier format is typically "PROJECT-123"
      const identifier = change.data?.identifier;
      if (identifier) {
        const projectId = identifier.split('-')[0];
        if (!byProject.has(projectId)) {
          byProject.set(projectId, []);
        }
        byProject.get(projectId).push(change);
      }
    }

    return byProject;
  }

  /**
   * Get handler statistics
   * @returns {Object} Handler stats
   */
  getStats() {
    return {
      subscribed: this.subscribed,
      changeWatcherUrl: this.changeWatcherUrl,
      callbackUrl: this.callbackUrl,
      lastWebhookReceived: this.lastWebhookReceived,
      ...this.stats,
    };
  }
}

/**
 * Create a webhook handler instance
 * @param {Object} options - Handler options
 * @returns {HulyWebhookHandler} Handler instance
 */
export function createWebhookHandler(options) {
  return new HulyWebhookHandler(options);
}

export default HulyWebhookHandler;
