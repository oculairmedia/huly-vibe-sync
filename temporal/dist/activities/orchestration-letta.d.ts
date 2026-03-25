/**
 * Orchestration Activities — Letta, Metrics & Helpers
 *
 * Activities for Letta memory updates, metrics recording, and shared error handling.
 */
interface BeadsIssue {
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
    _beads: {
        raw_status: string;
        raw_priority: number;
        closed_at: string | null;
        close_reason: string | null;
    };
}
interface Project {
    name: string;
    identifier: string;
    description?: string;
    status?: string;
}
/**
 * Update Letta agent memory with project state from beads data
 */
export declare function updateLettaMemory(input: {
    agentId: string;
    project: Project;
    issues: BeadsIssue[];
    gitRepoPath?: string;
    gitUrl?: string;
}): Promise<{
    success: boolean;
    error?: string;
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