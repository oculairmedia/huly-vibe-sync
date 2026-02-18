"use strict";
/**
 * Orchestration Activities — Project Fetching
 *
 * Activities for fetching and managing Huly/Vibe projects.
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
exports.clearProjectCaches = clearProjectCaches;
exports.fetchHulyProjects = fetchHulyProjects;
exports.fetchVibeProjects = fetchVibeProjects;
exports.getVibeProjectId = getVibeProjectId;
exports.resolveProjectIdentifier = resolveProjectIdentifier;
exports.ensureVibeProject = ensureVibeProject;
exports.fetchProjectData = fetchProjectData;
exports.fetchAllVibeTasks = fetchAllVibeTasks;
exports.fetchVibeTasksForHulyIssues = fetchVibeTasksForHulyIssues;
exports.fetchHulyIssuesBulk = fetchHulyIssuesBulk;
const activity_1 = require("@temporalio/activity");
const lib_1 = require("../lib");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const orchestration_letta_1 = require("./orchestration-letta");
function appRootModule(modulePath) {
    return path.join(process.cwd(), modulePath);
}
const PROJECT_CACHE_TTL_MS = Number(process.env.TEMPORAL_PROJECT_CACHE_TTL_MS || 30000);
let hulyProjectsCache = null;
let vibeProjectsCache = null;
const vibeProjectIdCache = new Map();
/**
 * Test-only helper to reset module-level caches between test runs.
 */
function clearProjectCaches() {
    hulyProjectsCache = null;
    vibeProjectsCache = null;
    vibeProjectIdCache.clear();
}
function isFresh(expiresAt) {
    return expiresAt > Date.now();
}
async function getCachedHulyProjects() {
    if (hulyProjectsCache && isFresh(hulyProjectsCache.expiresAt)) {
        return hulyProjectsCache.value;
    }
    const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
    const projects = await hulyClient.listProjects();
    hulyProjectsCache = {
        value: projects,
        expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
    };
    return projects;
}
async function getCachedVibeProjects() {
    if (vibeProjectsCache && isFresh(vibeProjectsCache.expiresAt)) {
        return vibeProjectsCache.value;
    }
    const vibeClient = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
    const projects = await vibeClient.listProjects();
    vibeProjectsCache = {
        value: projects,
        expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
    };
    return projects;
}
// ============================================================
// PROJECT FETCHING ACTIVITIES
// ============================================================
/**
 * Fetch all Huly projects
 */
async function fetchHulyProjects() {
    console.log('[Temporal:Orchestration] Fetching Huly projects');
    try {
        const projects = await getCachedHulyProjects();
        console.log(`[Temporal:Orchestration] Found ${projects.length} Huly projects`);
        return projects;
    }
    catch (error) {
        throw (0, orchestration_letta_1.handleOrchestratorError)(error, 'fetchHulyProjects');
    }
}
/**
 * Fetch all Vibe projects
 */
