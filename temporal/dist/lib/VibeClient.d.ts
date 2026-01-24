/**
 * Vibe Kanban REST API Client (TypeScript)
 *
 * Pure TypeScript client for Vibe Kanban platform.
 * Used by Temporal activities for durable workflow execution.
 */
export interface VibeProject {
    id: string;
    name: string;
    git_repo_path?: string;
    created_at?: string;
    updated_at?: string;
}
export interface VibeTask {
    id: string;
    project_id: string;
    title: string;
    description?: string;
    status: 'todo' | 'inprogress' | 'inreview' | 'done' | 'cancelled';
    priority?: string;
    created_at?: string;
    updated_at?: string;
}
export interface CreateTaskInput {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
}
export interface VibeClientOptions {
    timeout?: number;
    name?: string;
}
/**
 * TypeScript REST client for Vibe Kanban
 */
export declare class VibeClient {
    private baseUrl;
    private timeout;
    private name;
    constructor(baseUrl: string, options?: VibeClientOptions);
    /**
     * Make an HTTP request with timeout and error handling
     */
    private request;
    /**
     * Test API connectivity
     */
    healthCheck(): Promise<boolean>;
    listProjects(): Promise<VibeProject[]>;
    getProject(projectId: string): Promise<VibeProject>;
    createProject(data: {
        name: string;
        repositories?: Array<{
            display_name: string;
            git_repo_path: string;
        }>;
    }): Promise<VibeProject>;
    listTasks(projectId: string, options?: {
        status?: string;
        limit?: number;
    }): Promise<VibeTask[]>;
    getTask(taskId: string): Promise<VibeTask>;
    createTask(projectId: string, data: CreateTaskInput): Promise<VibeTask>;
    updateTask(taskId: string, field: string, value: string): Promise<VibeTask>;
    deleteTask(taskId: string): Promise<void>;
    /**
     * Find a task by Huly identifier in description
     */
    findTaskByHulyId(projectId: string, hulyIdentifier: string): Promise<VibeTask | null>;
    /**
     * Create or update a task from a Huly issue
     */
    syncFromHuly(projectId: string, issue: {
        identifier: string;
        title: string;
        description?: string;
        status: string;
    }, vibeStatus: string, existingTaskId?: string): Promise<{
        task: VibeTask | null;
        created: boolean;
        updated: boolean;
        skipped: boolean;
    }>;
    findTaskByBeadsId(projectId: string, beadsId: string): Promise<VibeTask | null>;
    findTaskByTitle(projectId: string, title: string): Promise<VibeTask | null>;
    syncFromBeads(projectId: string, beadsIssue: {
        id: string;
        title: string;
        description?: string;
        status: string;
    }, vibeStatus: string): Promise<{
        task: VibeTask | null;
        created: boolean;
        updated: boolean;
        skipped: boolean;
    }>;
    /**
     * Build lookup indexes from a list of tasks for O(1) access
     */
    buildTaskIndexes(tasks: VibeTask[]): {
        byBeadsId: Map<string, VibeTask>;
        byTitle: Map<string, VibeTask>;
    };
    /**
     * Prefetch all tasks for a project and return with indexes.
     * Call once per project, then use syncFromBeadsWithCache for each issue.
     */
    prefetchTasksForProject(projectId: string): Promise<{
        tasks: VibeTask[];
        byBeadsId: Map<string, VibeTask>;
        byTitle: Map<string, VibeTask>;
    }>;
    /**
     * Sync a beads issue using pre-fetched task indexes (O(1) lookup).
     * Use this after calling prefetchTasksForProject().
     */
    syncFromBeadsWithCache(projectId: string, beadsIssue: {
        id: string;
        title: string;
        description?: string;
        status: string;
    }, vibeStatus: string, cache: {
        byBeadsId: Map<string, VibeTask>;
        byTitle: Map<string, VibeTask>;
    }): Promise<{
        task: VibeTask | null;
        created: boolean;
        updated: boolean;
        skipped: boolean;
    }>;
    /**
     * Batch sync multiple beads issues efficiently.
     * Fetches all tasks ONCE, then processes each issue with O(1) lookups.
     * Reduces API calls from O(2n) to O(1 + creates + updates).
     */
    syncFromBeadsBatch(projectId: string, beadsIssues: Array<{
        id: string;
        title: string;
        description?: string;
        status: string;
        vibeStatus: string;
    }>): Promise<{
        results: Array<{
            beadsId: string;
            task: VibeTask | null;
            created: boolean;
            updated: boolean;
            skipped: boolean;
        }>;
        stats: {
            total: number;
            created: number;
            updated: number;
            skipped: number;
        };
    }>;
}
export declare function createVibeClient(url?: string, options?: VibeClientOptions): VibeClient;
//# sourceMappingURL=VibeClient.d.ts.map