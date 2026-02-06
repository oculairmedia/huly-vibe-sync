/**
 * Orchestration Activities — Letta, Metrics & Helpers
 *
 * Activities for Letta memory updates, metrics recording, and shared error handling.
 */
import type { HulyProject, HulyIssue, VibeProject, VibeTask } from './orchestration';
/**
 * Update Letta agent memory with project state
 */
export declare function updateLettaMemory(input: {
    agentId: string;
    hulyProject: HulyProject;
    vibeProject: VibeProject;
    hulyIssues: HulyIssue[];
    vibeTasks: VibeTask[];
    gitRepoPath?: string;
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
export declare function buildBoardMetrics(hulyIssues: HulyIssue[], vibeTasks: VibeTask[]): string;
export declare function buildProjectMeta(hulyProject: HulyProject, hulyIssues: HulyIssue[]): string;
export declare function handleOrchestratorError(error: unknown, operation: string): never;
//# sourceMappingURL=orchestration-letta.d.ts.map