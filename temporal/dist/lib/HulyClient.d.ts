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
    /**
     * Update issue status from Vibe task
     */
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