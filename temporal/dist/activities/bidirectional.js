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
const huly_dedupe_1 = require("./huly-dedupe");
// ============================================================
// GET ISSUE ACTIVITIES (for conflict resolution)
// ============================================================
async function getVibeTask(input) {
    try {
        const client = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        return await client.getTask(input.taskId);
    }
    catch {
        return null;
    }
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
/**
 * Sync Vibe task to Huly
 */
async function syncVibeToHuly(input) {
    const { vibeTask, hulyIdentifier, context } = input;
    console.log(`[Sync] Vibe → Huly: ${vibeTask.id} → ${hulyIdentifier}`);
    try {
        const hulyStatus = (0, lib_1.mapVibeStatusToHuly)(vibeTask.status);
        // Conflict resolution: beads "closed" wins over stale Vibe status.
        // When Phase 3b sets Huly to Done (from beads closed), Vibe SSE fires
        // and tries to revert Huly back to the stale Vibe status. Block that.
        const beadsState = await (0, huly_dedupe_1.getBeadsStatusForHulyIssue)(context.projectIdentifier, hulyIdentifier);
        if (beadsState) {
            const beadsHulyStatus = (0, lib_1.mapBeadsStatusToHuly)(beadsState.beadsStatus);
            if (beadsHulyStatus === 'Done' && hulyStatus !== 'Done') {
                console.log(`[Sync] Vibe → Huly: Skipped ${hulyIdentifier} — beads says closed, Vibe says ${vibeTask.status}. Beads wins.`);
                return { success: true, id: hulyIdentifier, skipped: true };
            }
        }
        const client = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        await client.updateIssue(hulyIdentifier, 'status', hulyStatus);
        console.log(`[Sync] Vibe → Huly: Updated ${hulyIdentifier} to ${hulyStatus}`);
        return { success: true, id: hulyIdentifier, updated: true };
    }
    catch (error) {
        return handleError(error, 'Vibe→Huly');
    }
}
/**
 * Sync Vibe task to Beads
 */
async function syncVibeToBeads(input) {
    const { vibeTask, existingBeadsId, context } = input;
    if (!context.gitRepoPath) {
        return { success: true, skipped: true };
    }
    console.log(`[Sync] Vibe → Beads: ${vibeTask.id}`);
    try {
        const client = (0, lib_1.createBeadsClient)(context.gitRepoPath);
        // Map Vibe status to Beads status
        const beadsStatus = vibeTask.status === 'done' || vibeTask.status === 'cancelled'
            ? 'closed'
            : vibeTask.status === 'inprogress' || vibeTask.status === 'inreview'
                ? 'in_progress'
                : 'open';
        if (existingBeadsId) {
            const updated = await client.updateStatus(existingBeadsId, beadsStatus);
            console.log(`[Sync] Vibe → Beads: Updated ${existingBeadsId}`);
            return { success: true, id: updated.id, updated: true };
        }
        // Create new Beads issue
        const issue = await client.createIssue({
            title: vibeTask.title,
            description: vibeTask.description
                ? `${vibeTask.description}\n\n---\nVibe Task: ${vibeTask.id}`
                : `Synced from Vibe: ${vibeTask.id}`,
            status: beadsStatus,
            labels: [`vibe:${vibeTask.id}`],
        });
        console.log(`[Sync] Vibe → Beads: Created ${issue.id}`);
        return { success: true, id: issue.id, created: true };
    }
    catch (error) {
        // Beads errors non-fatal
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Sync] Vibe → Beads: Non-fatal error: ${errorMsg}`);
        return { success: true, skipped: true, error: errorMsg };
    }
}
// ============================================================
// HULY → OTHER SYSTEMS
// ============================================================
/**
 * Sync Huly issue to Vibe
 */
async function syncHulyToVibe(input) {
    const { hulyIssue, existingVibeId, context } = input;
    if (!context.vibeProjectId) {
        console.log(`[Sync] Huly → Vibe: Skipping ${hulyIssue.id} - no Vibe project`);
        return { success: true, skipped: true };
    }
    console.log(`[Sync] Huly → Vibe: ${hulyIssue.id}`);
    try {
        const client = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        const vibeStatus = (0, lib_1.mapHulyStatusToVibe)(hulyIssue.status);
        if (existingVibeId) {
            await client.updateTask(existingVibeId, 'status', vibeStatus);
            console.log(`[Sync] Huly → Vibe: Updated ${existingVibeId} to ${vibeStatus}`);
            return { success: true, id: existingVibeId, updated: true };
        }
        // Check for existing task by Huly ID
        const existing = await client.findTaskByHulyId(context.vibeProjectId, hulyIssue.id);
        if (existing) {
            await client.updateTask(existing.id, 'status', vibeStatus);
            console.log(`[Sync] Huly → Vibe: Found and updated ${existing.id}`);
            return { success: true, id: existing.id, updated: true };
        }
        // Create new task
        const task = await client.createTask(context.vibeProjectId, {
            title: hulyIssue.title,
            description: hulyIssue.description
                ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.id}`
                : `Synced from Huly: ${hulyIssue.id}`,
            status: vibeStatus,
        });
        console.log(`[Sync] Huly → Vibe: Created ${task.id}`);
        return { success: true, id: task.id, created: true };
    }
    catch (error) {
        return handleError(error, 'Huly→Vibe');
    }
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
        // Map Beads status to Huly (simplified, no label support here)
        const hulyStatus = (0, lib_1.mapBeadsStatusToHuly)(beadsIssue.status);
        await client.updateIssue(hulyIdentifier, 'status', hulyStatus);
        console.log(`[Sync] Beads → Huly: Updated ${hulyIdentifier} to ${hulyStatus}`);
        return { success: true, id: hulyIdentifier, updated: true };
    }
    catch (error) {
        return handleError(error, 'Beads→Huly');
    }
}
/**
 * Sync Beads issue to Vibe
 */
async function syncBeadsToVibe(input) {
    const { beadsIssue, vibeTaskId } = input;
    console.log(`[Sync] Beads → Vibe: ${beadsIssue.id} → ${vibeTaskId}`);
    try {
        const client = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        // Map Beads status to Vibe
        const vibeStatus = (0, lib_1.mapBeadsStatusToVibe)(beadsIssue.status);
        await client.updateTask(vibeTaskId, 'status', vibeStatus);
        console.log(`[Sync] Beads → Vibe: Updated ${vibeTaskId} to ${vibeStatus}`);
        return { success: true, id: vibeTaskId, updated: true };
    }
    catch (error) {
        return handleError(error, 'Beads→Vibe');
    }
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