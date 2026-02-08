/**
 * Vibe Event Watcher
 *
 * Subscribes to Vibe Kanban's SSE event stream to detect task changes
 * in real-time and trigger Vibe→Huly sync.
 *
 * When USE_TEMPORAL_VIBE=true, uses durable Temporal workflows instead of
 * in-memory callbacks. This provides automatic retry, crash recovery, and
 * observability.
 *
 * @module VibeEventWatcher
 */

import { logger } from './logger.js';

// Feature flag for Temporal integration
const USE_TEMPORAL_VIBE = process.env.USE_TEMPORAL_VIBE === 'true';

// Lazy-loaded Temporal client
let temporalClient = null;

/**
 * Get Temporal client (lazy initialization)
 */
async function getTemporalClient() {
  if (!temporalClient && USE_TEMPORAL_VIBE) {
    try {
      const { scheduleVibeSSEChange, isTemporalAvailable } = await import(
        '../temporal/dist/client.js'
      );

      if (await isTemporalAvailable()) {
        temporalClient = { scheduleVibeSSEChange };
        logger.info('[VibeEventWatcher] Temporal integration enabled');
      } else {
        logger.warn('[VibeEventWatcher] Temporal not available, using callback mode');
      }
    } catch (err) {
      logger.warn({ err }, '[VibeEventWatcher] Failed to load Temporal client');
    }
  }
  return temporalClient;
}

/**
 * Default configuration
 */
const DEFAULT_VIBE_URL = process.env.VIBE_API_URL || 'http://192.168.50.90:3105/api';
const RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * VibeEventWatcher class
 * Subscribes to Vibe's SSE stream and triggers sync on task changes
 */
export class VibeEventWatcher {
  /**
   * Create a new VibeEventWatcher
   * @param {Object} options - Watcher options
   * @param {Object} options.db - Database instance
   * @param {Function} options.onTaskChange - Callback when task changes detected
   * @param {string} [options.vibeUrl] - Vibe API base URL
   * @param {number} [options.reconnectDelay] - Delay between reconnection attempts
   * @param {number} [options.initialBurstIgnoreMs] - Time to ignore events after connect (for history burst)
   */
  constructor({
    db,
    onTaskChange,
    vibeUrl,
    reconnectDelay = RECONNECT_DELAY,
    initialBurstIgnoreMs = 5000,
  }) {
    this.db = db;
    this.onTaskChange = onTaskChange;
    this.vibeUrl = vibeUrl || DEFAULT_VIBE_URL;
    this.reconnectDelay = reconnectDelay;
    this.initialBurstIgnoreMs = initialBurstIgnoreMs;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.abortController = null;
    this.pendingChanges = new Map(); // projectId -> Set of taskIds
    this.debounceTimers = new Map(); // projectId -> timer
    this.inFlightProjects = new Set(); // projectId currently scheduling/running
    this.queuedChanges = new Map(); // projectId -> Set of taskIds queued during in-flight
    this.debounceDelay = 2000; // 2 seconds
    this.connectionTime = null; // When we connected (to ignore initial burst)
    this.stats = {
      eventsReceived: 0,
      eventsIgnored: 0,
      tasksChanged: 0,
      syncsTriggered: 0,
      reconnects: 0,
      errors: 0,
    };
  }

  /**
   * Start watching Vibe events
   * @returns {Promise<boolean>} Whether connection succeeded
   */
  async start() {
    try {
      await this.connect();
      return this.connected;
    } catch (error) {
      logger.error({ err: error }, 'Failed to start Vibe event watcher');
      return false;
    }
  }

