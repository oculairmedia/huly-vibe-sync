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
//# sourceMappingURL=orchestration-git.d.ts.map