"use strict";
/**
 * Sync Service Activities for Temporal
 *
 * Beads git commit activity. Huly-specific sync functions removed in Phase 4.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.commitBeadsToGit = commitBeadsToGit;
const lib_1 = require("../lib");
// ============================================================
// BEADS GIT ACTIVITIES
// ============================================================
async function commitBeadsToGit(input) {
    const { context, message } = input;
    if (!context.gitRepoPath) {
        return { success: true, skipped: true };
    }
    console.log(`[Temporal:Git] Committing Beads changes in ${context.gitRepoPath}`);
    try {
        const beadsClient = (0, lib_1.createBeadsClient)(context.gitRepoPath);
        if (!beadsClient.isGitRepository()) {
            return { success: true, skipped: true };
        }
        if (!beadsClient.hasUncommittedChanges()) {
            console.log(`[Temporal:Git] No uncommitted Beads changes`);
            return { success: true, skipped: true };
        }
        const committed = await beadsClient.commitChanges(message || 'Sync from VibeSync');
        if (committed) {
            console.log(`[Temporal:Git] Committed Beads changes`);
            return { success: true };
        }
        return { success: true, skipped: true };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Temporal:Git] Non-fatal error: ${errorMsg}`);
        return { success: true, skipped: true, error: errorMsg };
    }
}
//# sourceMappingURL=sync-services.js.map