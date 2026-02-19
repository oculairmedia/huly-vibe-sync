/**
 * Orchestration Activities — Project Fetching
 *
 * Activities for fetching and managing Huly/Vibe projects.
 */
import type { HulyProject, HulyIssue } from './orchestration';
/**
 * Test-only helper to reset module-level caches between test runs.
 */
export declare function clearProjectCaches(): void;
/**
 * Fetch all Huly projects
 */
export declare function fetchHulyProjects(): Promise<HulyProject[]>;
export declare function resolveProjectIdentifier(projectIdOrFolder: string): Promise<string | null>;
export declare function fetchProjectData(input: {
    hulyProject: HulyProject;
}): Promise<{
    hulyIssues: HulyIssue[];
}>;
/**
 * Bulk fetch issues from multiple Huly projects in a single API call.
 */
export declare function fetchHulyIssuesBulk(input: {
    projectIdentifiers: string[];
    modifiedSince?: string;
    limit?: number;
}): Promise<Record<string, HulyIssue[]>>;
//# sourceMappingURL=orchestration-projects.d.ts.map