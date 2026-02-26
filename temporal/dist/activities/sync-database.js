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
exports.getDb = getDb;
exports.getIssueSyncTimestamps = getIssueSyncTimestamps;
exports.hasBeadsIssueChanged = hasBeadsIssueChanged;
exports.getIssueSyncState = getIssueSyncState;
exports.getIssueSyncStateBatch = getIssueSyncStateBatch;
exports.persistIssueSyncState = persistIssueSyncState;
exports.persistIssueSyncStateBatch = persistIssueSyncStateBatch;
const path_1 = __importDefault(require("path"));
function appRootModule(modulePath) {
    return path_1.default.join(process.cwd(), modulePath);
}
function resolveDbPath() {
    return process.env.DB_PATH || path_1.default.join(process.cwd(), 'logs', 'sync-state.db');
}
let createSyncDatabaseCached = null;
let computeIssueContentHashCached = null;
let dbInstance = null;
let dbInitPromise = null;
let isDbClosed = false;
async function getDb() {
    if (dbInstance && !isDbClosed) {
        return dbInstance;
    }
    if (dbInitPromise) {
        return dbInitPromise;
    }
    dbInitPromise = (async () => {
        if (!createSyncDatabaseCached) {
            const databaseModule = await Promise.resolve(`${appRootModule('lib/database.js')}`).then(s => __importStar(require(s)));
            createSyncDatabaseCached = databaseModule.createSyncDatabase;
        }
        if (!computeIssueContentHashCached) {
            const utilsModule = await Promise.resolve(`${appRootModule('lib/database/utils.js')}`).then(s => __importStar(require(s)));
            computeIssueContentHashCached = utilsModule.computeIssueContentHash;
        }
        dbInstance = createSyncDatabaseCached(resolveDbPath());
        isDbClosed = false;
        return dbInstance;
    })();
    try {
        return await dbInitPromise;
    }
    finally {
        dbInitPromise = null;
    }
}
async function closeDb() {
    if (!dbInstance || isDbClosed) {
        return;
    }
    try {
        dbInstance.close();
    }
    catch {
    }
    finally {
        isDbClosed = true;
        dbInstance = null;
    }
}
process.on('exit', () => {
    if (dbInstance && !isDbClosed) {
        try {
            dbInstance.close();
        }
        catch {
        }
        finally {
            isDbClosed = true;
            dbInstance = null;
        }
    }
});
process.on('SIGTERM', () => {
    void closeDb().finally(() => {
        process.exit(0);
    });
});
process.on('SIGINT', () => {
    void closeDb().finally(() => {
        process.exit(0);
    });
});
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
    const db = await getDb();
    const issue = db.getIssue(input.identifier);
    if (!issue)
        return null;
    return {
        huly_modified_at: normalizeModifiedAt(issue.huly_modified_at),
        vibe_modified_at: normalizeModifiedAt(issue.vibe_modified_at),
        beads_modified_at: normalizeModifiedAt(issue.beads_modified_at),
    };
}
async function hasBeadsIssueChanged(input) {
    try {
        const db = await getDb();
        const existing = db.getIssue(input.hulyIdentifier);
        if (!existing)
            return true;
        const storedHash = existing.content_hash;
        if (!storedHash)
            return true;
        const newHash = computeIssueContentHashCached({
            title: input.title,
            description: input.description || '',
            status: input.status,
            priority: '',
        });
        return newHash !== storedHash;
    }
    catch {
        return true;
    }
}
async function getIssueSyncState(input) {
    const db = await getDb();
    const issue = db.getIssue(input.hulyIdentifier);
    if (!issue)
        return null;
    return { status: issue.status, beadsStatus: issue.beads_status };
}
async function getIssueSyncStateBatch(input) {
    const db = await getDb();
    const result = {};
    for (const id of input.hulyIdentifiers) {
        const issue = db.getIssue(id);
        if (issue) {
            result[id] = { status: issue.status, beadsStatus: issue.beads_status };
        }
    }
    return result;
}
async function persistIssueSyncState(input) {
    return persistIssueSyncStateBatch({ issues: [input] });
}
async function persistIssueSyncStateBatch(input) {
    const issues = input.issues || [];
    if (issues.length === 0) {
        return { success: true, updated: 0, failed: 0, errors: [] };
    }
    const db = await getDb();
    let updated = 0;
    let failed = 0;
    const errors = [];
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
//# sourceMappingURL=sync-database.js.map