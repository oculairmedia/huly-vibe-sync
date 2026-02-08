/**
 * Orchestration Activities — Project Fetching
 *
 * Activities for fetching and managing Huly/Vibe projects.
 */
import type { HulyProject, VibeProject, HulyIssue, VibeTask } from './orchestration';
/**
 * Test-only helper to reset module-level caches between test runs.
 */
export declare function clearProjectCaches(): void;
/**
 * Fetch all Huly projects
 */
export declare function fetchHulyProjects(): Promise<HulyProject[]>;
/**
 * Fetch all Vibe projects
 */
export declare function fetchVibeProjects(): Promise<VibeProject[]>;
export declare function getVibeProjectId(hulyProjectIdentifier: string): Promise<string | null>;
export declare function resolveProjectIdentifier(projectIdOrFolder: string): Promise<string | null>;
export declare function ensureVibeProject(input: {
    hulyProject: HulyProject;
    existingVibeProjects: VibeProject[];
}): Promise<VibeProject>;
/**
 * Fetch project data (issues and tasks) for sync
 */
export declare function fetchProjectData(input: {
    hulyProject: HulyProject;
    vibeProjectId: string;
}): Promise<{
    hulyIssues: HulyIssue[];
    vibeTasks: VibeTask[];
}>;
/**
 * Fetch only Vibe tasks that map to specific Huly identifiers via sync DB mappings.
 * Used by webhook-triggered project syncs to avoid full-table task fetches.
 */
export declare function fetchVibeTasksForHulyIssues(input: {
    projectIdentifier: string;
    vibeProjectId: string;
    hulyIssueIdentifiers: string[];
}): Promise<VibeTask[]>;
/**
 * Bulk fetch issues from multiple Huly projects in a single API call.
 */
export declare function fetchHulyIssuesBulk(input: {
    projectIdentifiers: string[];
    modifiedSince?: string;
    limit?: number;
}): Promise<Record<string, HulyIssue[]>>;
//# sourceMappingURL=orchestration-projects.d.ts.map