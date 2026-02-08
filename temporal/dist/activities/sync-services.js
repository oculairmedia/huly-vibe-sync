"use strict";
/**
 * Sync Service Activities for Temporal
 *
 * These activities use pure TypeScript clients for Vibe, Huly, and Beads.
 * Provides proper error handling for Temporal retry classification.
 *
 * This is the production-ready implementation using native TypeScript SDKs.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncIssueToVibe = syncIssueToVibe;
exports.syncTaskToHuly = syncTaskToHuly;
exports.syncIssueToBeads = syncIssueToBeads;
exports.syncBeadsToHuly = syncBeadsToHuly;
exports.syncBeadsToHulyBatch = syncBeadsToHulyBatch;
exports.createBeadsIssueInHuly = createBeadsIssueInHuly;
exports.createBeadsIssueInVibe = createBeadsIssueInVibe;
exports.syncBeadsToVibeBatch = syncBeadsToVibeBatch;
exports.commitBeadsToGit = commitBeadsToGit;
const activity_1 = require("@temporalio/activity");
const lib_1 = require("../lib");
const huly_dedupe_1 = require("./huly-dedupe");
function normalizeIssueTitle(title) {
    if (!title)
        return '';
    return title.trim().toLowerCase();
}
async function findExistingBeadsLink(projectIdentifier, hulyIdentifier, title) {
    try {
        const { createSyncDatabase } = await Promise.resolve().then(() => __importStar(require('../../lib/database.js')));
        const dbPath = process.env.DB_PATH || '/opt/stacks/huly-vibe-sync/logs/sync-state.db';
        const db = createSyncDatabase(dbPath);
        try {
            const mapped = db.getIssue?.(hulyIdentifier);
            if (mapped?.beads_issue_id) {
                return String(mapped.beads_issue_id);
            }
            if (title) {
                const rows = db.getProjectIssues?.(projectIdentifier) || [];
                const normalizedTitle = normalizeIssueTitle(title);
                const byTitle = rows.find((row) => !!row?.beads_issue_id && normalizeIssueTitle(row?.title) === normalizedTitle);
                if (byTitle?.beads_issue_id) {
                    return String(byTitle.beads_issue_id);
                }
            }
        }
        finally {
            db.close();
        }
    }
    catch {
        // Non-fatal - fallback to in-memory dedupe only
    }
    return null;
}
function extractParentIdentifierFromDescription(description) {
    if (!description)
        return undefined;
    const match = description.match(/(?:Huly Parent(?: Issue)?|Parent Huly Issue):\s*([A-Z]+-\d+|none|null|top-?level)/i);
    if (!match)
        return undefined;
    const value = match[1].trim();
    if (/^(none|null|top-?level)$/i.test(value)) {
        return null;
    }
    return value.toUpperCase();
}
// ============================================================
// VIBE SYNC ACTIVITIES
// ============================================================
/**
 * Create or update a Vibe task from a Huly issue
 */
async function syncIssueToVibe(input) {
    const { issue, context, existingTaskId, operation } = input;
    console.log(`[Temporal:Vibe] ${operation} task for ${issue.identifier}`);
    try {
        const vibeClient = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        const vibeStatus = (0, lib_1.mapHulyStatusToVibe)(issue.status);
        const result = await vibeClient.syncFromHuly(context.vibeProjectId, {
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description,
            status: issue.status,
            parentIssue: issue.parentIssue,
        }, vibeStatus, existingTaskId);
        if (result.skipped) {
            console.log(`[Temporal:Vibe] Skipped ${issue.identifier} - already exists`);
            return { success: true, skipped: true, id: result.task?.id };
        }
        if (result.created) {
            console.log(`[Temporal:Vibe] Created task for ${issue.identifier}: ${result.task?.id}`);
            return { success: true, created: true, id: result.task?.id };
        }
        if (result.updated) {
            console.log(`[Temporal:Vibe] Updated task for ${issue.identifier}: ${result.task?.id}`);
            return { success: true, updated: true, id: result.task?.id };
        }
        return { success: true, id: result.task?.id };
    }
    catch (error) {
        return handleSyncError(error, 'Vibe');
    }
}
// ============================================================
// HULY SYNC ACTIVITIES
// ============================================================
/**
 * Update a Huly issue from Vibe task changes
 */
