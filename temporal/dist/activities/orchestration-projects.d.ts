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
 * @deprecated VibeKanban removed — returns empty array for backwards compatibility
 */
export declare function fetchVibeProjects(): Promise<VibeProject[]>;
/**
 * @deprecated VibeKanban removed — always returns null
 */
export declare function getVibeProjectId(hulyProjectIdentifier: string): Promise<string | null>;
export declare function resolveProjectIdentifier(projectIdOrFolder: string): Promise<string | null>;
/**
 * @deprecated VibeKanban removed — returns dummy project for backwards compatibility
 */
export declare function ensureVibeProject(input: {
    hulyProject: HulyProject;
    existingVibeProjects: VibeProject[];
}): Promise<VibeProject>;
export declare function fetchProjectData(input: {
    hulyProject: HulyProject;
    vibeProjectId: string;
}): Promise<{
    hulyIssues: HulyIssue[];
    vibeTasks: VibeTask[];
}>;
/**
 * @deprecated VibeKanban removed — returns empty array
 */
export declare function fetchAllVibeTasks(input: {
    vibeProjectId: string;
}): Promise<VibeTask[]>;
/**
 * @deprecated VibeKanban removed — returns empty array
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