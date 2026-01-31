/**
 * Data Reconciliation Activities
 *
 * Detects stale Vibe/Beads references in the sync database and
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
    projectsWithVibeChecked: number;
    projectsWithBeadsChecked: number;
    staleVibe: Array<{
        identifier: string;
        projectIdentifier: string;
        vibeTaskId: string;
    }>;
    staleBeads: Array<{
        identifier: string;
        projectIdentifier: string;
        beadsIssueId: string;
    }>;
    updated: {
        markedVibe: number;
        markedBeads: number;
        deleted: number;
    };
    errors: string[];
}
/**
 * Reconcile stale references in the sync database.
 */
export declare function reconcileSyncData(input?: ReconciliationInput): Promise<ReconciliationResult>;
//# sourceMappingURL=reconciliation.d.ts.map