async function syncTaskToHuly(input) {
    const { task, hulyIdentifier } = input;
    console.log(`[Temporal:Huly] Updating ${hulyIdentifier} from Vibe task ${task.id}`);
    try {
        const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        const hulyStatus = (0, lib_1.mapVibeStatusToHuly)(task.status);
        const result = await hulyClient.syncStatusFromVibe(hulyIdentifier, hulyStatus);
        if (!result.success) {
            throw new Error(result.error || 'Failed to update Huly issue');
        }
        const desiredParent = extractParentIdentifierFromDescription(task.description);
        if (desiredParent !== undefined) {
            const currentIssue = await hulyClient.getIssue(hulyIdentifier);
            const parentValue = currentIssue?.parentIssue ?? null;
            const currentParent = typeof parentValue === 'string'
                ? parentValue
                : parentValue && typeof parentValue === 'object' && 'identifier' in parentValue
                    ? parentValue.identifier || null
                    : null;
            if (currentParent !== desiredParent) {
                await hulyClient.setParentIssue(hulyIdentifier, desiredParent);
                console.log(`[Temporal:Huly] Updated parent for ${hulyIdentifier}: ${currentParent || 'top-level'} -> ${desiredParent || 'top-level'}`);
            }
        }
        console.log(`[Temporal:Huly] Updated ${hulyIdentifier} status to ${hulyStatus}`);
        return { success: true, id: hulyIdentifier, updated: true };
    }
    catch (error) {
        return handleSyncError(error, 'Huly');
    }
}
// ============================================================
// BEADS SYNC ACTIVITIES
// ============================================================
/**
 * Sync a Huly issue to Beads
 */