async function fetchVibeProjects() {
    console.log('[Temporal:Orchestration] Fetching Vibe projects');
    try {
        const projects = await getCachedVibeProjects();
        console.log(`[Temporal:Orchestration] Found ${projects.length} Vibe projects`);
        return projects;
    }
    catch (error) {
        throw (0, orchestration_letta_1.handleOrchestratorError)(error, 'fetchVibeProjects');
    }
}
async function getVibeProjectId(hulyProjectIdentifier) {
    console.log(`[Temporal:Orchestration] Looking up Vibe project for: ${hulyProjectIdentifier}`);
    try {
        const cached = vibeProjectIdCache.get(hulyProjectIdentifier);
        if (cached && isFresh(cached.expiresAt)) {
            return cached.value;
        }
        const hulyProjects = await getCachedHulyProjects();
        const hulyProject = hulyProjects.find(p => p.identifier === hulyProjectIdentifier);
        if (!hulyProject) {
            console.log(`[Temporal:Orchestration] Huly project not found: ${hulyProjectIdentifier}`);
            vibeProjectIdCache.set(hulyProjectIdentifier, {
                value: null,
                expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
            });
            return null;
        }
        const vibeProjects = await getCachedVibeProjects();
        const normalizedName = hulyProject.name.toLowerCase().trim();
        const match = vibeProjects.find(p => p.name.toLowerCase().trim() === normalizedName);
        if (match) {
            console.log(`[Temporal:Orchestration] Found Vibe project: ${match.id} for ${hulyProjectIdentifier}`);
            vibeProjectIdCache.set(hulyProjectIdentifier, {
                value: match.id,
                expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
            });
            return match.id;
        }
        console.log(`[Temporal:Orchestration] No Vibe project found for: ${hulyProject.name}`);
        vibeProjectIdCache.set(hulyProjectIdentifier, {
            value: null,
            expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
        });
        return null;
    }
    catch (error) {
        console.warn(`[Temporal:Orchestration] Vibe project lookup failed: ${error}`);
        return null;
    }
}
async function resolveProjectIdentifier(projectIdOrFolder) {
    if (!projectIdOrFolder)
        return null;
    console.log(`[Temporal:Orchestration] Resolving project identifier: ${projectIdOrFolder}`);
    try {
        const projects = await getCachedHulyProjects();
        // Normalize input: lowercase, remove path separators
        const normalizedInput = projectIdOrFolder.toLowerCase().replace(/\\/g, '/').split('/').filter(Boolean).pop() ||
            projectIdOrFolder.toLowerCase();
        // First, try direct identifier match (case-insensitive)
        const directMatch = projects.find((p) => p.identifier.toLowerCase() === normalizedInput);
        if (directMatch) {
            console.log(`[Temporal:Orchestration] Direct match found: ${directMatch.identifier}`);
            return directMatch.identifier;
        }
        // Try matching by filesystem path in description
        for (const project of projects) {
            const description = project.description || '';
            // Parse "Filesystem: /opt/stacks/foldername" from description
            const fsMatch = description.match(/Filesystem:\s*([^\n]+)/i);
            if (fsMatch) {
                const fsPath = fsMatch[1].trim();
                const folderName = fsPath
                    .replace(/\\/g, '/')
                    .split('/')
                    .filter(Boolean)
                    .pop()
                    ?.toLowerCase();
                if (folderName === normalizedInput) {
                    console.log(`[Temporal:Orchestration] Resolved folder "${projectIdOrFolder}" → "${project.identifier}"`);
                    return project.identifier;
                }
            }
        }
        // Try matching by project name (case-insensitive, with common transformations)
        const nameMatch = projects.find((p) => {
            const normalizedName = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normalizedSearch = normalizedInput.replace(/[^a-z0-9]/g, '');
            return normalizedName === normalizedSearch;
        });
        if (nameMatch) {
            console.log(`[Temporal:Orchestration] Resolved by name "${projectIdOrFolder}" → "${nameMatch.identifier}"`);
            return nameMatch.identifier;
        }
        console.warn(`[Temporal:Orchestration] Could not resolve project identifier: ${projectIdOrFolder}`);
        return null;
    }
    catch (error) {
        throw (0, orchestration_letta_1.handleOrchestratorError)(error, 'resolveProjectIdentifier');
    }
}
function extractFilesystemPath(description) {
    if (!description)
        return null;
    const match = description.match(/(?:Path|Filesystem|Directory|Location):\s*([^\n\r]+)/i);
    if (match) {
        return match[1]
            .trim()
            .replace(/[,;.]$/, '')
            .trim();
    }
    return null;
}
function determineGitRepoPath(hulyProject) {
    const filesystemPath = extractFilesystemPath(hulyProject.description);
    if (filesystemPath) {
        return filesystemPath;
    }
    return `/opt/stacks/huly-sync-placeholders/${hulyProject.identifier}`;
}
function validateGitRepoPath(repoPath) {
    if (!repoPath || typeof repoPath !== 'string') {
        return { valid: false, reason: 'path is null or not a string' };
    }
    if (!path.isAbsolute(repoPath)) {
        return { valid: false, reason: `path is not absolute: ${repoPath}` };
    }
    if (!fs.existsSync(repoPath)) {
        return { valid: false, reason: `path does not exist on disk: ${repoPath}` };
    }
    try {
        const stat = fs.statSync(repoPath);
        if (!stat.isDirectory()) {
            return { valid: false, reason: `path is not a directory: ${repoPath}` };
        }
    }
    catch {
        return { valid: false, reason: `cannot stat path: ${repoPath}` };
    }
    const gitDir = path.join(repoPath, '.git');
    if (!fs.existsSync(gitDir)) {
        return { valid: false, reason: `not a git repository (no .git): ${repoPath}` };
    }
    return { valid: true };
}
async function ensureVibeProject(input) {
    const { hulyProject, existingVibeProjects } = input;
    console.log(`[Temporal:Orchestration] Ensuring Vibe project for ${hulyProject.identifier}`);
    try {
        const existing = existingVibeProjects.find(vp => vp.name.toLowerCase() === hulyProject.name.toLowerCase());
        if (existing) {
            console.log(`[Temporal:Orchestration] Found existing Vibe project: ${existing.id}`);
            return existing;
        }
        const gitRepoPath = determineGitRepoPath(hulyProject);
        const validation = validateGitRepoPath(gitRepoPath);
        if (!validation.valid) {
            console.warn(`[Temporal:Orchestration] ⚠ Skipping project ${hulyProject.identifier}: invalid repo path — ${validation.reason}`);
            throw activity_1.ApplicationFailure.nonRetryable(`Invalid repo path for ${hulyProject.identifier}: ${validation.reason}`, 'INVALID_REPO_PATH');
        }
        const displayName = gitRepoPath.split('/').pop() || hulyProject.name;
        console.log(`[Temporal:Orchestration] Creating Vibe project with repo: ${gitRepoPath}`);
        const vibeClient = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        const created = await vibeClient.createProject({
            name: hulyProject.name,
            repositories: [{ display_name: displayName, git_repo_path: gitRepoPath }],
        });
        console.log(`[Temporal:Orchestration] Created Vibe project: ${created.id}`);
        return created;
    }
    catch (error) {
        throw (0, orchestration_letta_1.handleOrchestratorError)(error, 'ensureVibeProject');
    }
}
/**
 * Fetch project data (issues and tasks) for sync
 */
