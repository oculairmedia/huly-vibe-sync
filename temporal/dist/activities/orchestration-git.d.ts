/**
 * Orchestration Activities — Git & Beads
 *
 * Activities for git repo path resolution and Beads operations.
 */
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
 * Initialize Beads in a git repository
 */
export declare function initializeBeads(input: {
    gitRepoPath: string;
    projectName: string;
    projectIdentifier: string;
}): Promise<boolean>;
/**
 * Fetch Beads issues from a repository
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