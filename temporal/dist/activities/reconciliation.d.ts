/**
 * Data Reconciliation Activities
 *
 * Detects stale Beads references in the sync database and
 * optionally marks or deletes stale records.
 */
export type ReconciliationAction = 'mark_deleted' | 'hard_delete';
export interface ReconciliationInput {
    projectIdentifier?: string;
    action?: ReconciliationAction;
    dryRun?: boolean;
}
export interface ReconciliationResult {
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
export declare function reconcileSyncData(input?: ReconciliationInput): Promise<ReconciliationResult>;
//# sourceMappingURL=reconciliation.d.ts.map