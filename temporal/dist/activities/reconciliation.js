"use strict";
/**
 * Data Reconciliation Activities
 *
 * Detects stale Beads references in the sync database and
 * optionally marks or deletes stale records.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileSyncData = reconcileSyncData;
const path_1 = __importDefault(require("path"));
const activity_1 = require("@temporalio/activity");
const lib_1 = require("../lib");
const { createSyncDatabase } = require(path_1.default.join(process.cwd(), 'lib', 'database.js'));
function resolveDbPath() {
    return process.env.DB_PATH || path_1.default.join(process.cwd(), 'logs', 'sync-state.db');
}
function normalizeId(value) {
    if (value === null || value === undefined)
        return '';
    return String(value);
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
        projectsWithBeadsChecked: 0,
        staleBeads: [],
        updated: { markedBeads: 0, deleted: 0 },
        errors: [],
    };
    const dbPath = resolveDbPath();
    const db = createSyncDatabase(dbPath);
    try {
        const projects = input.projectIdentifier
            ? [db.getProject(input.projectIdentifier)].filter(Boolean)
            : db.getAllProjects();
        result.projectsProcessed = projects.length;
        for (const project of projects) {
            const projectId = project.identifier;
            if (project.filesystem_path) {
                try {
                    const beadsClient = (0, lib_1.createBeadsClient)(project.filesystem_path);
                    if (beadsClient.isInitialized()) {
                        const issues = await beadsClient.listIssues();
                        const beadsIssueIds = new Set(issues.map(issue => normalizeId(issue.id)));
                        const dbIssues = db.getIssuesWithBeadsIssueId(projectId);
                        for (const issue of dbIssues) {
                            const beadsIssueId = normalizeId(issue.beads_issue_id);
                            if (!beadsIssueId || beadsIssueIds.has(beadsIssueId))
                                continue;
                            result.staleBeads.push({
                                identifier: issue.identifier,
                                projectIdentifier: projectId,
                                beadsIssueId,
                            });
                            if (!dryRun) {
                                if (action === 'hard_delete') {
                                    db.deleteIssue(issue.identifier);
                                    result.updated.deleted++;
                                }
                                else {
                                    db.markDeletedFromBeads(issue.identifier);
                                    result.updated.markedBeads++;
                                }
                            }
                        }
                        result.projectsWithBeadsChecked++;
                    }
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    result.errors.push(`[${projectId}] Beads reconcile failed: ${message}`);
                }
            }
        }
        console.log('[Reconcile] Summary', {
            projectsProcessed: result.projectsProcessed,
            projectsWithBeadsChecked: result.projectsWithBeadsChecked,
            staleBeads: result.staleBeads.length,
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