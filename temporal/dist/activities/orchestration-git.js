"use strict";
/**
 * Orchestration Activities — Git & Beads
 *
 * Activities for git repo path resolution and Beads operations.
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
exports.clearGitRepoPathCache = clearGitRepoPathCache;
exports.resolveGitRepoPath = resolveGitRepoPath;
exports.extractGitRepoPath = extractGitRepoPath;
exports.getDoltQueryServiceClass = getDoltQueryServiceClass;
exports.setDoltQueryServiceClass = setDoltQueryServiceClass;
exports.initializeBeads = initializeBeads;
exports.fetchBeadsIssues = fetchBeadsIssues;
const path_1 = __importDefault(require("path"));
const lib_1 = require("../lib");
const sync_database_1 = require("./sync-database");
function appRootModule(modulePath) {
    return path_1.default.join(process.cwd(), modulePath);
}
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
// DOLT QUERY SERVICE LOADER
// ============================================================
/** Cached reference to the DoltQueryService class (lazy-loaded from ESM). */
let _DoltQueryServiceClass = null;
/**
 * Get the DoltQueryService class, lazy-loading it from the ESM module.
 * The class reference is cached after first load.
 *
 * @internal Exposed for test-time replacement via `setDoltQueryServiceClass`.
 */
async function getDoltQueryServiceClass() {
    if (!_DoltQueryServiceClass) {
        const mod = await Promise.resolve(`${appRootModule('lib/DoltQueryService.js')}`).then(s => __importStar(require(s)));
        _DoltQueryServiceClass = mod.DoltQueryService;
    }
    return _DoltQueryServiceClass;
}
/**
 * Override the DoltQueryService class (for testing).
 * Pass `null` to reset to lazy-loaded default.
 */
function setDoltQueryServiceClass(cls) {
    _DoltQueryServiceClass = cls;
}
// ============================================================
// BEADS ACTIVITIES
// ============================================================
/**
 * Initialize Beads in a git repository
 */
async function initializeBeads(input) {
    const { gitRepoPath, projectName } = input;
    console.log(`[Temporal:Orchestration] Initializing Beads in ${gitRepoPath}`);
    try {
        const beadsClient = (0, lib_1.createBeadsClient)(gitRepoPath);
        if (beadsClient.isInitialized()) {
            console.log(`[Temporal:Orchestration] Beads already initialized`);
            return true;
        }
        await beadsClient.initialize();
        console.log(`[Temporal:Orchestration] Beads initialized for ${projectName}`);
        return true;
    }
    catch (error) {
        // Non-fatal - log and continue
        console.warn(`[Temporal:Orchestration] Beads init failed: ${error}`);
        return false;
    }
}
/**
 * Fetch Beads issues from a repository via Dolt SQL.
 *
 * Connects to the local Dolt SQL server (port discovered from
 * `.beads/dolt-server.port`), queries active issues with labels,
 * and returns them in the canonical shape expected by callers.
 */
async function fetchBeadsIssues(input) {
    const { gitRepoPath } = input;
    console.log(`[Temporal:Orchestration] Fetching Beads issues from Dolt: ${gitRepoPath}`);
    try {
        const DoltQueryServiceClass = await getDoltQueryServiceClass();
        const dolt = new DoltQueryServiceClass();
        await dolt.connect(gitRepoPath);
        try {
            // Query active issues (exclude tombstones) with labels joined
            const [rows] = await dolt.pool.execute(`SELECT i.*, GROUP_CONCAT(l.label) AS labels
         FROM issues i
         LEFT JOIN labels l ON i.id = l.issue_id
         WHERE i.status != 'tombstone'
         GROUP BY i.id
         ORDER BY i.updated_at DESC`);
            const issues = rows.map((row) => ({
                id: row.id,
                title: row.title,
                status: row.status,
                priority: row.priority != null ? Number(row.priority) : undefined,
                description: row.description || undefined,
                labels: row.labels ? row.labels.split(',') : [],
            }));
            console.log(`[Temporal:Orchestration] Found ${issues.length} Beads issues from Dolt`);
            return issues;
        }
        finally {
            await dolt.disconnect();
        }
    }
    catch (error) {
        console.warn(`[Temporal:Orchestration] Beads Dolt fetch failed: ${error}`);
        return [];
    }
}
//# sourceMappingURL=orchestration-git.js.map