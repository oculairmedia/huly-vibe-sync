/**
 * Data Reconciliation Workflows
 *
 * Runs periodic reconciliation to detect stale sync records.
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
/**
 * DataReconciliationWorkflow
 */
export declare function DataReconciliationWorkflow(input?: DataReconciliationInput): Promise<DataReconciliationResult>;
/**
 * ScheduledReconciliationWorkflow
 */
export declare function ScheduledReconciliationWorkflow(input: {
    intervalMinutes: number;
    maxIterations?: number;
    reconcileOptions?: DataReconciliationInput;
}): Promise<void>;
//# sourceMappingURL=reconciliation.d.ts.map