/**
 * Event-Triggered Sync Workflows
 *
 * Workflows triggered by external events (Beads file changes, Vibe SSE, Huly webhooks).
 * These are durable replacements for in-memory event callbacks.
 */
export interface BeadsFileChangeInput {
    projectIdentifier: string;
    gitRepoPath: string;
    vibeProjectId: string;
    changedFiles: string[];
    timestamp: string;
}
export interface BeadsFileChangeResult {
    success: boolean;
    issuesProcessed: number;
    issuesSynced: number;
    errors: Array<{
        issueId: string;
        error: string;
    }>;
}
/**
 * BeadsFileChangeWorkflow - Triggered when .beads files change
 *
 * This workflow is the durable replacement for BeadsWatcher callbacks.
 * It fetches all Beads issues and syncs each one to Huly and Vibe.
 */
export declare function BeadsFileChangeWorkflow(input: BeadsFileChangeInput): Promise<BeadsFileChangeResult>;
export interface VibeSSEChangeInput {
    vibeProjectId: string;
    hulyProjectIdentifier?: string;
    changedTaskIds: string[];
    timestamp: string;
}
export interface VibeSSEChangeResult {
    success: boolean;
    tasksProcessed: number;
    tasksSynced: number;
    errors: Array<{
        taskId: string;
        error: string;
    }>;
}
/**
 * VibeSSEChangeWorkflow - Triggered by Vibe SSE events
 *
 * This workflow is the durable replacement for VibeEventWatcher callbacks.
 * It processes batch task changes from the SSE stream and syncs each to Huly.
 */
export declare function VibeSSEChangeWorkflow(input: VibeSSEChangeInput): Promise<VibeSSEChangeResult>;
export interface HulyWebhookChangeInput {
    type: 'task.changed' | 'project.changed';
    changes: Array<{
        id: string;
        class: string;
        modifiedOn?: number;
        data?: {
            identifier?: string;
            title?: string;
            status?: string;
            space?: string;
        };
    }>;
    byProject?: Record<string, unknown[]>;
    timestamp: string;
}
export interface HulyWebhookChangeResult {
    success: boolean;
    issuesProcessed: number;
    issuesSynced: number;
    errors: Array<{
        issueId: string;
        error: string;
    }>;
}
/**
 * HulyWebhookChangeWorkflow - Triggered by Huly webhook events
 *
 * This workflow is the durable replacement for HulyWebhookHandler callbacks.
 * It processes Huly change notifications and syncs to Vibe/Beads.
 */
export declare function HulyWebhookChangeWorkflow(input: HulyWebhookChangeInput): Promise<HulyWebhookChangeResult>;
//# sourceMappingURL=event-sync.d.ts.map