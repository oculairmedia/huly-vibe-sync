"use strict";
/**
 * Orchestration Activities for Temporal
 *
 * Activities for the FullOrchestrationWorkflow that fetches projects,
 * coordinates sync phases, and updates Letta memory.
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
exports.fetchHulyProjects = fetchHulyProjects;
exports.fetchVibeProjects = fetchVibeProjects;
exports.getVibeProjectId = getVibeProjectId;
exports.resolveProjectIdentifier = resolveProjectIdentifier;
exports.ensureVibeProject = ensureVibeProject;
exports.fetchProjectData = fetchProjectData;
exports.fetchHulyIssuesBulk = fetchHulyIssuesBulk;
exports.resolveGitRepoPath = resolveGitRepoPath;
exports.extractGitRepoPath = extractGitRepoPath;
exports.initializeBeads = initializeBeads;
exports.fetchBeadsIssues = fetchBeadsIssues;
exports.updateLettaMemory = updateLettaMemory;
exports.recordSyncMetrics = recordSyncMetrics;
const activity_1 = require("@temporalio/activity");
const lib_1 = require("../lib");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ============================================================
// PROJECT FETCHING ACTIVITIES
// ============================================================
/**
 * Fetch all Huly projects
 */
async function fetchHulyProjects() {
    console.log('[Temporal:Orchestration] Fetching Huly projects');
    try {
        const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        const projects = await hulyClient.listProjects();
        console.log(`[Temporal:Orchestration] Found ${projects.length} Huly projects`);
        return projects;
    }
    catch (error) {
        throw handleOrchestratorError(error, 'fetchHulyProjects');
    }
}
/**
 * Fetch all Vibe projects
 */
async function fetchVibeProjects() {
    console.log('[Temporal:Orchestration] Fetching Vibe projects');
    try {
        const vibeClient = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        const projects = await vibeClient.listProjects();
        console.log(`[Temporal:Orchestration] Found ${projects.length} Vibe projects`);
        return projects;
    }
    catch (error) {
        throw handleOrchestratorError(error, 'fetchVibeProjects');
    }
}
async function getVibeProjectId(hulyProjectIdentifier) {
    console.log(`[Temporal:Orchestration] Looking up Vibe project for: ${hulyProjectIdentifier}`);
    try {
        const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        const hulyProjects = await hulyClient.listProjects();
        const hulyProject = hulyProjects.find(p => p.identifier === hulyProjectIdentifier);
        if (!hulyProject) {
            console.log(`[Temporal:Orchestration] Huly project not found: ${hulyProjectIdentifier}`);
            return null;
        }
        const vibeClient = (0, lib_1.createVibeClient)(process.env.VIBE_API_URL);
        const vibeProjects = await vibeClient.listProjects();
        const normalizedName = hulyProject.name.toLowerCase().trim();
        const match = vibeProjects.find(p => p.name.toLowerCase().trim() === normalizedName);
        if (match) {
            console.log(`[Temporal:Orchestration] Found Vibe project: ${match.id} for ${hulyProjectIdentifier}`);
            return match.id;
        }
        console.log(`[Temporal:Orchestration] No Vibe project found for: ${hulyProject.name}`);
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
        const hulyClient = (0, lib_1.createHulyClient)(process.env.HULY_API_URL);
        const projects = await hulyClient.listProjects();
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
            const normalizedName = p.name.toLowerCase().replace(/[^a-z0-9]/g, ''); // Remove non-alphanumeric
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
        throw handleOrchestratorError(error, 'resolveProjectIdentifier');
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
        throw handleOrchestratorError(error, 'ensureVibeProject');
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
        throw handleOrchestratorError(error, 'fetchProjectData');
    }
}
/**
 * Bulk fetch issues from multiple Huly projects in a single API call.
 * Uses POST /api/issues/bulk-by-projects for ~12s savings per sync cycle.
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
            includeDescriptions: false, // 5x faster, descriptions fetched individually when needed
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
        throw handleOrchestratorError(error, 'fetchHulyIssuesBulk');
    }
}
/**
 * Resolve git repo path for a Huly project by identifier.
 * Fetches the project from Huly API and extracts the filesystem path from its description.
 * Returns null (not throws) if project not found or no path configured — caller decides severity.
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
// ============================================================
// LETTA MEMORY ACTIVITIES
// ============================================================
/**
 * Update Letta agent memory with project state
 */
