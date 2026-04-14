"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileSyncData = reconcileSyncData;
const path_1 = __importDefault(require("path"));
const activity_1 = require("@temporalio/activity");
const { createSyncDatabase } = require(path_1.default.join(process.cwd(), 'lib', 'database.js'));
function resolveDbPath() {
    return process.env.DB_PATH || path_1.default.join(process.cwd(), 'logs', 'sync-state.db');
}
function handleReconciliationError(error, context) {
    const message = error instanceof Error ? error.message : String(error);
    throw activity_1.ApplicationFailure.retryable(`Reconciliation failed (${context}): ${message}`, 'ReconcileError');
}
async function reconcileSyncData(input = {}) {
    const action = input.action || process.env.RECONCILIATION_ACTION || 'mark_deleted';
    const dryRun = input.dryRun ?? process.env.RECONCILIATION_DRY_RUN === 'true';
    const result = {
        success: false,
        action,
        dryRun,
        projectsProcessed: 0,
        projectsChecked: 0,
        staleIssues: [],
        updated: { markedDeleted: 0, deleted: 0 },
        errors: [],
    };
    const dbPath = resolveDbPath();
    const db = createSyncDatabase(dbPath);
    try {
        const projects = input.projectIdentifier
            ? [db.getProject(input.projectIdentifier)].filter(Boolean)
            : db.getAllProjects();
        result.projectsProcessed = projects.length;
        console.log('[Reconcile] Legacy tracker reconciliation skipped; integration removed');
        console.log('[Reconcile] Summary', {
            projectsProcessed: result.projectsProcessed,
            projectsChecked: result.projectsChecked,
            staleIssues: result.staleIssues.length,
            action: result.action,
            dryRun: result.dryRun,
        });
        result.success = result.errors.length === 0;
        return result;
    }
    catch (error) {
        handleReconciliationError(error, 'reconcileSyncData');
    }
    finally {
        db.close();
    }
}
//# sourceMappingURL=reconciliation.js.map