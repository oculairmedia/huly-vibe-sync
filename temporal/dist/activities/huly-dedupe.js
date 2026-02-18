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
exports.findMappedIssueByBeadsId = findMappedIssueByBeadsId;
exports.getBeadsStatusForHulyIssue = getBeadsStatusForHulyIssue;
exports.findMappedIssueByTitle = findMappedIssueByTitle;
const path_1 = __importDefault(require("path"));
function appRootModule(modulePath) {
    return path_1.default.join(process.cwd(), modulePath);
}
const PROJECT_ISSUES_CACHE_TTL_MS = Number(process.env.TEMPORAL_DEDUPE_CACHE_TTL_MS || 15000);
const projectIssuesCache = new Map();
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
async function getProjectIssues(projectIdentifier) {
    const cached = projectIssuesCache.get(projectIdentifier);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.rows;
    }
    const { createSyncDatabase } = await Promise.resolve(`${appRootModule('lib/database.js')}`).then(s => __importStar(require(s)));
    const dbPath = process.env.DB_PATH || '/opt/stacks/huly-vibe-sync/logs/sync-state.db';
    const db = createSyncDatabase(dbPath);
    try {
        const dbAny = db;
        const rows = (dbAny.getProjectIssues?.(projectIdentifier) || []);
        projectIssuesCache.set(projectIdentifier, {
            rows,
            expiresAt: Date.now() + PROJECT_ISSUES_CACHE_TTL_MS,
        });
        return rows;
    }
    finally {
        db.close();
    }
}
async function findMappedIssueByBeadsId(projectIdentifier, beadsIssueId) {
    if (!projectIdentifier || !beadsIssueId)
        return null;
    const rows = await getProjectIssues(projectIdentifier);
    const match = rows.find(r => r.beads_issue_id === beadsIssueId);
    return match ? getHulyIdentifier(match) : null;
}
async function getBeadsStatusForHulyIssue(projectIdentifier, hulyIdentifier) {
    if (!projectIdentifier || !hulyIdentifier)
        return null;
    const rows = await getProjectIssues(projectIdentifier);
    const match = rows.find(r => getHulyIdentifier(r) === hulyIdentifier);
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
    const rows = await getProjectIssues(projectIdentifier);
    const match = rows.find(r => normalizeTitle(r.title || '') === target);
    return match ? getHulyIdentifier(match) : null;
}
//# sourceMappingURL=huly-dedupe.js.map