async function syncIssueToBeads(input) {
    const { issue, context, existingBeadsIssues } = input;
    if (!context.gitRepoPath) {
        return { success: true, skipped: true };
    }
    const mappedBeadsId = await findExistingBeadsLink(context.projectIdentifier, issue.identifier, issue.title);
    if (mappedBeadsId) {
        console.log(`[Temporal:Beads] Skipped ${issue.identifier} - mapped as ${mappedBeadsId}`);
        return { success: true, skipped: true, id: mappedBeadsId };
    }
    // DEDUPLICATION: Check if issue with same title already exists in Beads
    const normalizedTitle = normalizeIssueTitle(issue.title);
    const existingByTitle = existingBeadsIssues.find(b => normalizeIssueTitle(b.title) === normalizedTitle);
    if (existingByTitle) {
        console.log(`[Temporal:Beads] Skipped ${issue.identifier} - duplicate title exists as ${existingByTitle.id}`);
        return { success: true, skipped: true, id: existingByTitle.id };
    }
    console.log(`[Temporal:Beads] Syncing ${issue.identifier} to Beads`);
    try {
        const beadsClient = (0, lib_1.createBeadsClient)(context.gitRepoPath);
        // Initialize Beads if needed
        if (!beadsClient.isInitialized()) {
            await beadsClient.initialize();
        }
        const beadsStatus = (0, lib_1.mapHulyStatusToBeadsSimple)(issue.status);
        const beadsPriority = (0, lib_1.mapHulyPriorityToBeads)(issue.priority);
        const result = await beadsClient.syncFromHuly({
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description,
            status: issue.status,
            priority: issue.priority,
        }, beadsStatus, beadsPriority);
        if (result.skipped) {
            console.log(`[Temporal:Beads] Skipped ${issue.identifier} - already synced`);
            return { success: true, skipped: true, id: result.issue?.id };
        }
        if (result.created) {
            console.log(`[Temporal:Beads] Created issue for ${issue.identifier}: ${result.issue?.id}`);
            return { success: true, created: true, id: result.issue?.id };
        }
        if (result.updated) {
            console.log(`[Temporal:Beads] Updated issue for ${issue.identifier}: ${result.issue?.id}`);
            return { success: true, updated: true, id: result.issue?.id };
        }
        return { success: true, id: result.issue?.id };
    }
    catch (error) {
        // Beads errors are non-fatal - log but don't fail workflow
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Temporal:Beads] Non-fatal error: ${errorMsg}`);
        return { success: true, skipped: true, error: errorMsg };
    }
}
/**
 * Sync Beads changes back to Huly
 */
async function syncBeadsToHuly(input) {
    const { beadsIssue, hulyIdentifier } = input;
    console.log(`[Temporal:Beads→Huly] Syncing ${beadsIssue.id} to ${hulyIdentifier}`);
    try {
        const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        // Map Beads status to Huly status
        // Note: We'd need labels from the Beads issue for accurate mapping
        const hulyStatus = beadsIssue.status === 'closed'
            ? 'Done'
            : beadsIssue.status === 'in_progress'
                ? 'In Progress'
                : 'Backlog';
        const result = await hulyClient.syncStatusFromVibe(hulyIdentifier, hulyStatus);
        if (!result.success) {
            throw new Error(result.error || 'Failed to update Huly issue');
        }
        console.log(`[Temporal:Beads→Huly] Updated ${hulyIdentifier} from Beads`);
        return { success: true, id: hulyIdentifier, updated: true };
    }
    catch (error) {
        return handleSyncError(error, 'Beads→Huly');
    }
}
async function syncBeadsToHulyBatch(input) {
    const { beadsIssues } = input;
    if (beadsIssues.length === 0) {
        return { success: true, updated: 0, failed: 0, errors: [] };
    }
    console.log(`[Temporal:Beads→Huly] Batch syncing ${beadsIssues.length} issues`);
    try {
        const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        const updates = beadsIssues.map(issue => ({
            identifier: issue.hulyIdentifier,
            changes: { status: (0, lib_1.mapBeadsStatusToHuly)(issue.status) },
        }));
        console.log(`[Temporal:Beads→Huly] Syncing ${updates.length} issues in batches of 25`);
        let totalUpdated = 0;
        let totalFailed = 0;
        const allErrors = [];
        const BATCH_SIZE = 25;
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            console.log(`[Temporal:Beads→Huly] Batch ${Math.floor(i / BATCH_SIZE) + 1}: updating ${batch.length} issues`);
            try {
                const result = await hulyClient.bulkUpdateIssues({ updates: batch });
                totalUpdated += result.succeeded.length;
                totalFailed += result.failed.length;
                allErrors.push(...result.failed);
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error(`[Temporal:Beads→Huly] Bulk update failed: ${errorMsg}`);
                totalFailed += batch.length;
                for (const entry of batch) {
                    allErrors.push({ identifier: entry.identifier, error: errorMsg });
                }
            }
        }
        console.log(`[Temporal:Beads→Huly] Batch complete: ${totalUpdated} updated, ${totalFailed} failed`);
        return {
            success: totalFailed === 0,
            updated: totalUpdated,
            failed: totalFailed,
            errors: allErrors,
        };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            updated: 0,
            failed: beadsIssues.length,
            errors: beadsIssues.map(i => ({ identifier: i.hulyIdentifier, error: errorMsg })),
        };
    }
}
async function createBeadsIssueInHuly(input) {
    const { beadsIssue, context } = input;
    if (beadsIssue.labels?.some(l => l.startsWith('huly:'))) {
        console.log(`[Temporal:Beads→Huly] Skipping ${beadsIssue.id} - already has huly label`);
        return { success: true, skipped: true };
    }
    console.log(`[Temporal:Beads→Huly] Creating Huly issue for ${beadsIssue.id}`);
    try {
        const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        const mappedByBeads = await (0, huly_dedupe_1.findMappedIssueByBeadsId)(context.projectIdentifier, beadsIssue.id);
        if (mappedByBeads) {
            return {
                success: true,
                skipped: true,
                id: mappedByBeads,
                hulyIdentifier: mappedByBeads,
            };
        }
        let existingIssue = null;
        const mappedByTitle = await (0, huly_dedupe_1.findMappedIssueByTitle)(context.projectIdentifier, beadsIssue.title);
        if (mappedByTitle) {
            existingIssue = await hulyClient.getIssue(mappedByTitle);
        }
        if (existingIssue) {
            console.log(`[Temporal:Beads→Huly] Found existing Huly issue ${existingIssue.identifier} for "${beadsIssue.title}"`);
            if (context.gitRepoPath) {
                try {
                    const beadsClient = (0, lib_1.createBeadsClient)(context.gitRepoPath);
                    await beadsClient.addLabel(beadsIssue.id, `huly:${existingIssue.identifier}`);
                    console.log(`[Temporal:Beads→Huly] Linked ${beadsIssue.id} to existing ${existingIssue.identifier}`);
                }
                catch (labelError) {
                    console.warn(`[Temporal:Beads→Huly] Failed to add label: ${labelError}`);
                }
            }
            return {
                success: true,
                skipped: true,
                id: existingIssue.identifier,
                hulyIdentifier: existingIssue.identifier,
            };
        }
        const priorityMap = { 0: 'Urgent', 1: 'High', 2: 'Medium', 3: 'Low' };
        const hulyPriority = priorityMap[beadsIssue.priority ?? 2] || 'Medium';
        const hulyStatus = beadsIssue.status === 'closed'
            ? 'Done'
            : beadsIssue.status === 'in_progress'
                ? 'In Progress'
                : 'Backlog';
        const description = [beadsIssue.description || '', '', '---', `Beads Issue: ${beadsIssue.id}`]
            .join('\n')
            .trim();
        const result = (await hulyClient.createIssue(context.projectIdentifier, {
            title: beadsIssue.title,
            description,
            priority: hulyPriority,
            status: hulyStatus,
        }));
        if (!result?.identifier) {
            throw new Error('Failed to create Huly issue - no identifier returned');
        }
        console.log(`[Temporal:Beads→Huly] Created ${result.identifier} from ${beadsIssue.id}`);
        if (context.gitRepoPath) {
            try {
                const beadsClient = (0, lib_1.createBeadsClient)(context.gitRepoPath);
                await beadsClient.addLabel(beadsIssue.id, `huly:${result.identifier}`);
                console.log(`[Temporal:Beads→Huly] Added huly:${result.identifier} label to ${beadsIssue.id}`);
            }
            catch (labelError) {
                console.warn(`[Temporal:Beads→Huly] Failed to update beads label: ${labelError}`);
            }
        }
        return {
            success: true,
            created: true,
            id: result.identifier,
            hulyIdentifier: result.identifier,
        };
    }
    catch (error) {
        return handleSyncError(error, 'Beads→Huly Create');
    }
}
async function createBeadsIssueInVibe(input) {
    const { beadsIssue, context } = input;
    if (beadsIssue.labels?.some(l => l.startsWith('vibe:'))) {
        console.log(`[Temporal:Beads→Vibe] Skipping ${beadsIssue.id} - already has vibe label`);
        return { success: true, skipped: true };
    }
    console.log(`[Temporal:Beads→Vibe] Creating Vibe task for ${beadsIssue.id}`);
    try {
        const vibeClient = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        const vibeStatus = (0, lib_1.mapBeadsStatusToVibe)(beadsIssue.status);
        const result = await vibeClient.syncFromBeads(context.vibeProjectId, {
            id: beadsIssue.id,
            title: beadsIssue.title,
            description: beadsIssue.description,
            status: beadsIssue.status,
        }, vibeStatus);
        if (result.skipped) {
            console.log(`[Temporal:Beads→Vibe] Skipped ${beadsIssue.id} - already exists`);
            return { success: true, skipped: true, id: result.task?.id, vibeTaskId: result.task?.id };
        }
        if (result.created && result.task) {
            console.log(`[Temporal:Beads→Vibe] Created task ${result.task.id} from ${beadsIssue.id}`);
            if (context.gitRepoPath) {
                try {
                    const beadsClient = (0, lib_1.createBeadsClient)(context.gitRepoPath);
                    await beadsClient.addLabel(beadsIssue.id, `vibe:${result.task.id}`);
                    console.log(`[Temporal:Beads→Vibe] Added vibe:${result.task.id} label to ${beadsIssue.id}`);
                }
                catch (labelError) {
                    console.warn(`[Temporal:Beads→Vibe] Failed to add label: ${labelError}`);
                }
            }
            return { success: true, created: true, id: result.task.id, vibeTaskId: result.task.id };
        }
        if (result.updated && result.task) {
            console.log(`[Temporal:Beads→Vibe] Updated task ${result.task.id} from ${beadsIssue.id}`);
            return { success: true, updated: true, id: result.task.id, vibeTaskId: result.task.id };
        }
        return { success: true, skipped: true };
    }
    catch (error) {
        return handleSyncError(error, 'Beads→Vibe Create');
    }
}
/**
 * Batch sync beads issues to Vibe - O(1) lookups after single prefetch.
 * Replaces N individual createBeadsIssueInVibe calls with a single batch operation.
 */
async function syncBeadsToVibeBatch(input) {
    const { beadsIssues, context } = input;
    const issuesToSync = beadsIssues.filter(issue => !issue.labels?.some(l => l.startsWith('vibe:')));
    if (issuesToSync.length === 0) {
        console.log(`[Temporal:Beads→Vibe] All ${beadsIssues.length} issues already synced`);
        return {
            success: true,
            stats: { total: beadsIssues.length, created: 0, updated: 0, skipped: beadsIssues.length },
            results: beadsIssues.map(i => ({
                beadsId: i.id,
                created: false,
                updated: false,
                skipped: true,
            })),
        };
    }
    console.log(`[Temporal:Beads→Vibe] Batch syncing ${issuesToSync.length} issues to Vibe`);
    try {
        const vibeClient = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        const batchInput = issuesToSync.map(issue => ({
            id: issue.id,
            title: issue.title,
            description: issue.description,
            status: issue.status,
            vibeStatus: (0, lib_1.mapBeadsStatusToVibe)(issue.status),
        }));
        const { results: batchResults, stats } = await vibeClient.syncFromBeadsBatch(context.vibeProjectId, batchInput);
        const results = batchResults.map(r => ({
            beadsId: r.beadsId,
            vibeTaskId: r.task?.id,
            created: r.created,
            updated: r.updated,
            skipped: r.skipped,
        }));
        if (context.gitRepoPath) {
            const beadsClient = (0, lib_1.createBeadsClient)(context.gitRepoPath);
            for (const r of results) {
                if (r.created && r.vibeTaskId) {
                    try {
                        await beadsClient.addLabel(r.beadsId, `vibe:${r.vibeTaskId}`);
                    }
                    catch (labelError) {
                        console.warn(`[Temporal:Beads→Vibe] Failed to add label to ${r.beadsId}: ${labelError}`);
                    }
                }
            }
        }
        console.log(`[Temporal:Beads→Vibe] Batch complete: ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped`);
        return { success: true, stats, results };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Temporal:Beads→Vibe] Batch sync failed: ${msg}`);
        return {
            success: false,
            stats: { total: issuesToSync.length, created: 0, updated: 0, skipped: 0 },
            results: [],
        };
    }
}
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
        // Git errors are non-fatal
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Temporal:Git] Non-fatal error: ${errorMsg}`);
        return { success: true, skipped: true, error: errorMsg };
    }
}
// ============================================================
// ERROR HANDLING
// ============================================================
/**
 * Handle sync errors with proper Temporal classification
 */
function handleSyncError(error, system) {
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
        throw activity_1.ApplicationFailure.nonRetryable(`${system} error: ${message}`, `${system}ValidationError`);
    }
    // Retryable: server errors, timeouts, network
    if (lowerMessage.includes('500') ||
        lowerMessage.includes('502') ||
        lowerMessage.includes('503') ||
        lowerMessage.includes('timeout') ||
        lowerMessage.includes('econnrefused') ||
        lowerMessage.includes('network')) {
        throw activity_1.ApplicationFailure.retryable(`${system} error: ${message}`, `${system}ServerError`);
    }
    // Default: retryable (safer)
    throw activity_1.ApplicationFailure.retryable(`${system} error: ${message}`, `${system}Error`);
}
//# sourceMappingURL=sync-services.js.map