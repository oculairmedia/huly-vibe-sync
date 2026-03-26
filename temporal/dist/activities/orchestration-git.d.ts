/**
 * Orchestration Activities — Git & Beads
 *
 * Activities for git repo path resolution and Beads operations.
 */
/**
 * Test-only helper to reset module-level cache between test runs.
 */
export declare function clearGitRepoPathCache(): void;
/**
 * Resolve git repo path for a Huly project by identifier.
 * Fetches the project from Huly API and extracts the filesystem path from its description.
 * Returns null (not throws) if project not found or no path configured.
 */
export declare function resolveGitRepoPath(input: {
    projectIdentifier: string;
}): Promise<string | null>;
/**
 * Extract git repo path from Huly project description.
 * Supports: Filesystem:, Path:, Directory:, Location: (case-insensitive)
 */
export declare function extractGitRepoPath(input: {
    description?: string;
}): string | null;
/**
 * Get the DoltQueryService class, lazy-loading it from the ESM module.
 * The class reference is cached after first load.
 *
 * @internal Exposed for test-time replacement via `setDoltQueryServiceClass`.
 */
export declare function getDoltQueryServiceClass(): Promise<any>;
/**
 * Override the DoltQueryService class (for testing).
 * Pass `null` to reset to lazy-loaded default.
 */
export declare function setDoltQueryServiceClass(cls: any): void;
/**
 * Initialize Beads in a git repository
 */
export declare function initializeBeads(input: {
    gitRepoPath: string;
    projectName: string;
    projectIdentifier: string;
}): Promise<boolean>;
/**
 * Fetch Beads issues from a repository via Dolt SQL.
 *
 * Connects to the local Dolt SQL server (port discovered from
 * `.beads/dolt-server.port`), queries active issues with labels,
 * and returns them in the canonical shape expected by callers.
 */
export declare function fetchBeadsIssues(input: {
    gitRepoPath: string;
}): Promise<Array<{
    id: string;
    title: string;
    status: string;
    priority?: number;
    description?: string;
    labels?: string[];
}>>;
//# sourceMappingURL=orchestration-git.d.ts.map