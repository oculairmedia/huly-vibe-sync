/**
 * WebhookDebouncer — Buffers, deduplicates, and flushes Huly webhook changes.
 *
 * When Temporal is available, batches changes into a single workflow call
 * instead of dispatching each webhook individually.
 */

import { logger } from '../logger.js';

export class WebhookDebouncer {
  /**
   * @param {Object} options
   * @param {number} [options.debounceWindowMs=5000] - Time to buffer before flushing
   * @param {number} [options.maxBatchSize=50] - Maximum changes per batch
   * @param {Function} options.getTemporalClient - Async function returning Temporal client or null
   * @param {Function} options.groupChangesByProject - Groups changes by project identifier
   */
  constructor({ debounceWindowMs = 5000, maxBatchSize = 50, getTemporalClient, groupChangesByProject }) {
    this._debounceWindowMs = debounceWindowMs;
    this._maxBatchSize = maxBatchSize;
    this._getTemporalClient = getTemporalClient;
    this._groupChangesByProject = groupChangesByProject;
    this._pendingChanges = [];
    this._debounceTimer = null;
    this._flushPromise = null;
    this.stats = {
      debounceFlushes: 0,
      errors: 0,
    };
  }

  /**
   * Add changes to the debounce buffer and schedule a flush.
   * @param {Array} changes - Relevant changes to buffer
   */
  buffer(changes) {
    this._pendingChanges.push(...changes);

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(() => this.flush(), this._debounceWindowMs);

    logger.info(
      { buffered: this._pendingChanges.length, added: changes.length },
      '[WebhookDebouncer] Buffered changes, flush in ' + this._debounceWindowMs + 'ms'
    );
  }

  /**
   * Flush pending changes to Temporal.
   * Deduplicates by issue identifier, keeping the most recent change.
   */
  async flush() {
    if (this._pendingChanges.length === 0) return;
    if (this._flushPromise) return this._flushPromise;

    this._flushPromise = (async () => {
      try {
        const changesToFlush = this._pendingChanges.splice(0);
        this._debounceTimer = null;

        const deduped = this._deduplicateChanges(changesToFlush);
        const changesByProject = this._groupChangesByProject(deduped);

        logger.info(
          { raw: changesToFlush.length, deduped: deduped.length },
          '[WebhookDebouncer] Flushing debounced changes'
        );

        if (deduped.length > this._maxBatchSize) {
          logger.warn(
            { changeCount: deduped.length },
            '[WebhookDebouncer] Debounced batch still oversized, skipping'
          );
          return;
        }

        const temporal = await this._getTemporalClient();
        if (!temporal) return;

        const { workflowId } = await temporal.scheduleHulyWebhookChange({
          type: 'task.changed',
          changes: deduped,
          byProject: Object.fromEntries(changesByProject),
          timestamp: new Date().toISOString(),
        });

        this.stats.debounceFlushes++;
        logger.info(
          { workflowId, changeCount: deduped.length },
          '[WebhookDebouncer] Flushed debounced changes to Temporal'
        );
      } catch (error) {
        logger.error({ err: error }, '[WebhookDebouncer] Debounce flush failed');
        this.stats.errors++;
      } finally {
        this._flushPromise = null;
      }
    })();

    return this._flushPromise;
  }

  /**
   * Deduplicate changes by issue identifier, keeping the most recently modified.
   * @param {Array} changes
   * @returns {Array} Deduplicated changes
   */
  _deduplicateChanges(changes) {
    const seen = new Map();
    for (const change of changes) {
      const key = change.data?.identifier || change.id;
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing || (change.modifiedOn || 0) > (existing.modifiedOn || 0)) {
        seen.set(key, change);
      }
    }
    return Array.from(seen.values());
  }
}
