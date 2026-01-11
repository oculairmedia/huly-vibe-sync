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
/**
 * Resolve a project identifier that might be a folder name
 *
 * Handles cases where folder names like "lettatoolsselector" are passed
 * instead of Huly project IDs like "LTSEL".
 *
 * @param projectIdOrFolder - Either a Huly project ID or folder name
 * @returns Resolved project identifier or null if not found
 */
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
 * Extract git repo path from Huly project description
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