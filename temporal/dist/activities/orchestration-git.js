"use strict";
/**
 * Orchestration Activities — Git & Beads
 *
 * Activities for git repo path resolution and Beads operations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGitRepoPath = resolveGitRepoPath;
exports.extractGitRepoPath = extractGitRepoPath;
exports.initializeBeads = initializeBeads;
exports.fetchBeadsIssues = fetchBeadsIssues;
const lib_1 = require("../lib");
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
        const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        const projects = await hulyClient.listProjects();
        const project = projects.find((p) => p.identifier === projectIdentifier);
        if (!project) {
            console.log(`[Temporal:Orchestration] Project not found for gitRepoPath: ${projectIdentifier}`);
            return null;
        }
        const path = extractGitRepoPath({ description: project.description });
        if (path) {
            console.log(`[Temporal:Orchestration] Resolved gitRepoPath: ${path} for ${projectIdentifier}`);
        }
        else {
            console.log(`[Temporal:Orchestration] No gitRepoPath in description for ${projectIdentifier}`);
        }
        return path;
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
 * Fetch Beads issues from a repository
 */
async function fetchBeadsIssues(input) {
    const { gitRepoPath } = input;
    console.log(`[Temporal:Orchestration] Fetching Beads issues from ${gitRepoPath}`);
    try {
        const beadsClient = (0, lib_1.createBeadsClient)(gitRepoPath);
        if (!beadsClient.isInitialized()) {
            return [];
        }
        const issues = await beadsClient.listIssues();
        console.log(`[Temporal:Orchestration] Found ${issues.length} Beads issues`);
        return issues;
    }
    catch (error) {
        console.warn(`[Temporal:Orchestration] Beads fetch failed: ${error}`);
        return [];
    }
}
//# sourceMappingURL=orchestration-git.js.map