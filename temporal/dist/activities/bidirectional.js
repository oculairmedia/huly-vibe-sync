"use strict";
/**
 * Bidirectional Sync Activities
 *
 * Activities for syncing between Huly, Vibe, and Beads in all directions.
 * Each activity handles one direction of sync.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVibeTask = getVibeTask;
exports.getHulyIssue = getHulyIssue;
exports.getBeadsIssue = getBeadsIssue;
exports.syncVibeToHuly = syncVibeToHuly;
exports.syncVibeToBeads = syncVibeToBeads;
exports.syncHulyToVibe = syncHulyToVibe;
exports.syncHulyToBeads = syncHulyToBeads;
exports.syncBeadsToHuly = syncBeadsToHuly;
exports.syncBeadsToVibe = syncBeadsToVibe;
exports.commitBeadsChanges = commitBeadsChanges;
const activity_1 = require("@temporalio/activity");
const lib_1 = require("../lib");
// ============================================================
// GET ISSUE ACTIVITIES (for conflict resolution)
// ============================================================
/** @deprecated VibeKanban removed */
async function getVibeTask(input) {
    return null;
}
async function getHulyIssue(input) {
    try {
        const client = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        return await client.getIssue(input.identifier);
    }
    catch {
        return null;
    }
}
async function getBeadsIssue(input) {
    try {
        const client = (0, lib_1.createBeadsClient)(input.gitRepoPath);
        return await client.getIssue(input.issueId);
    }
    catch {
        return null;
    }
}
// ============================================================
// VIBE → OTHER SYSTEMS
// ============================================================
/** @deprecated VibeKanban removed */
async function syncVibeToHuly(input) {
    return { success: true, skipped: true };
}
/** @deprecated VibeKanban removed */
async function syncVibeToBeads(input) {
    return { success: true, skipped: true };
}
// ============================================================
// HULY → OTHER SYSTEMS
// ============================================================
/** @deprecated VibeKanban removed */
async function syncHulyToVibe(input) {
    return { success: true, skipped: true };
}
/**
 * Sync Huly issue to Beads
 */
async function syncHulyToBeads(input) {
    const { hulyIssue, existingBeadsId, context } = input;
    if (!context.gitRepoPath) {
        return { success: true, skipped: true };
    }
    console.log(`[Sync] Huly → Beads: ${hulyIssue.id}`);
    try {
        const client = (0, lib_1.createBeadsClient)(context.gitRepoPath);
        const beadsStatus = (0, lib_1.mapHulyStatusToBeadsSimple)(hulyIssue.status);
        const beadsPriority = (0, lib_1.mapHulyPriorityToBeads)(hulyIssue.priority);
        if (existingBeadsId) {
            const updated = await client.updateStatus(existingBeadsId, beadsStatus);
            console.log(`[Sync] Huly → Beads: Updated ${existingBeadsId}`);
            return { success: true, id: updated.id, updated: true };
        }
        // Check for existing by title
        const existing = await client.findByTitle(hulyIssue.title);
        if (existing) {
            if (existing.status !== beadsStatus) {
                const updated = await client.updateStatus(existing.id, beadsStatus);
                console.log(`[Sync] Huly → Beads: Found and updated ${updated.id}`);
                return { success: true, id: updated.id, updated: true };
            }
            return { success: true, id: existing.id, skipped: true };
        }
        // Create new issue
        const issue = await client.createIssue({
            title: hulyIssue.title,
            description: hulyIssue.description
                ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.id}`
                : `Synced from Huly: ${hulyIssue.id}`,
            status: beadsStatus,
            priority: beadsPriority,
            labels: [`huly:${hulyIssue.id}`],
        });
        console.log(`[Sync] Huly → Beads: Created ${issue.id}`);
        return { success: true, id: issue.id, created: true };
    }
    catch (error) {
        // Beads errors non-fatal
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Sync] Huly → Beads: Non-fatal error: ${errorMsg}`);
        return { success: true, skipped: true, error: errorMsg };
    }
}
// ============================================================
// BEADS → OTHER SYSTEMS
// ============================================================
/**
 * Sync Beads issue to Huly
 */
async function syncBeadsToHuly(input) {
    const { beadsIssue, hulyIdentifier } = input;
    console.log(`[Sync] Beads → Huly: ${beadsIssue.id} → ${hulyIdentifier}`);
    try {
        const client = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        const patch = {};
        // Only sync status for intentional state changes, never for 'open' (default)
        const FORWARD_STATUSES = ['in_progress', 'closed', 'blocked', 'deferred'];
        if (FORWARD_STATUSES.includes(beadsIssue.status)) {
            patch.status = (0, lib_1.mapBeadsStatusToHuly)(beadsIssue.status);
        }
        if (beadsIssue.title) {
            patch.title = beadsIssue.title;
        }
        if (beadsIssue.description !== undefined) {
            patch.description = beadsIssue.description;
        }
        if (Object.keys(patch).length === 0) {
            console.log(`[Sync] Beads → Huly: Skipping ${hulyIdentifier} (no actionable changes)`);
            return { success: true, id: hulyIdentifier, updated: false };
        }
        await client.patchIssue(hulyIdentifier, patch);
        console.log(`[Sync] Beads → Huly: Patched ${hulyIdentifier} (fields=${Object.keys(patch).join(',')})`);
        return { success: true, id: hulyIdentifier, updated: true };
    }
    catch (error) {
        return handleError(error, 'Beads→Huly');
    }
}
/** @deprecated VibeKanban removed */
async function syncBeadsToVibe(input) {
    return { success: true, skipped: true };
}
// ============================================================
// UTILITY ACTIVITIES
// ============================================================
/**
 * Commit Beads changes to git
 */
async function commitBeadsChanges(input) {
    try {
        const client = (0, lib_1.createBeadsClient)(input.gitRepoPath);
        if (!client.hasUncommittedChanges()) {
            return { success: true, skipped: true };
        }
        const committed = await client.commitChanges(input.message);
        return { success: true, updated: committed };
    }
    catch (error) {
        // Git errors non-fatal
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Sync] Git commit: Non-fatal error: ${errorMsg}`);
        return { success: true, skipped: true, error: errorMsg };
    }
}
// ============================================================
// ERROR HANDLING
// ============================================================
function handleError(error, direction) {
    if (error instanceof activity_1.ApplicationFailure) {
        throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();
    // Non-retryable: validation, not found, auth errors
    if (lowerMessage.includes('404') ||
        lowerMessage.includes('not found') ||
        lowerMessage.includes('400') ||
        lowerMessage.includes('422') ||
        lowerMessage.includes('validation') ||
        lowerMessage.includes('deserialize') ||
        lowerMessage.includes('401') ||
        lowerMessage.includes('403')) {
        throw activity_1.ApplicationFailure.nonRetryable(`${direction} error: ${message}`, 'ValidationError');
    }
    // Retryable: server errors, timeouts, network
    if (lowerMessage.includes('500') ||
        lowerMessage.includes('502') ||
        lowerMessage.includes('503') ||
        lowerMessage.includes('timeout') ||
        lowerMessage.includes('econnrefused') ||
        lowerMessage.includes('network')) {
        throw activity_1.ApplicationFailure.retryable(`${direction} error: ${message}`, 'ServerError');
    }
    // Default: retryable
    throw activity_1.ApplicationFailure.retryable(`${direction} error: ${message}`, 'SyncError');
}
//# sourceMappingURL=bidirectional.js.map