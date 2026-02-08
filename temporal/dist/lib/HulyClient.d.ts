/**
 * Huly REST API Client (TypeScript)
 *
 * Pure TypeScript client for Huly platform.
 * Used by Temporal activities for durable workflow execution.
 */
export interface HulyProject {
    identifier: string;
    name: string;
    description?: string;
    archived?: boolean;
}
export interface HulyIssue {
    identifier: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    assignee?: string;
    component?: string;
    milestone?: string;
    dueDate?: string;
    modifiedOn?: number;
    createdOn?: number;
    parentIssue?: string;
    subIssues?: string[];
}
export interface CreateIssueInput {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    assignee?: string;
    component?: string;
}
export interface HulyClientOptions {
    timeout?: number;
    name?: string;
}
/**
 * Options for bulk fetching issues from multiple projects
 * @see POST /api/issues/bulk-by-projects
 */
export interface BulkByProjectsOptions {
    /** Array of project identifiers (max 100) */
    projects: string[];
    /** Only return issues modified after this ISO 8601 timestamp */
    modifiedSince?: string;
    /** Only return issues created after this ISO 8601 timestamp */
    createdSince?: string;
    /** Max issues per project (default: 1000) */
    limit?: number;
    /** Include issue descriptions (default: true, set false for 5x speed) */
    includeDescriptions?: boolean;
    /** Specific fields to return (default: all) */
    fields?: string[];
}
/**
 * Response from bulk-by-projects endpoint
 */
export interface BulkByProjectsResponse {
    projects: Record<string, {
        issues: HulyIssue[];
        count: number;
        syncMeta?: {
            latestModified: string;
            fetchedAt: string;
        };
        error?: string;
    }>;
    totalIssues: number;
    projectCount: number;
    syncMeta: {
        modifiedSince: string | null;
        createdSince: string | null;
        latestModified: string;
        serverTime: string;
    };
    notFound?: string[];
}
/**
 * A single issue update entry for bulk operations.
 * Each entry specifies an issue identifier and the changes to apply.
 */
export interface BulkUpdateEntry {
    /** Issue identifier (e.g., "HVSYN-925") */
    identifier: string;
    /** Fields to update on this issue */
    changes: Partial<HulyIssue>;
}
/**
 * Options for bulk update operations on issues.
 * The Huly API expects: { updates: [{ identifier, changes }, ...] }
 */
export interface BulkUpdateOptions {
    /** Array of per-issue update entries */
    updates: BulkUpdateEntry[];
}
export interface BulkDeleteOptions {
    /** Issue identifiers to delete (max 100 per request) */
    identifiers: string[];
    /** Whether to cascade delete sub-issues (default: false) */
    cascade?: boolean;
}
export interface BulkDeleteResult {
    succeeded: string[];
    failed: Array<{
        identifier: string;
        error: string;
    }>;
    total: number;
}
/**
 * TypeScript REST client for Huly
 */
export declare class HulyClient {
    private baseUrl;
    private timeout;
    private name;
    constructor(baseUrl: string, options?: HulyClientOptions);
    /**
     * Make an HTTP request with timeout and error handling
     */
    private request;
    /**
     * Test API connectivity
     */
    healthCheck(): Promise<{
        status: string;
        connected: boolean;
    }>;
    listProjects(): Promise<HulyProject[]>;
    listIssues(projectIdentifier: string, options?: {
        modifiedSince?: string;
        limit?: number;
    }): Promise<HulyIssue[]>;
    getIssue(issueIdentifier: string): Promise<HulyIssue | null>;
    createIssue(projectIdentifier: string, data: CreateIssueInput): Promise<HulyIssue>;
    updateIssue(issueIdentifier: string, field: string, value: string): Promise<HulyIssue>;
    patchIssue(issueIdentifier: string, updates: Partial<HulyIssue>): Promise<HulyIssue>;
    deleteIssue(issueIdentifier: string, cascade?: boolean): Promise<boolean>;
    getSubIssues(issueIdentifier: string): Promise<{
        subIssues: HulyIssue[];
        count: number;
    }>;
    createSubIssue(parentIdentifier: string, data: CreateIssueInput): Promise<HulyIssue>;
    getComments(issueIdentifier: string): Promise<Array<{
        id: string;
        text: string;
        createdAt: string;
    }>>;
    createComment(issueIdentifier: string, text: string): Promise<{
        id: string;
        text: string;
    }>;
    listIssuesBulk(options: BulkByProjectsOptions): Promise<BulkByProjectsResponse>;
    getIssuesByIds(identifiers: string[]): Promise<{
        issues: HulyIssue[];
        notFound: string[];
    }>;
    bulkUpdateIssues(options: BulkUpdateOptions): Promise<{
        succeeded: string[];
        failed: Array<{
            identifier: string;
            error: string;
        }>;
    }>;
    bulkDeleteIssues(options: BulkDeleteOptions): Promise<BulkDeleteResult>;
    getProjectTree(projectIdentifier: string): Promise<{
        project: HulyProject;
        issues: HulyIssue[];
        tree: Array<{
            identifier: string;
            children: string[];
        }>;
    }>;
    getProjectComponents(projectIdentifier: string): Promise<{
        components: Array<{
            label: string;
            description?: string;
        }>;
    }>;
    updateProject(projectIdentifier: string, updates: Partial<HulyProject>): Promise<HulyProject>;
    listAllIssues(options?: {
        status?: string;
        limit?: number;
        modifiedSince?: string;
        includeDescriptions?: boolean;
        fields?: string[];
    }): Promise<{
        issues: HulyIssue[];
        count: number;
    }>;
    listIssuesByStatus(status: string, limit?: number): Promise<HulyIssue[]>;
    setParentIssue(issueIdentifier: string, parentIdentifier: string | null): Promise<HulyIssue>;
    syncStatusFromVibe(issueIdentifier: string, hulyStatus: string): Promise<{
        success: boolean;
        issue?: HulyIssue;
        error?: string;
    }>;
}
/**
 * Factory function to create Huly client
 */
export declare function createHulyClient(url?: string, options?: HulyClientOptions): HulyClient;
//# sourceMappingURL=HulyClient.d.ts.map