async function updateLettaMemory(input) {
    const { agentId, hulyProject, hulyIssues, vibeTasks } = input;
    console.log(`[Temporal:Orchestration] Updating Letta memory for agent ${agentId}`);
    try {
        const lettaUrl = process.env.LETTA_BASE_URL || process.env.LETTA_API_URL;
        const lettaPassword = process.env.LETTA_PASSWORD;
        if (!lettaUrl || !lettaPassword) {
            console.log('[Temporal:Orchestration] Letta not configured, skipping memory update');
            return { success: true };
        }
        // Build memory blocks
        const boardMetrics = buildBoardMetrics(hulyIssues, vibeTasks);
        const projectMeta = buildProjectMeta(hulyProject, hulyIssues);
        // Update memory blocks via Letta API
        const response = await fetch(`${lettaUrl}/v1/agents/${agentId}/memory`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${lettaPassword}`,
            },
            body: JSON.stringify({
                blocks: [
                    { label: 'board_metrics', value: boardMetrics },
                    { label: 'project', value: projectMeta },
                ],
            }),
        });
        if (!response.ok) {
            throw new Error(`Letta API error: ${response.status} ${response.statusText}`);
        }
        console.log(`[Temporal:Orchestration] Updated Letta memory for ${agentId}`);
        return { success: true };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Temporal:Orchestration] Letta memory update failed: ${errorMsg}`);
        // Non-fatal
        return { success: false, error: errorMsg };
    }
}
// ============================================================
// METRICS & RECORDING
// ============================================================
/**
 * Record sync completion metrics
 */
async function recordSyncMetrics(input) {
    const { projectsProcessed, issuesSynced, durationMs, errors } = input;
    console.log(`[Temporal:Orchestration] Sync complete`, {
        projects: projectsProcessed,
        issues: issuesSynced,
        duration: `${(durationMs / 1000).toFixed(2)}s`,
        errors,
    });
    // Could emit to metrics system here (Prometheus, etc.)
}
// ============================================================
// HELPER FUNCTIONS
// ============================================================
function buildBoardMetrics(hulyIssues, vibeTasks) {
    const statusCounts = {};
    for (const issue of hulyIssues) {
        const status = issue.status || 'Unknown';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
    return JSON.stringify({
        totalIssues: hulyIssues.length,
        totalTasks: vibeTasks.length,
        byStatus: statusCounts,
        lastUpdated: new Date().toISOString(),
    });
}
function buildProjectMeta(hulyProject, hulyIssues) {
    return JSON.stringify({
        identifier: hulyProject.identifier,
        name: hulyProject.name,
        issueCount: hulyIssues.length,
        lastSynced: new Date().toISOString(),
    });
}
function handleOrchestratorError(error, operation) {
    if (error instanceof activity_1.ApplicationFailure) {
        throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();
    // Non-retryable errors
    if (lowerMessage.includes('404') ||
        lowerMessage.includes('not found') ||
        lowerMessage.includes('401') ||
        lowerMessage.includes('403') ||
        lowerMessage.includes('validation')) {
        throw activity_1.ApplicationFailure.nonRetryable(`${operation} failed: ${message}`, 'OrchestratorValidationError');
    }
    // Retryable errors
    throw activity_1.ApplicationFailure.retryable(`${operation} failed: ${message}`, 'OrchestratorError');
}
//# sourceMappingURL=orchestration.js.map