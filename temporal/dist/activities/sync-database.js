"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIssueSyncTimestamps = getIssueSyncTimestamps;
exports.hasBeadsIssueChanged = hasBeadsIssueChanged;
exports.persistIssueSyncState = persistIssueSyncState;
exports.persistIssueSyncStateBatch = persistIssueSyncStateBatch;
const path_1 = __importDefault(require("path"));
function appRootModule(modulePath) {
    return path_1.default.join(process.cwd(), modulePath);
}
function resolveDbPath() {
    return process.env.DB_PATH || path_1.default.join(process.cwd(), 'logs', 'sync-state.db');
}
function normalizeModifiedAt(value) {
    if (value === undefined || value === null)
        return null;
    if (!Number.isFinite(value))
        return null;
    return Number(value);
}
function defaultHulyId(identifier) {
    return /^[A-Z]+-\d+$/i.test(identifier) ? identifier : null;
}
async function getIssueSyncTimestamps(input) {
    const { createSyncDatabase } = await Promise.resolve(`${appRootModule('lib/database.js')}`).then(s => __importStar(require(s)));
    const db = createSyncDatabase(resolveDbPath());
    try {
        const issue = db.getIssue(input.identifier);
        if (!issue)
            return null;
        return {
            huly_modified_at: normalizeModifiedAt(issue.huly_modified_at),
            vibe_modified_at: normalizeModifiedAt(issue.vibe_modified_at),
            beads_modified_at: normalizeModifiedAt(issue.beads_modified_at),
        };
    }
    finally {
        db.close();
    }
}
async function hasBeadsIssueChanged(input) {
    try {
        const { createSyncDatabase } = await Promise.resolve(`${appRootModule('lib/database.js')}`).then(s => __importStar(require(s)));
        const { computeIssueContentHash } = await Promise.resolve(`${appRootModule('lib/database/utils.js')}`).then(s => __importStar(require(s)));
        const db = createSyncDatabase(resolveDbPath());
        try {
            const existing = db.getIssue(input.hulyIdentifier);
            if (!existing)
                return true;
            const storedHash = existing.content_hash;
            if (!storedHash)
                return true;
            const newHash = computeIssueContentHash({
                title: input.title,
                description: input.description || '',
                status: input.status,
                priority: '',
            });
            return newHash !== storedHash;
        }
        finally {
            db.close();
        }
    }
    catch {
        return true;
    }
}
async function persistIssueSyncState(input) {
    return persistIssueSyncStateBatch({ issues: [input] });
}
async function persistIssueSyncStateBatch(input) {
    const issues = input.issues || [];
    if (issues.length === 0) {
        return { success: true, updated: 0, failed: 0, errors: [] };
    }
    const { createSyncDatabase } = await Promise.resolve(`${appRootModule('lib/database.js')}`).then(s => __importStar(require(s)));
    const db = createSyncDatabase(resolveDbPath());
    let updated = 0;
    let failed = 0;
    const errors = [];
    try {
        for (const issue of issues) {
            try {
                if (!issue.identifier || !issue.projectIdentifier) {
                    throw new Error('identifier and projectIdentifier are required');
                }
                const existing = db.getIssue(issue.identifier);
                db.upsertIssue({
                    identifier: issue.identifier,
                    project_identifier: issue.projectIdentifier,
                    huly_id: issue.hulyId || existing?.huly_id || defaultHulyId(issue.identifier),
                    vibe_task_id: issue.vibeTaskId || existing?.vibe_task_id || null,
                    beads_issue_id: issue.beadsIssueId || existing?.beads_issue_id || null,
                    title: issue.title || existing?.title || issue.identifier,
                    description: issue.description ?? existing?.description ?? '',
                    status: issue.status || existing?.status || 'unknown',
                    priority: issue.priority || existing?.priority || 'medium',
                    huly_modified_at: normalizeModifiedAt(issue.hulyModifiedAt) ??
                        normalizeModifiedAt(existing?.huly_modified_at),
                    vibe_modified_at: normalizeModifiedAt(issue.vibeModifiedAt) ??
                        normalizeModifiedAt(existing?.vibe_modified_at),
                    beads_modified_at: normalizeModifiedAt(issue.beadsModifiedAt) ??
                        normalizeModifiedAt(existing?.beads_modified_at),
                    vibe_status: issue.vibeStatus || existing?.vibe_status || null,
                    beads_status: issue.beadsStatus || existing?.beads_status || null,
                    parent_huly_id: issue.parentHulyId ?? existing?.parent_huly_id ?? null,
                    parent_vibe_id: issue.parentVibeId ?? existing?.parent_vibe_id ?? null,
                    parent_beads_id: issue.parentBeadsId ?? existing?.parent_beads_id ?? null,
                    sub_issue_count: issue.subIssueCount ?? existing?.sub_issue_count ?? 0,
                });
                updated++;
            }
            catch (error) {
                failed++;
                errors.push({
                    identifier: issue.identifier || 'unknown',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return {
            success: failed === 0,
            updated,
            failed,
            errors,
        };
    }
    finally {
        db.close();
    }
}
//# sourceMappingURL=sync-database.js.map