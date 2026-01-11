/**
 * Issue Sync Workflow
 *
 * Handles atomic synchronization of issues across Huly, VibeKanban, and Beads.
 * Uses Temporal's durable execution for reliability and visibility.
 */
export interface IssueSyncInput {
    issue: {
        id?: string;
        identifier?: string;
        title: string;
        description?: string;
        status: string;
        priority?: string;
        projectId: string;
        projectIdentifier?: string;
        hulyId?: string;
        vibeId?: string;
        beadsId?: string;
        modifiedAt?: number;
    };
    operation: 'create' | 'update' | 'delete';
    source: 'huly' | 'vibe' | 'beads';
    agentId?: string;
}
export interface IssueSyncResult {
    success: boolean;
    hulyResult?: {
        success: boolean;
        systemId?: string;
        error?: string;
    };
    vibeResult?: {
        success: boolean;
        systemId?: string;
        error?: string;
    };
    beadsResult?: {
        success: boolean;
        systemId?: string;
        error?: string;
    };
    lettaResult?: {
        success: boolean;
        error?: string;
    };
    error?: string;
    duration?: number;
}
/**
 * IssueSyncWorkflow - Atomic sync across all systems
 *
 * Flow:
 * 1. Sync to Huly (if not source)
 * 2. Sync to Vibe (if not source)
 * 3. Sync to Beads (if not source)
 * 4. Update Letta memory (optional)
 *
 * If any critical step fails after retries, the workflow fails
 * and can be inspected in Temporal UI.
 */
export declare function IssueSyncWorkflow(input: IssueSyncInput): Promise<IssueSyncResult>;
/**
 * BatchIssueSyncWorkflow - Sync multiple issues in parallel
 *
 * Useful for full project syncs or bulk operations.
 */
export declare function BatchIssueSyncWorkflow(input: {
    issues: IssueSyncInput[];
    maxParallel?: number;
}): Promise<{
    success: boolean;
    total: number;
    succeeded: number;
    failed: number;
    results: IssueSyncResult[];
}>;
//# sourceMappingURL=issue-sync.d.ts.map