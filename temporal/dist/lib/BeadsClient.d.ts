/**
 * Beads Issue Tracker Client (TypeScript)
 *
 * TypeScript client for Beads git-based issue tracker.
 * Uses the `bd` CLI command for issue operations.
 * Used by Temporal activities for durable workflow execution.
 */
export interface BeadsIssue {
    id: string;
    title: string;
    status: 'open' | 'in_progress' | 'blocked' | 'deferred' | 'closed';
    priority?: number;
    type?: 'task' | 'bug' | 'feature' | 'epic' | 'chore';
    labels?: string[];
    description?: string;
    created_at?: string;
    updated_at?: string;
}
export interface CreateBeadsIssueInput {
    title: string;
    status?: string;
    priority?: number;
    type?: string;
    labels?: string[];
    description?: string;
}
export interface BeadsClientOptions {
    timeout?: number;
}
/**
 * TypeScript client for Beads issue tracker
 */
export declare class BeadsClient {
    private repoPath;
    private timeout;
    constructor(repoPath: string, options?: BeadsClientOptions);
    /**
     * Check if the repository has Beads initialized
     */
    isInitialized(): boolean;
    /**
     * Initialize Beads in the repository
     */
    initialize(): Promise<void>;
    /**
     * Execute a Beads CLI command
     */
    private execBeads;
    /**
     * Parse JSON output from Beads CLI
     */
    private parseBeadsOutput;
    /**
     * List all issues
     */
    listIssues(): Promise<BeadsIssue[]>;
    /**
     * Get a specific issue by ID
     */
    getIssue(issueId: string): Promise<BeadsIssue | null>;
    /**
     * Create a new issue
     */
    createIssue(data: CreateBeadsIssueInput): Promise<BeadsIssue>;
    /**
     * Update an issue field
     */
    updateIssue(issueId: string, field: string, value: string): Promise<BeadsIssue>;
    /**
     * Update issue status
     */
    updateStatus(issueId: string, status: string): Promise<BeadsIssue>;
    /**
     * Add a label to an issue
     */
    addLabel(issueId: string, label: string): Promise<void>;
    /**
     * Remove a label from an issue
     */
    removeLabel(issueId: string, label: string): Promise<void>;
    /**
     * Check if this is a git repository
     */
    isGitRepository(): boolean;
    /**
     * Check if there are uncommitted Beads changes
     */
    hasUncommittedChanges(): boolean;
    /**
     * Commit Beads changes to git
     */
    commitChanges(message: string): Promise<boolean>;
    /**
     * Find a Beads issue matching a Huly issue by title
     */
    findByTitle(title: string): Promise<BeadsIssue | null>;
    /**
     * Sync a Huly issue to Beads
     */
    syncFromHuly(hulyIssue: {
        identifier: string;
        title: string;
        description?: string;
        status: string;
        priority?: string;
    }, beadsStatus: string, beadsPriority: number): Promise<{
        issue: BeadsIssue | null;
        created: boolean;
        updated: boolean;
        skipped: boolean;
    }>;
}
/**
 * Factory function to create Beads client
 */
export declare function createBeadsClient(repoPath: string, options?: BeadsClientOptions): BeadsClient;
//# sourceMappingURL=BeadsClient.d.ts.map