  /**
   * Connect to Vibe's SSE stream
   */
  async connect() {
    const eventsUrl = `${this.vibeUrl}/events`;

    logger.info({ url: eventsUrl }, 'Connecting to Vibe SSE stream');

    this.abortController = new AbortController();

    try {
      const response = await fetch(eventsUrl, {
        headers: {
          Accept: 'text/event-stream',
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      this.connected = true;
      this.reconnectAttempts = 0;
      this.connectionTime = Date.now();
      logger.info(
        { initialBurstIgnoreMs: this.initialBurstIgnoreMs },
        '✓ Connected to Vibe SSE stream (ignoring initial history burst)'
      );

      // Process the stream in background (don't await - it's infinite)
      this.processStream(response.body).catch(error => {
        if (error.name !== 'AbortError') {
          logger.error({ err: error }, 'SSE stream processing error');
          this.stats.errors++;
        }
        this.connected = false;
        this.scheduleReconnect();
      });

      // Return immediately after connection established
      return;
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.info('Vibe SSE connection aborted');
        return;
      }

      this.connected = false;
      this.stats.errors++;
      logger.error({ err: error }, 'Vibe SSE connection error');

      // Attempt reconnection
      await this.scheduleReconnect();
    }
  }

  /**
   * Process the SSE stream
   * @param {ReadableStream} body - Response body stream
   */
  async processStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          logger.info('Vibe SSE stream ended');
          this.connected = false;
          await this.scheduleReconnect();
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete events (separated by double newline)
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // Keep incomplete event in buffer

        for (const eventText of events) {
          if (eventText.trim()) {
            this.parseAndHandleEvent(eventText);
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        logger.error({ err: error }, 'Error processing Vibe SSE stream');
        this.stats.errors++;
      }
      this.connected = false;
      await this.scheduleReconnect();
    }
  }

  /**
   * Parse and handle an SSE event
   * @param {string} eventText - Raw SSE event text
   */
  parseAndHandleEvent(eventText) {
    const lines = eventText.split('\n');
    let eventType = null;
    let data = null;

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        data = line.slice(6);
      }
    }

    if (!eventType || !data) {
      return;
    }

    this.stats.eventsReceived++;

    // Ignore events during initial burst (history replay)
    if (this.connectionTime && Date.now() - this.connectionTime < this.initialBurstIgnoreMs) {
      this.stats.eventsIgnored++;
      return;
    }

    // We only care about json_patch events for tasks
    if (eventType !== 'json_patch') {
      return;
    }

