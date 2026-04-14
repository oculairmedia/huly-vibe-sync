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
    projectsChecked: number;
    staleIssues: Array<{
        identifier: string;
        projectIdentifier: string;
        issueId: string;
    }>;
    updated: {
        markedDeleted: number;
        deleted: number;
    };
    errors: string[];
}
export declare function reconcileSyncData(input?: ReconciliationInput): Promise<ReconciliationResult>;
//# sourceMappingURL=reconciliation.d.ts.map