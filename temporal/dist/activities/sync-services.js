"use strict";
// ============================================================
// TYPE DEFINITIONS
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.commitBeadsToGit = commitBeadsToGit;
// ============================================================
async function commitBeadsToGit(input) {
    const { context, message } = input;
    if (!context.gitRepoPath) {
        return { success: true, skipped: true };
    }
    console.log(`[Temporal:Git] Skipping legacy tracker commit for ${context.projectIdentifier}; beads integration removed`);
    return {
        success: true,
        skipped: true,
        error: message ? `Skipped legacy tracker commit: ${message}` : 'Skipped legacy tracker commit',
    };
}
//# sourceMappingURL=sync-services.js.map