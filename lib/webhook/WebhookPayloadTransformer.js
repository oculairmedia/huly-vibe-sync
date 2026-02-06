/**
 * WebhookPayloadTransformer — Detects and transforms webhook payload formats.
 *
 * Supports two formats:
 * 1. Change-watcher format: { source, timestamp, events: [{type, data}, ...] }
 * 2. Legacy format: { type, timestamp, changes: [...] }
 */

import { logger } from '../logger.js';

/**
 * Detect whether the payload is in change-watcher format.
 * @param {Object} payload
 * @returns {boolean}
 */
export function isChangeWatcherFormat(payload) {
  return !!(payload?.events && Array.isArray(payload.events));
}

/**
 * Transform change-watcher events into the internal change format.
 *
 * Change-watcher sends: { type: "issue.updated", data: { id, class, ... } }
 * Internal format: { id, class, modifiedOn, data: { identifier, title, ... }, _eventType }
 *
 * @param {Array} events - Raw change-watcher events
 * @returns {{ issueTaskChanges: Array, projectChanges: Array }}
 */
export function transformChangeWatcherEvents(events) {
  const transformed = events.map(event => ({
    id: event.data?.id,
    class: event.data?.class,
    modifiedOn: event.data?.modifiedOn,
    data: {
      identifier: event.data?.identifier,
      title: event.data?.title,
      status: event.data?.status,
      space: event.data?.space,
      modifiedBy: event.data?.modifiedBy,
      name: event.data?.name,
      archived: event.data?.archived,
    },
    _eventType: event.type,
  }));

  const issueTaskChanges = transformed.filter(
    c => c._eventType === 'issue.updated' || c._eventType === 'task.updated'
  );
  const projectChanges = transformed.filter(c => c._eventType === 'project.updated');

  return { issueTaskChanges, projectChanges };
}

/**
 * Group changes by project identifier (extracted from issue identifier "PROJ-123" → "PROJ").
 * @param {Array} changes
 * @returns {Map<string, Array>}
 */
export function groupChangesByProject(changes) {
  const byProject = new Map();

  for (const change of changes) {
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
 * Filter changes to only Issue and Project classes.
 * @param {Array} changes
 * @returns {{ issueChanges: Array, projectChanges: Array, relevantChanges: Array }}
 */
export function filterRelevantChanges(changes) {
  const issueChanges = changes.filter(c => c.class === 'tracker:class:Issue');
  const projectChanges = changes.filter(c => c.class === 'tracker:class:Project');
  const relevantChanges = [...issueChanges, ...projectChanges];

  if (relevantChanges.length === 0) {
    logger.debug(
      { totalChanges: changes.length },
      'No Issue or Project changes in payload, skipping'
    );
  }

  return { issueChanges, projectChanges, relevantChanges };
}