async function fetchProjectData(input) {
    const { hulyProject, vibeProjectId } = input;
    console.log(`[Temporal:Orchestration] Fetching data for ${hulyProject.identifier}`);
    try {
        const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        const vibeClient = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        // Fetch in parallel
        const [hulyIssues, vibeTasks] = await Promise.all([
            hulyClient.listIssues(hulyProject.identifier),
            vibeClient.listTasks(vibeProjectId),
        ]);
        console.log(`[Temporal:Orchestration] Fetched ${hulyIssues.length} issues, ${vibeTasks.length} tasks`);
        return { hulyIssues, vibeTasks };
    }
    catch (error) {
        throw (0, orchestration_letta_1.handleOrchestratorError)(error, 'fetchProjectData');
    }
}
async function fetchAllVibeTasks(input) {
    const { vibeProjectId } = input;
    try {
        const vibeClient = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        return await vibeClient.listTasks(vibeProjectId);
    }
    catch (error) {
        throw (0, orchestration_letta_1.handleOrchestratorError)(error, 'fetchAllVibeTasks');
    }
}
/**
 * Fetch only Vibe tasks that map to specific Huly identifiers via sync DB mappings.
 * Used by webhook-triggered project syncs to avoid full-table task fetches.
 */
async function fetchVibeTasksForHulyIssues(input) {
    const { projectIdentifier, vibeProjectId, hulyIssueIdentifiers } = input;
    const uniqueHulyIds = Array.from(new Set(hulyIssueIdentifiers.filter(Boolean)));
    if (uniqueHulyIds.length === 0) {
        return [];
    }
    console.log(`[Temporal:Orchestration] Fetching mapped Vibe tasks for ${uniqueHulyIds.length} prefetched Huly issues in ${projectIdentifier}`);
    const vibeTaskIds = new Set();
    try {
        const { createSyncDatabase } = await Promise.resolve(`${appRootModule('lib/database.js')}`).then(s => __importStar(require(s)));
        const dbPath = process.env.DB_PATH || '/opt/stacks/huly-vibe-sync/logs/sync-state.db';
        const db = createSyncDatabase(dbPath);
        try {
            const dbAny = db;
            for (const hulyIdentifier of uniqueHulyIds) {
                const issue = dbAny.getIssue?.(hulyIdentifier);
                if (issue?.vibe_task_id) {
                    vibeTaskIds.add(String(issue.vibe_task_id));
                }
            }
        }
        finally {
            db.close();
        }
    }
    catch (error) {
        throw (0, orchestration_letta_1.handleOrchestratorError)(error, 'fetchVibeTasksForHulyIssues');
    }
    if (vibeTaskIds.size === 0) {
        console.log(`[Temporal:Orchestration] No mapped Vibe tasks found for prefetched issues in ${projectIdentifier}`);
        return [];
    }
    try {
        const vibeClient = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        const settled = await Promise.allSettled(Array.from(vibeTaskIds).map(taskId => vibeClient.getTask(taskId)));
        const vibeTasks = [];
        for (const item of settled) {
            if (item.status === 'fulfilled' && item.value) {
                vibeTasks.push(item.value);
            }
        }
        console.log(`[Temporal:Orchestration] Fetched ${vibeTasks.length}/${vibeTaskIds.size} mapped Vibe tasks for ${projectIdentifier}`);
        return vibeTasks;
    }
    catch (error) {
        throw (0, orchestration_letta_1.handleOrchestratorError)(error, 'fetchVibeTasksForHulyIssues');
    }
}
/**
 * Bulk fetch issues from multiple Huly projects in a single API call.
 */
async function fetchHulyIssuesBulk(input) {
    const { projectIdentifiers, modifiedSince, limit = 1000 } = input;
    console.log(`[Temporal:Orchestration] Bulk fetching issues from ${projectIdentifiers.length} projects`);
    try {
        const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        const result = await hulyClient.listIssuesBulk({
            projects: projectIdentifiers,
            modifiedSince,
            limit,
            includeDescriptions: false,
            fields: ['identifier', 'title', 'status', 'priority', 'modifiedOn', 'parentIssue'],
        });
        const issuesByProject = {};
        let totalIssues = 0;
        for (const [projectId, data] of Object.entries(result.projects)) {
            issuesByProject[projectId] = data.issues;
            totalIssues += data.issues.length;
        }
        console.log(`[Temporal:Orchestration] Bulk fetched ${totalIssues} issues from ${projectIdentifiers.length} projects`);
        return issuesByProject;
    }
    catch (error) {
        throw (0, orchestration_letta_1.handleOrchestratorError)(error, 'fetchHulyIssuesBulk');
    }
}
//# sourceMappingURL=orchestration-projects.js.map