    try {
      const patches = JSON.parse(data);

      for (const patch of patches) {
        // Check if this is a task change
        if (patch.path && patch.path.startsWith('/tasks/')) {
          this.handleTaskPatch(patch);
        }
      }
    } catch (error) {
      logger.debug({ err: error, data }, 'Failed to parse SSE event data');
    }
  }

  /**
   * Handle a task patch event
   * @param {Object} patch - JSON patch object
   */
  handleTaskPatch(patch) {
    const { op, path, value } = patch;

    // Extract task ID from path: /tasks/{taskId}
    const taskId = path.split('/')[2];
    if (!taskId) return;

    this.stats.tasksChanged++;

    // Get project ID from the value (for add/replace) or we need to look it up (for remove)
    let projectId = value?.project_id;

    if (!projectId && op === 'remove') {
      // For removals, we'd need to look up the project from our database
      // For now, we'll skip removals without project info
      logger.debug({ taskId, op }, 'Task removal without project info, skipping');
      return;
    }

    if (!projectId) {
      return;
    }

    logger.debug({ op, taskId, projectId, status: value?.status }, 'Vibe task change detected');

    // Add to pending changes for this project
    if (!this.pendingChanges.has(projectId)) {
      this.pendingChanges.set(projectId, new Set());
    }
    this.pendingChanges.get(projectId).add(taskId);

    // Schedule debounced sync
    this.scheduleSync(projectId);
  }

  /**
   * Schedule a debounced sync for a project
   * @param {string} projectId - Vibe project ID
   */
  scheduleSync(projectId) {
    // Clear existing timer
    const existingTimer = this.debounceTimers.get(projectId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(projectId);
      await this.triggerSync(projectId);
    }, this.debounceDelay);

    this.debounceTimers.set(projectId, timer);
  }

  /**
   * Trigger a sync for a project
   * @param {string} projectId - Vibe project ID
   */
  async triggerSync(projectId) {
    const pending = this.pendingChanges.get(projectId);
    const changedTaskIds = pending ? Array.from(pending) : [];

    // Clear pending changes
    if (pending) {
      pending.clear();
    }

    if (changedTaskIds.length === 0) {
      return;
    }

    if (this.inFlightProjects.has(projectId)) {
      if (!this.queuedChanges.has(projectId)) {
        this.queuedChanges.set(projectId, new Set());
      }
      const queued = this.queuedChanges.get(projectId);
      for (const taskId of changedTaskIds) {
        queued.add(taskId);
      }
      logger.debug(
        { projectId, queued: queued.size },
        '[VibeEventWatcher] Coalesced SSE changes while project sync in-flight'
      );
      return;
    }

    this.inFlightProjects.add(projectId);

    try {
      // Skip large batches - likely full task list from SSE reconnect, not actual changes
      // Let the regular sync cycle handle these
      const MAX_TASKS_PER_SSE_BATCH = 50;
      if (changedTaskIds.length > MAX_TASKS_PER_SSE_BATCH) {
        logger.warn(
          {
            vibeProjectId: projectId,
            taskCount: changedTaskIds.length,
            maxAllowed: MAX_TASKS_PER_SSE_BATCH,
          },
          '[VibeEventWatcher] Skipping oversized batch - likely SSE reconnect flood, not real changes'
        );
        this.stats.eventsIgnored += changedTaskIds.length;
        return;
      }

      // Look up the Huly project identifier from the Vibe project ID
      let hulyProjectIdentifier = null;
      if (this.db) {
        const project = this.db.getProjectByVibeId(projectId);
        hulyProjectIdentifier = project?.identifier;
      }

      logger.info(
        {
          vibeProjectId: projectId,
          hulyProject: hulyProjectIdentifier,
          taskCount: changedTaskIds.length,
          taskIds: changedTaskIds.slice(0, 5),
        },
        'Triggering Vibe→Huly sync from SSE events'
      );

      this.stats.syncsTriggered++;

      // Try Temporal workflow first (if enabled)
      const temporal = await getTemporalClient();
      if (temporal) {
        try {
          const { workflowId } = await temporal.scheduleVibeSSEChange({
            vibeProjectId: projectId,
            hulyProjectIdentifier,
            changedTaskIds,
            timestamp: new Date().toISOString(),
          });
          logger.info(
            { vibeProjectId: projectId, workflowId, taskCount: changedTaskIds.length },
            '[VibeEventWatcher] Scheduled Temporal workflow for Vibe SSE changes'
          );
          return;
        } catch (error) {
          logger.warn(
            { vibeProjectId: projectId, err: error },
            '[VibeEventWatcher] Temporal workflow failed, falling back to callback'
          );
        }
      }

      // Fallback to callback (legacy mode)
      if (this.onTaskChange) {
        try {
          await this.onTaskChange({
            vibeProjectId: projectId,
            hulyProjectIdentifier,
            changedTaskIds,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logger.error({ vibeProjectId: projectId, err: error }, 'Error in Vibe change callback');
        }
      }
    } finally {
      this.inFlightProjects.delete(projectId);

      const queued = this.queuedChanges.get(projectId);
      if (queued && queued.size > 0) {
        this.queuedChanges.delete(projectId);
        if (!this.pendingChanges.has(projectId)) {
          this.pendingChanges.set(projectId, new Set());
        }
        const pendingSet = this.pendingChanges.get(projectId);
        for (const taskId of queued) {
          pendingSet.add(taskId);
        }
        this.scheduleSync(projectId);
      }
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  async scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        { attempts: this.reconnectAttempts },
        'Max reconnection attempts reached, giving up'
      );
      return;
    }

    this.reconnectAttempts++;
    this.stats.reconnects++;

    const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5); // Exponential backoff, max 5x

    logger.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      'Scheduling Vibe SSE reconnection'
    );

    await new Promise(resolve => setTimeout(resolve, delay));

    if (!this.connected) {
      await this.connect();
    }
  }

  /**
   * Stop watching and disconnect
   */
  async stop() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingChanges.clear();
    this.inFlightProjects.clear();
    this.queuedChanges.clear();

    this.connected = false;
    logger.info('Vibe event watcher stopped');
  }

  /**
   * Get watcher statistics
   * @returns {Object} Watcher stats
   */
  getStats() {
    return {
      connected: this.connected,
      vibeUrl: this.vibeUrl,
      reconnectAttempts: this.reconnectAttempts,
      ...this.stats,
    };
  }
}

/**
 * Create a VibeEventWatcher instance
 * @param {Object} options - Watcher options
 * @returns {VibeEventWatcher} Watcher instance
 */
export function createVibeEventWatcher(options) {
  return new VibeEventWatcher(options);
}

export default VibeEventWatcher;
