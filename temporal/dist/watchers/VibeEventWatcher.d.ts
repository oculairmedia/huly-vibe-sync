/**
 * Vibe Event Watcher
 *
 * Watches Vibe Kanban for task changes via SSE (Server-Sent Events).
 * Triggers Temporal workflows when tasks change.
 */
interface VibeEvent {
    type: 'task_created' | 'task_updated' | 'task_deleted' | 'task_moved';
    projectId: string;
    taskId: string;
    data?: {
        title?: string;
        status?: string;
        description?: string;
        hulyId?: string;
        beadsId?: string;
    };
}
interface VibeWatcherOptions {
    vibeApiUrl: string;
    projectId: string;
    hulyProjectIdentifier: string;
    gitRepoPath?: string;
    onWorkflowStarted?: (workflowId: string, event: VibeEvent) => void;
    onError?: (error: Error) => void;
}
export declare class VibeEventWatcher {
    private eventSource;
    private options;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectDelay;
    constructor(options: VibeWatcherOptions);
    /**
     * Start watching for Vibe events
     */
    start(): Promise<void>;
    private connect;
    private handleEvent;
    private triggerSync;
    private handleConnectionError;
    /**
     * Stop watching for events
     */
    stop(): void;
}
/**
 * Create and start a Vibe event watcher
 */
export declare function createVibeWatcher(options: VibeWatcherOptions): Promise<VibeEventWatcher>;
export {};
//# sourceMappingURL=VibeEventWatcher.d.ts.map