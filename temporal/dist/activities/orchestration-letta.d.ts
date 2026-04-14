/**
 * Orchestration Activities — Letta, Metrics & Helpers
 *
 * Activities for Letta memory updates, metrics recording, and shared error handling.
 *
 * Builds Letta memory blocks from raw or normalized issue arrays.
 */
interface RawTrackerIssue {
    id: string;
    title: string;
    status: string;
    priority?: number;
    description?: string;
    labels?: string[];
    created_at?: string;
    updated_at?: string;
    issue_type?: string;
    assignee?: string;
    closed_at?: string;
    close_reason?: string;
}
interface NormalizedIssue {
    id: string;
    identifier: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    createdOn: number;
    modifiedOn: number;
    component: string | null;
    assignee: string | null;
}
interface Project {
    name: string;
    identifier: string;
    description?: string;
    status?: string;
}
/**
 * Builds ALL memory blocks (board_metrics, project, board_config, hotspots,
 * backlog_summary, recent_activity, components) and upserts them via the
 * Letta block modify API.
 */
export declare function updateLettaMemory(input: {
    agentId: string;
    project: Project;
    issues?: RawTrackerIssue[] | NormalizedIssue[];
    gitRepoPath?: string;
    gitUrl?: string;
    activityData?: any;
}): Promise<{
    success: boolean;
    error?: string;
    blocksUpdated?: number;
}>;
/**
 * Record sync completion metrics
 */
export declare function recordSyncMetrics(input: {
    projectsProcessed: number;
    issuesSynced: number;
    durationMs: number;
    errors: number;
}): Promise<void>;
export declare function handleOrchestratorError(error: unknown, operation: string): never;
export {};
//# sourceMappingURL=orchestration-letta.d.ts.map