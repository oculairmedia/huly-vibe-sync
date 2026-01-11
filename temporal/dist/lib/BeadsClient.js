"use strict";
/**
 * Beads Issue Tracker Client (TypeScript)
 *
 * TypeScript client for Beads git-based issue tracker.
 * Uses the `bd` CLI command for issue operations.
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
    // ISSUE OPERATIONS
    // ============================================================
    /**
     * List all issues
     */
    async listIssues() {
        try {
            const output = this.execBeads('issue list --format json');
            return this.parseBeadsOutput(output);
        }
        catch (error) {
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
            const output = this.execBeads(`issue show ${issueId} --format json`);
            return this.parseBeadsOutput(output);
        }
        catch {
            return null;
        }
    }
    /**
     * Create a new issue
     */
    async createIssue(data) {
        const args = ['issue', 'create'];
        // Title is required
        args.push(`--title "${data.title.replace(/"/g, '\\"')}"`);
        if (data.status) {
            args.push(`--status ${data.status}`);
        }
        if (data.priority !== undefined) {
            args.push(`--priority ${data.priority}`);
        }
        if (data.type) {
            args.push(`--type ${data.type}`);
        }
        if (data.labels && data.labels.length > 0) {
            args.push(`--labels ${data.labels.join(',')}`);
        }
        if (data.description) {
            args.push(`--description "${data.description.replace(/"/g, '\\"')}"`);
        }
        args.push('--format json');
        const output = this.execBeads(args.join(' '));
        return this.parseBeadsOutput(output);
    }
    /**
     * Update an issue field
     */
    async updateIssue(issueId, field, value) {
        const output = this.execBeads(`issue update ${issueId} --${field} "${value}" --format json`);
        return this.parseBeadsOutput(output);
    }
    /**
     * Update issue status
     */
    async updateStatus(issueId, status) {
        return this.updateIssue(issueId, 'status', status);
    }
    /**
     * Add a label to an issue
     */
    async addLabel(issueId, label) {
        this.execBeads(`issue label ${issueId} --add ${label}`);
    }
    /**
     * Remove a label from an issue
     */
    async removeLabel(issueId, label) {
        this.execBeads(`issue label ${issueId} --remove ${label}`);
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
     * Find a Beads issue matching a Huly issue by title
     */
    async findByTitle(title) {
        const issues = await this.listIssues();
        const normalizedTitle = title.toLowerCase().trim();
        return issues.find(issue => {
            const issueTitle = issue.title.toLowerCase().trim();
            return issueTitle === normalizedTitle ||
                issueTitle.includes(normalizedTitle) ||
                normalizedTitle.includes(issueTitle);
        }) || null;
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