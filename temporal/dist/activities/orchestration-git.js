"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearGitRepoPathCache = clearGitRepoPathCache;
exports.resolveGitRepoPath = resolveGitRepoPath;
exports.extractGitRepoPath = extractGitRepoPath;
exports.initializeBeads = initializeBeads;
exports.fetchBeadsIssues = fetchBeadsIssues;
const sync_database_1 = require("./sync-database");
const GIT_PATH_CACHE_TTL_MS = Number(process.env.TEMPORAL_GIT_PATH_CACHE_TTL_MS || 30000);
const gitRepoPathCache = new Map();
/**
 * Test-only helper to reset module-level cache between test runs.
 */
function clearGitRepoPathCache() {
    gitRepoPathCache.clear();
}
function isFresh(expiresAt) {
    return expiresAt > Date.now();
}
async function getGitRepoPathFromSyncDb(projectIdentifier) {
    try {
        const db = await (0, sync_database_1.getDb)();
        const path = db.getProjectFilesystemPath?.(projectIdentifier) ||
            db.getProject?.(projectIdentifier)?.filesystem_path ||
            null;
        return typeof path === 'string' && path.startsWith('/') ? path : null;
    }
    catch (error) {
        console.warn(`[Temporal:Orchestration] sync DB gitRepoPath lookup failed for ${projectIdentifier}: ${error}`);
        return null;
    }
}
// ============================================================
// GIT REPO PATH RESOLUTION
// ============================================================
/**
 * Resolve git repo path for a Huly project by identifier.
 * Fetches the project from Huly API and extracts the filesystem path from its description.
 * Returns null (not throws) if project not found or no path configured.
 */
async function resolveGitRepoPath(input) {
    const { projectIdentifier } = input;
    console.log(`[Temporal:Orchestration] Resolving gitRepoPath for project: ${projectIdentifier}`);
    try {
        const cached = gitRepoPathCache.get(projectIdentifier);
        if (cached && isFresh(cached.expiresAt)) {
            return cached.value;
        }
        const dbPath = await getGitRepoPathFromSyncDb(projectIdentifier);
        gitRepoPathCache.set(projectIdentifier, {
            value: dbPath,
            expiresAt: Date.now() + GIT_PATH_CACHE_TTL_MS,
        });
        if (dbPath) {
            console.log(`[Temporal:Orchestration] Resolved gitRepoPath from DB: ${dbPath} for ${projectIdentifier}`);
        }
        else {
            console.log(`[Temporal:Orchestration] No gitRepoPath in DB for ${projectIdentifier}`);
        }
        return dbPath;
    }
    catch (error) {
        console.warn(`[Temporal:Orchestration] resolveGitRepoPath failed for ${projectIdentifier}: ${error}`);
        return null;
    }
}
/**
 * Extract git repo path from Huly project description.
 * Supports: Filesystem:, Path:, Directory:, Location: (case-insensitive)
 */
function extractGitRepoPath(input) {
    const { description } = input;
    if (!description)
        return null;
    const patterns = [
        /Filesystem:\s*([^\n]+)/i,
        /Path:\s*([^\n]+)/i,
        /Directory:\s*([^\n]+)/i,
        /Location:\s*([^\n]+)/i,
    ];
    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match) {
            const path = match[1].trim().replace(/[,;.]$/, '');
            if (path.startsWith('/')) {
                return path;
            }
        }
    }
    return null;
}
// ============================================================
async function initializeBeads(input) {
    const { gitRepoPath, projectIdentifier } = input;
    console.log(`[Temporal:Orchestration] Tracker initialization skipped for ${projectIdentifier}; beads integration removed (${gitRepoPath})`);
    return false;
}
async function fetchBeadsIssues(input) {
    const { gitRepoPath } = input;
    console.log(`[Temporal:Orchestration] Tracker issue fetch skipped for ${gitRepoPath}; beads integration removed`);
    return [];
}
//# sourceMappingURL=orchestration-git.js.map