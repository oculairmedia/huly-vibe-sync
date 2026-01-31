/**
 * Orchestration Activities for Temporal
 *
 * Activities for the FullOrchestrationWorkflow that fetches projects,
 * coordinates sync phases, and updates Letta memory.
 */
export interface HulyProject {
    identifier: string;
    name: string;
    description?: string;
}
export interface VibeProject {
    id: string;
    name: string;
    slug?: string;
}
export interface HulyIssue {
    identifier: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    modifiedOn?: number;
    parentIssue?: string;
    subIssues?: string[];
}
export interface VibeTask {
    id: string;
    title: string;
    description?: string;
    status: string;
    updated_at?: string;
}
export interface ProjectSyncContext {
    hulyProject: HulyProject;
    vibeProject: VibeProject;
    gitRepoPath?: string;
    hulyIssues: HulyIssue[];
    vibeTasks: VibeTask[];
}
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
/**
 * Create or get a Vibe project for a Huly project
 */
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
 * Bulk fetch issues from multiple Huly projects in a single API call.
 * Uses POST /api/issues/bulk-by-projects for ~12s savings per sync cycle.
 */
export declare function fetchHulyIssuesBulk(input: {
    projectIdentifiers: string[];
    modifiedSince?: string;
    limit?: number;
}): Promise<Record<string, HulyIssue[]>>;
/**
 * Resolve git repo path for a Huly project by identifier.
 * Fetches the project from Huly API and extracts the filesystem path from its description.
 * Returns null (not throws) if project not found or no path configured — caller decides severity.
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
//# sourceMappingURL=orchestration.d.ts.map