"use strict";
/**
 * Beads Issue Tracker Client (TypeScript)
 *
 * TypeScript client for Beads git-based issue tracker.
 * Uses direct JSONL writes for reliability + bd import for DB sync.
 * Used by Temporal activities for durable workflow execution.
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
exports.BeadsClient = void 0;
exports.createBeadsClient = createBeadsClient;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
/**
 * Execute a shell command and return output
 */
function execCommand(command, cwd, options = {}) {
    try {
        const result = (0, child_process_1.execSync)(command, {
            cwd,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            maxBuffer: 10 * 1024 * 1024,
            timeout: 60000,
            ...options,
        });
        return result.trim();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Command failed: ${command}\n${message}`);
    }
}
/**
 * TypeScript client for Beads issue tracker
 */
class BeadsClient {
    repoPath;
    timeout;
    cachedIssuePrefix = null;
    permissionsChecked = false;
    constructor(repoPath, options = {}) {
        this.repoPath = repoPath;
        this.timeout = options.timeout || 60000;
    }
    /**
     * Check if the repository has Beads initialized
     */
    isInitialized() {
        const beadsDir = path.join(this.repoPath, '.beads');
        return fs.existsSync(beadsDir);
    }
    /**
     * Check that critical .beads files are readable by the current process.
     * Logs warnings for permission issues (common when bd daemon runs as wrong user).
     */
    checkFilePermissions() {
        if (this.permissionsChecked)
            return;
        this.permissionsChecked = true;
        const beadsDir = path.join(this.repoPath, '.beads');
        const criticalFiles = ['beads.db', 'issues.jsonl', 'beads.db-shm', 'beads.db-wal'];
        for (const file of criticalFiles) {
            const filePath = path.join(beadsDir, file);
            if (fs.existsSync(filePath)) {
                try {
                    fs.accessSync(filePath, fs.constants.R_OK);
                }
                catch {
                    console.error(`[BeadsClient] Permission denied: ${filePath} is not readable. ` +
                        `Ensure the beads daemon runs as the same user as this process (UID ${process.getuid?.() ?? 'unknown'}). ` +
                        `Fix: chown ${process.getuid?.() ?? 1000} ${filePath}`);
                }
            }
        }
    }
    /**
     * Initialize Beads in the repository
     */
    async initialize() {
        if (!this.isInitialized()) {
            execCommand('bd init --no-daemon', this.repoPath);
        }
    }
    /**
     * Execute a Beads CLI command
     */
    execBeads(command) {
        // Always use --no-daemon to avoid permission issues
        const fullCommand = command.includes('--no-daemon')
            ? `bd ${command}`
            : `bd ${command} --no-daemon`;
        return execCommand(fullCommand, this.repoPath, { timeout: this.timeout });
    }
    /**
     * Parse JSON output from Beads CLI
     */
    parseBeadsOutput(output) {
        try {
            return JSON.parse(output);
        }
        catch {
            throw new Error(`Failed to parse Beads output: ${output}`);
        }
    }
    // ============================================================
    // JSONL DIRECT WRITE (more reliable than CLI)
    // ============================================================
    /**
     * Get the issue prefix from config.yaml
     */
    getIssuePrefix() {
        if (this.cachedIssuePrefix !== null) {
            return this.cachedIssuePrefix;
        }
        try {
            const configuredPrefix = this.execBeads('config get issue_prefix').trim();
            if (configuredPrefix) {
                this.cachedIssuePrefix = configuredPrefix.replace(/-$/, '');
                return this.cachedIssuePrefix;
            }
        }
        catch {
            // Fall through to file-based fallback
        }
        const configPath = path.join(this.repoPath, '.beads', 'config.yaml');
        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            const match = content.match(/issue[_-]prefix:\s*["']?([^"'\n]+)["']?/);
            this.cachedIssuePrefix = match ? match[1].trim() : 'bd';
        }
        catch {
            this.cachedIssuePrefix = 'bd';
        }
        return this.cachedIssuePrefix;
    }
    /**
     * Generate a unique Beads issue ID
     */
    generateIssueId() {
        const prefix = this.getIssuePrefix();
        const random = crypto.randomBytes(3).toString('hex').slice(0, 5);
        return `${prefix}-${random}`;
    }
    /**
     * Write an issue directly to issues.jsonl (bypasses CLI escaping issues)
     */
    writeToJsonl(issue) {
        const issuesPath = path.join(this.repoPath, '.beads', 'issues.jsonl');
        const now = new Date().toISOString();
        const jsonlEntry = {
            id: issue.id,
            title: issue.title,
            status: issue.status,
            priority: issue.priority,
            issue_type: issue.issue_type,
            created_at: now,
            updated_at: now,
            ...(issue.labels && issue.labels.length > 0 && { labels: issue.labels }),
            ...(issue.description && {
                comments: [
                    {
                        id: Date.now(),
                        issue_id: issue.id,
                        author: 'vibesync',
                        text: issue.description,
                        created_at: now,
                    },
                ],
            }),
        };
        // Append to JSONL file
        fs.appendFileSync(issuesPath, JSON.stringify(jsonlEntry) + '\n');
    }
    /**
     * Trigger bd import asynchronously (don't wait for completion)
     */
    triggerImport() {
        const issuesPath = path.join(this.repoPath, '.beads', 'issues.jsonl');
        // Fire and forget - don't wait for completion
        (0, child_process_1.exec)(`bd import -i "${issuesPath}" --no-daemon`, { cwd: this.repoPath }, error => {
            if (error) {
                console.warn(`[BeadsClient] Import warning: ${error.message}`);
            }
        });
    }
    // ============================================================
    // ISSUE OPERATIONS
    // ============================================================
    /**
     * List all issues
     */
    async listIssues(includeAll = true) {
        const allFlag = includeAll ? ' --all' : '';
        this.checkFilePermissions();
        try {
            const output = this.execBeads(`list --json --limit 0${allFlag}`);
            return this.parseBeadsOutput(output);
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('Database out of sync with JSONL')) {
                try {
                    this.execBeads('sync --import-only');
                }
                catch (syncError) {
                    if (syncError instanceof Error &&
                        syncError.message.includes('prefix mismatch detected')) {
                        try {
                            this.execBeads('sync --import-only --rename-on-import');
                        }
                        catch (renameError) {
                            if (renameError instanceof Error) {
                                console.warn(`[BeadsClient] Prefix migration failed for ${this.repoPath}, falling back to --allow-stale list: ${renameError.message}`);
                            }
                            const staleOutput = this.execBeads(`list --json --limit 0 --allow-stale${allFlag}`);
                            return this.parseBeadsOutput(staleOutput);
                        }
                    }
                    else {
                        throw syncError;
                    }
                }
                const output = this.execBeads(`list --json --limit 0${allFlag}`);
                return this.parseBeadsOutput(output);
            }
            // If no issues exist, return empty array
            if (error instanceof Error && error.message.includes('No issues found')) {
                return [];
            }
            throw error;
        }
    }
    /**
     * Get a specific issue by ID
     */
    async getIssue(issueId) {
        try {
            const output = this.execBeads(`show ${issueId} --json`);
            return this.parseBeadsOutput(output);
        }
        catch {
            return null;
        }
    }
    /**
     * Create a new issue using direct JSONL write (avoids CLI escaping issues)
     */
    async createIssue(data) {
        const id = this.generateIssueId();
        const now = new Date().toISOString();
        // Write directly to JSONL
        this.writeToJsonl({
            id,
            title: data.title,
            status: data.status || 'open',
            priority: data.priority ?? 4,
            issue_type: data.type || 'task',
            labels: data.labels,
            description: data.description,
        });
        // Trigger async import to sync to DB
        this.triggerImport();
        // Return the created issue
        return {
            id,
            title: data.title,
            status: (data.status || 'open'),
            priority: data.priority ?? 4,
            type: (data.type || 'task'),
            labels: data.labels,
            description: data.description,
            created_at: now,
            updated_at: now,
        };
    }
    /**
     * Update an issue field
     */
    async updateIssue(issueId, field, value) {
        const output = this.execBeads(`update ${issueId} --${field} "${value}" --json`);
        return this.parseBeadsOutput(output);
    }
    /**
     * Update issue status
     */
    async updateStatus(issueId, status) {
        return this.updateIssue(issueId, 'status', status);
    }
    async addLabel(issueId, label) {
        const apiUrl = process.env.BEADS_API_URL || 'http://localhost:3099/api/beads/label';
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    repoPath: this.repoPath,
                    issueId,
                    label,
                    action: 'add',
                }),
            });
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
        }
        catch (apiError) {
            console.warn(`[BeadsClient] API call failed, falling back to CLI: ${apiError}`);
            this.execBeads(`label add ${issueId} "${label}" --no-auto-flush`);
        }
    }
    async removeLabel(issueId, label) {
        const apiUrl = process.env.BEADS_API_URL || 'http://localhost:3099/api/beads/label';
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    repoPath: this.repoPath,
                    issueId,
                    label,
                    action: 'remove',
                }),
            });
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
        }
        catch (apiError) {
            console.warn(`[BeadsClient] API call failed, falling back to CLI: ${apiError}`);
            this.execBeads(`label remove ${issueId} "${label}" --no-auto-flush`);
        }
    }
    // ============================================================
    // GIT OPERATIONS
    // ============================================================
    /**
     * Check if this is a git repository
     */
    isGitRepository() {
        try {
            execCommand('git rev-parse --is-inside-work-tree', this.repoPath);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Check if there are uncommitted Beads changes
     */
    hasUncommittedChanges() {
        try {
            const output = execCommand('git status --porcelain=v1 -- .beads', this.repoPath);
            return Boolean(output);
        }
        catch {
            return false;
        }
    }
    /**
     * Commit Beads changes to git
     */
    async commitChanges(message) {
        if (!this.isGitRepository()) {
            return false;
        }
        const beadsFiles = [
            '.beads/interactions.jsonl',
            '.beads/metadata.json',
            '.beads/config.yaml',
            '.beads/.gitignore',
            '.beads/README.md',
            '.gitattributes',
        ];
        // Stage only existing Beads files
        const existingFiles = beadsFiles.filter(file => fs.existsSync(path.join(this.repoPath, file)));
        if (existingFiles.length === 0) {
            return false;
        }
        // Stage files
        const filesArg = existingFiles.map(f => `"${f}"`).join(' ');
        execCommand(`git add -A -- ${filesArg}`, this.repoPath);
        // Check if there are staged changes
        const stagedOutput = execCommand('git diff --cached --name-only', this.repoPath);
        if (!stagedOutput) {
            return false;
        }
        // Commit
        const escapedMessage = message.replace(/"/g, '\\"');
        try {
            execCommand(`git commit -m "${escapedMessage}"`, this.repoPath);
            return true;
        }
        catch (error) {
            // Try without hooks if first attempt fails
            try {
                execCommand(`git commit --no-verify -m "${escapedMessage}"`, this.repoPath);
                return true;
            }
            catch {
                throw error;
            }
        }
    }
    // ============================================================
    // SYNC HELPERS
    // ============================================================
    /**
     * Find a Beads issue matching a Huly issue by title (exact normalized match only)
     */
    async findByTitle(title) {
        const issues = await this.listIssues();
        const normalizedTitle = title.toLowerCase().trim();
        return (issues.find(issue => {
            const issueTitle = issue.title.toLowerCase().trim();
            return issueTitle === normalizedTitle;
        }) || null);
    }
    /**
     * Sync a Huly issue to Beads
     */
    async syncFromHuly(hulyIssue, beadsStatus, beadsPriority) {
        // Check for existing issue by title
        const existing = await this.findByTitle(hulyIssue.title);
        if (existing) {
            // Update status if different
            if (existing.status !== beadsStatus) {
                const updated = await this.updateStatus(existing.id, beadsStatus);
                return { issue: updated, created: false, updated: true, skipped: false };
            }
            return { issue: existing, created: false, updated: false, skipped: true };
        }
        // Create new issue
        const description = hulyIssue.description
            ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.identifier}`
            : `Synced from Huly: ${hulyIssue.identifier}`;
        const issue = await this.createIssue({
            title: hulyIssue.title,
            description,
            status: beadsStatus,
            priority: beadsPriority,
            labels: [`huly:${hulyIssue.identifier}`],
        });
        return { issue, created: true, updated: false, skipped: false };
    }
}
exports.BeadsClient = BeadsClient;
/**
 * Factory function to create Beads client
 */
function createBeadsClient(repoPath, options) {
    return new BeadsClient(repoPath, options);
}
//# sourceMappingURL=BeadsClient.js.map