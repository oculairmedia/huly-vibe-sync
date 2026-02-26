"use strict";
/**
 * Shared Huly dedupe helpers for Temporal activities.
 *
 * Uses local sync DB mappings first to avoid expensive Huly API title scans.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTitle = normalizeTitle;
exports.findMappedIssueByBeadsId = findMappedIssueByBeadsId;
exports.getBeadsStatusForHulyIssue = getBeadsStatusForHulyIssue;
exports.findMappedIssueByTitle = findMappedIssueByTitle;
const path_1 = __importDefault(require("path"));
function appRootModule(modulePath) {
    return path_1.default.join(process.cwd(), modulePath);
}
const PROJECT_ISSUES_CACHE_TTL_MS = Number(process.env.TEMPORAL_DEDUPE_CACHE_TTL_MS || 15000);
const projectIssuesCache = new Map();
// Module-level singleton DB connection
let createSyncDatabaseCached = null;
let dbInstance = null;
let isDbClosed = false;
let dbInitPromise = null;
function normalizeTitle(title) {
    if (!title)
        return '';
    return title
        .trim()
        .toLowerCase()
        .replace(/^\[p[0-4]\]\s*/i, '')
        .replace(/^\[perf[^\]]*\]\s*/i, '')
        .replace(/^\[tier\s*\d+\]\s*/i, '')
        .replace(/^\[action\]\s*/i, '')
        .replace(/^\[bug\]\s*/i, '')
        .replace(/^\[fixed\]\s*/i, '')
        .replace(/^\[epic\]\s*/i, '')
        .replace(/^\[wip\]\s*/i, '')
        .trim();
}
function getHulyIdentifier(row) {
    return (row.identifier || row.huly_id || null) ?? null;
}
function resolveDbPath() {
    return process.env.DB_PATH || '/opt/stacks/huly-vibe-sync/logs/sync-state.db';
}
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
async function getProjectIssueIndex(projectIdentifier) {
    const cached = projectIssuesCache.get(projectIdentifier);
    if (cached && cached.expiresAt > Date.now()) {
        return cached;
    }
    const db = await getDb();
    const dbAny = db;
    const rows = (dbAny.getProjectIssues?.(projectIdentifier) || []);
    const byBeadsId = new Map();
    const byNormalizedTitle = new Map();
    const byHulyIdentifier = new Map();
    for (const row of rows) {
        if (row.beads_issue_id) {
            byBeadsId.set(row.beads_issue_id, row);
        }
        const nt = normalizeTitle(row.title || '');
        if (nt) {
            byNormalizedTitle.set(nt, row);
        }
        const hid = getHulyIdentifier(row);
        if (hid) {
            byHulyIdentifier.set(hid, row);
        }
    }
    const index = {
        rows,
        byBeadsId,
        byNormalizedTitle,
        byHulyIdentifier,
        expiresAt: Date.now() + PROJECT_ISSUES_CACHE_TTL_MS,
    };
    projectIssuesCache.set(projectIdentifier, index);
    return index;
}
async function findMappedIssueByBeadsId(projectIdentifier, beadsIssueId) {
    if (!projectIdentifier || !beadsIssueId)
        return null;
    const index = await getProjectIssueIndex(projectIdentifier);
    const match = index.byBeadsId.get(beadsIssueId);
    return match ? getHulyIdentifier(match) : null;
}
async function getBeadsStatusForHulyIssue(projectIdentifier, hulyIdentifier) {
    if (!projectIdentifier || !hulyIdentifier)
        return null;
    const index = await getProjectIssueIndex(projectIdentifier);
    const match = index.byHulyIdentifier.get(hulyIdentifier);
    if (!match?.beads_status)
        return null;
    return {
        beadsStatus: match.beads_status,
        beadsModifiedAt: match.beads_modified_at ?? 0,
    };
}
async function findMappedIssueByTitle(projectIdentifier, title) {
    if (!projectIdentifier || !title)
        return null;
    const target = normalizeTitle(title);
    if (!target)
        return null;
    const index = await getProjectIssueIndex(projectIdentifier);
    const match = index.byNormalizedTitle.get(target);
    return match ? getHulyIdentifier(match) : null;
}
//# sourceMappingURL=huly-dedupe.js.map