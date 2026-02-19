/**
 * Reconciliation Client Functions
 *
 * Schedule and manage data reconciliation workflows.
 */
export type ReconciliationAction = 'mark_deleted' | 'hard_delete';
export interface DataReconciliationInput {
    projectIdentifier?: string;
    action?: ReconciliationAction;
    dryRun?: boolean;
}
export interface DataReconciliationResult {
    success: boolean;
    action: ReconciliationAction;
    dryRun: boolean;
    projectsProcessed: number;
    projectsWithBeadsChecked: number;
    staleBeads: Array<{
        identifier: string;
        projectIdentifier: string;
        beadsIssueId: string;
    }>;
    updated: {
        markedBeads: number;
        deleted: number;
    };
    errors: string[];
}
export declare function executeDataReconciliation(input?: DataReconciliationInput): Promise<DataReconciliationResult>;
export declare function startScheduledReconciliation(input: {
    intervalMinutes: number;
    maxIterations?: number;
    reconcileOptions?: DataReconciliationInput;
}): Promise<{
    workflowId: string;
    runId: string;
}>;
export declare function getActiveScheduledReconciliation(): Promise<{
    workflowId: string;
    status: string;
    startTime: Date;
    intervalMinutes?: number;
} | null>;
export declare function stopScheduledReconciliation(workflowId?: string): Promise<boolean>;
//# sourceMappingURL=reconciliation.d.ts.map