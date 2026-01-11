"use strict";
/**
 * Vibe Event Watcher
 *
 * Watches Vibe Kanban for task changes via SSE (Server-Sent Events).
 * Triggers Temporal workflows when tasks change.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VibeEventWatcher = void 0;
exports.createVibeWatcher = createVibeWatcher;
const eventsource_1 = require("eventsource");
const trigger_1 = require("../trigger");
class VibeEventWatcher {
    eventSource = null;
    options;
    reconnectAttempts = 0;
    maxReconnectAttempts = 10;
    reconnectDelay = 1000;
    constructor(options) {
        this.options = options;
    }
    /**
     * Start watching for Vibe events
     */
    async start() {
        const temporalReady = await (0, trigger_1.isTemporalAvailable)();
        if (!temporalReady) {
            throw new Error('Temporal server not available');
        }
        this.connect();
    }
    connect() {
        const sseUrl = `${this.options.vibeApiUrl.replace(/:\d+/, ':3105')}/api/events`;
        console.log(`[VibeWatcher] Connecting to SSE: ${sseUrl}`);
        this.eventSource = new eventsource_1.EventSource(sseUrl);
        this.eventSource.onopen = () => {
            console.log('[VibeWatcher] SSE connection established');
            this.reconnectAttempts = 0;
        };
        this.eventSource.onmessage = async (event) => {
            await this.handleEvent(event);
        };
        this.eventSource.onerror = (error) => {
            console.error('[VibeWatcher] SSE error:', error);
            this.handleConnectionError();
        };
        // Listen for specific event types
        this.eventSource.addEventListener('task_created', async (event) => {
            await this.handleEvent(event, 'task_created');
        });
        this.eventSource.addEventListener('task_updated', async (event) => {
            await this.handleEvent(event, 'task_updated');
        });
        this.eventSource.addEventListener('task_moved', async (event) => {
            await this.handleEvent(event, 'task_moved');
        });
    }
    async handleEvent(event, type) {
        try {
            const data = JSON.parse(event.data);
            // Filter to our project
            if (data.projectId && data.projectId !== this.options.projectId) {
                return;
            }
            const vibeEvent = {
                type: (type || data.type || 'task_updated'),
                projectId: data.projectId || this.options.projectId,
                taskId: data.taskId || data.id,
                data: data,
            };
            console.log(`[VibeWatcher] Event: ${vibeEvent.type} for task ${vibeEvent.taskId}`);
            // Skip delete events
            if (vibeEvent.type === 'task_deleted') {
                console.log('[VibeWatcher] Skipping delete event');
                return;
            }
            // Trigger Temporal workflow
            await this.triggerSync(vibeEvent);
        }
        catch (error) {
            console.error('[VibeWatcher] Error processing event:', error);
            if (this.options.onError && error instanceof Error) {
                this.options.onError(error);
            }
        }
    }
    async triggerSync(event) {
        const context = {
            projectIdentifier: this.options.hulyProjectIdentifier,
            vibeProjectId: event.projectId,
            gitRepoPath: this.options.gitRepoPath,
        };
        const linkedIds = {
            vibeId: event.taskId,
            hulyId: event.data?.hulyId,
            beadsId: event.data?.beadsId,
        };
        try {
            const result = await (0, trigger_1.triggerSyncFromVibe)(event.taskId, context, linkedIds);
            console.log(`[VibeWatcher] Started workflow: ${result.workflowId}`);
            if (this.options.onWorkflowStarted) {
                this.options.onWorkflowStarted(result.workflowId, event);
            }
        }
        catch (error) {
            console.error('[VibeWatcher] Failed to trigger workflow:', error);
            if (this.options.onError && error instanceof Error) {
                this.options.onError(error);
            }
        }
    }
    handleConnectionError() {
        this.eventSource?.close();
        this.eventSource = null;
        this.reconnectAttempts++;
        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            console.log(`[VibeWatcher] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
            setTimeout(() => {
                this.connect();
            }, delay);
        }
        else {
            console.error('[VibeWatcher] Max reconnect attempts reached');
            if (this.options.onError) {
                this.options.onError(new Error('SSE connection failed after max retries'));
            }
        }
    }
    /**
     * Stop watching for events
     */
    stop() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
            console.log('[VibeWatcher] Stopped');
        }
    }
}
exports.VibeEventWatcher = VibeEventWatcher;
/**
 * Create and start a Vibe event watcher
 */
async function createVibeWatcher(options) {
    const watcher = new VibeEventWatcher(options);
    await watcher.start();
    return watcher;
}
//# sourceMappingURL=VibeEventWatcher.js.map