/**
 * Text Parsing Utilities
 *
 * Parses structured text output from Huly MCP tools
 */

import fs from 'fs';
import path from 'path';

/**
 * Parse projects from structured text output
 *
 * Expected format:
 * 📁 Project Name (CODE)
 * Description: Project description
 * Issues: 10 open
 * Status: active
 *
 * @param {string} text - The text to parse
 * @returns {Array} Array of project objects
 */
export function parseProjectsFromText(text) {
  const projects = [];
  const lines = text.split('\n');

  let currentProject = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Project header: 📁 Project Name (CODE)
    if (trimmed.startsWith('📁 ') && trimmed.includes('(') && trimmed.endsWith(')')) {
      if (currentProject) {
        projects.push(currentProject);
      }

      // Extract name and identifier
      const content = trimmed.substring(2); // Remove "📁 "
      const lastParen = content.lastIndexOf('(');
      const name = content.substring(0, lastParen).trim();
      const identifier = content.substring(lastParen + 1, content.length - 1).trim();

      currentProject = {
        name,
        identifier,
        description: '',
        issues: 0,
        status: 'active',
      };
    }
    // Description line
    else if (trimmed.startsWith('Description: ') && currentProject) {
      currentProject.description = trimmed.substring(13).trim();
    }
    // Issues count
    else if (trimmed.startsWith('Issues: ') && currentProject) {
      const count = parseInt(trimmed.substring(8).split(' ')[0], 10);
      currentProject.issues = isNaN(count) ? 0 : count;
    }
    // Status
    else if (trimmed.startsWith('Status: ') && currentProject) {
      currentProject.status = trimmed.substring(8).trim().toLowerCase();
    }
    // Filesystem path (special handling for our synced projects)
    else if (trimmed.startsWith('Filesystem: ') && currentProject) {
      if (!currentProject.description.includes('Filesystem:')) {
        currentProject.description += `\n\n---\n${trimmed}`;
      }
    } else if (
      trimmed.includes('Filesystem:') &&
      !trimmed.startsWith('Description:') &&
      currentProject
    ) {
      // Sometimes filesystem path appears on its own line
      if (!currentProject.description.includes('Filesystem:')) {
        currentProject.description += `\n\n---\n${trimmed}`;
      }
    }
  }

  // Add the last project
  if (currentProject) {
    projects.push(currentProject);
  }

  return projects;
}

/**
 * Parse issues from structured text output
 *
 * Expected format:
 * 📋 **PROJ-123**: Issue Title
 * Status: in progress
 * Priority: high
 * Description: Issue description
 *
 * @param {string} text - The text to parse
 * @param {string} projectId - Optional project ID to associate with issues
 * @returns {Array} Array of issue objects
 */
export function parseIssuesFromText(text, projectId = null) {
  const issues = [];
  const lines = text.split('\n');

  let currentIssue = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Issue header: 📋 **PROJ-123**: Issue Title
    if (trimmed.startsWith('📋 **') && trimmed.includes('**:')) {
      if (currentIssue) {
        issues.push(currentIssue);
      }

      // Extract identifier and title
      const parts = trimmed.split('**:', 1);
      const identifier = parts[0].substring(5).trim(); // Remove "📋 **"
      const title = trimmed.substring(trimmed.indexOf('**:') + 3).trim();

      currentIssue = {
        identifier,
        title,
        description: '',
        status: 'unknown',
        priority: 'medium',
        component: null,
        milestone: null,
      };

      if (projectId) {
        currentIssue.project = projectId;
      }
    }
    // Status line
    else if (trimmed.startsWith('Status: ') && currentIssue) {
      currentIssue.status = trimmed.substring(8).trim().toLowerCase();
    }
    // Priority line
    else if (trimmed.startsWith('Priority: ') && currentIssue) {
      currentIssue.priority = trimmed.substring(10).trim().toLowerCase();
    }
    // Description line
    else if (trimmed.startsWith('Description: ') && currentIssue) {
      currentIssue.description = trimmed.substring(13).trim();
    }
    // Component line
    else if (trimmed.startsWith('Component: ') && currentIssue) {
      currentIssue.component = trimmed.substring(11).trim();
    }
    // Milestone line
    else if (trimmed.startsWith('Milestone: ') && currentIssue) {
      currentIssue.milestone = trimmed.substring(11).trim();
    }
  }

  // Add the last issue
  if (currentIssue) {
    issues.push(currentIssue);
  }

  return issues;
}

/**
 * Extract filesystem path from Huly project description
 *
 * @param {string} description - The project description
 * @returns {string|null} The extracted filesystem path or null
 */
export function extractFilesystemPath(description) {
  if (!description) {
    return null;
  }

  // Match patterns like: Path:, Filesystem:, Directory:, Location:
  const patterns = [/(?:Path|Filesystem|Directory|Location):\s*([^\n\r]+)/i];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const path = match[1].trim();
      // Clean up common suffixes
      return path.replace(/[,;.]$/, '').trim();
    }
  }

  return null;
}

/**
 * Extract Huly identifier from Vibe task description
 *
 * @param {string} description - The Vibe task description
 * @returns {string|null} The extracted Huly identifier or null
 */
export function extractHulyIdentifierFromDescription(description) {
  if (!description) {
    return null;
  }

  // Match pattern: "Huly Issue: PROJ-123"
  // Prefix is case-insensitive; project code must be uppercase.
  const patterns = [/Huly Issue:\s*([A-Z]+-\d+)/i, /Synced from Huly:\s*([A-Z]+-\d+)/i];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (!match) {
      continue;
    }

    const identifier = match[1].trim();
    if (/^[A-Z]+-\d+$/.test(identifier)) {
      return identifier;
    }
  }

  return null;
}

/**
 * Parse issue count from text (e.g., "10 open", "5 total")
 *
 * @param {string} text - The text containing issue count
 * @returns {number} The parsed count or 0
 */
export function parseIssueCount(text) {
  if (!text) {
    return 0;
  }

  // Extract first number from text
  const match = text.match(/\d+/);
  if (match) {
    return parseInt(match[0], 10);
  }

  return 0;
}

/**
 * Extract full description from Huly issue detail response
 * The detail response has a ## Description section with full multi-line content
 * The description ends at specific top-level sections like "Recent Comments"
 *
 * @param {string} detailText - The issue detail text to parse
 * @returns {string} The extracted description
 *
 * @example
 * const desc = extractFullDescription(issueDetailText);
 * // Returns the content between ## Description and ## Recent Comments
 */
export function extractFullDescription(detailText) {
  const lines = detailText.split('\n');
  let inDescription = false;
  const description = [];

  // Top-level sections that mark the end of description
  const endSections = ['## Recent Comments', '## Sub-issues', '## Attachments'];

  for (const line of lines) {
    // Start capturing after ## Description header
    if (line.trim() === '## Description') {
      inDescription = true;
      continue;
    }

    // Stop at known end sections (not subsections within description)
    if (inDescription) {
      const trimmedLine = line.trim();
      if (endSections.some(section => trimmedLine === section)) {
        break;
      }
    }

    // Capture all description lines (including subsections like ## Summary, etc.)
    if (inDescription) {
      description.push(line);
    }
  }

  // Join and trim the description
  return description.join('\n').trim();
}

/**
 * Extract Huly identifier from description text
 * Looks for patterns like "Huly Issue: PROJECT-123" or "Synced from Huly: PROJECT-123"
 *
 * @param {string} description - The description text to search
 * @returns {string|null} The Huly identifier (e.g., "PROJECT-123") or null
 *
 * @example
 * extractHulyIdentifier("Task from Huly Issue: PROJ-42")
 * // Returns: "PROJ-42"
 * extractHulyIdentifier("Synced from Huly: PROJ-42")
 * // Returns: "PROJ-42"
 */
export function extractHulyIdentifier(description) {
  if (!description) {
    return null;
  }

  // Prefix is case-insensitive; project code must be uppercase.
  const patterns = [/Huly Issue:\s*([A-Z]+-\d+)/i, /Synced from Huly:\s*([A-Z]+-\d+)/i];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (!match) {
      continue;
    }

    const identifier = match[1].trim();
    if (/^[A-Z]+-\d+$/.test(identifier)) {
      return identifier;
    }
  }

  return null;
}

/**
 * Get git URL from local repository
 * Executes 'git remote get-url origin' in the repository directory
 *
 * Note: This function requires fs, path, and execSync to be passed or imported at call site.
 * Currently kept here for organization but requires external dependencies.
 *
 * @param {string} repoPath - Path to the git repository
 * @returns {string|null} The git remote URL or null if not found
 *
 * @example
 * import fs from 'fs';
 * import path from 'path';
 * import { execSync } from 'child_process';
 * const url = getGitUrl('/path/to/repo');
 * // Returns: "https://github.com/user/repo.git" or null
 */
export function getGitUrl(repoPath) {
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');

  try {
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      return null;
    }

    const url = execSync('git remote get-url origin', {
      cwd: repoPath,
      encoding: 'utf8',
    }).trim();

    return url || null;
  } catch (error) {
    return null;
  }
}

/**
 * @param {string} repoPath
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateGitRepoPath(repoPath) {
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
  } catch {
    return { valid: false, reason: `cannot stat path: ${repoPath}` };
  }

  const gitDir = path.join(repoPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return { valid: false, reason: `not a git repository (no .git): ${repoPath}` };
  }

  return { valid: true };
}

/**
 * Determine git repository path for a Huly project
 * Priority 1: Extract filesystem path from Huly description
 * Priority 2: Use placeholder in /opt/stacks
 *
 * @param {Object} hulyProject - The Huly project object
 * @param {string} hulyProject.description - Project description
 * @param {string} hulyProject.identifier - Project identifier (e.g., "PROJ")
 * @returns {string} The determined git repository path
 *
 * @example
 * const path = determineGitRepoPath(hulyProject);
 * // Returns: "/opt/stacks/my-project" or "/opt/stacks/huly-sync-placeholders/PROJ"
 */
export function determineGitRepoPath(hulyProject) {
  // Priority 1: Extract filesystem path from Huly description
  const filesystemPath = extractFilesystemPath(hulyProject.description);
  if (filesystemPath && fs.existsSync(filesystemPath)) {
    console.log(`[Vibe] Using filesystem path from Huly: ${filesystemPath}`);
    return filesystemPath;
  }

  // Priority 2: Use placeholder in /opt/stacks (mounted in Docker)
  const placeholder = `/opt/stacks/huly-sync-placeholders/${hulyProject.identifier}`;
  console.log(`[Vibe] Using placeholder path: ${placeholder}`);
  return placeholder;
}

/**
 * Resolve the GitHub remote URL for a filesystem path.
 * Reads `git remote get-url origin`, strips embedded credentials,
 * normalizes SSH to HTTPS, and removes trailing `.git`.
 *
 * @param {string} filesystemPath - Absolute path to a potential git repo
 * @param {Object} [options] - Options
 * @param {number} [options.timeoutMs=3000] - Timeout in milliseconds
 * @returns {Promise<string|null>} Clean GitHub URL or null
 */
export async function resolveGitUrl(filesystemPath, { timeoutMs = 3000 } = {}) {
  if (!filesystemPath || !fs.existsSync(path.join(filesystemPath, '.git'))) {
    return null;
  }

  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: filesystemPath,
      timeout: timeoutMs,
    });

    return cleanGitUrl(stdout.trim());
  } catch {
    return null;
  }
}

/**
 * Strip credentials and normalize a git remote URL.
 * - Removes embedded PATs/tokens from HTTPS URLs
 * - Converts SSH (git@github.com:owner/repo) to HTTPS
 * - Strips trailing .git
 *
 * @param {string} rawUrl - Raw git remote URL
 * @returns {string|null} Clean URL or null if not a GitHub URL
 */
export function cleanGitUrl(rawUrl) {
  if (!rawUrl) return null;

  let url = rawUrl
    // Strip HTTPS credentials (PATs, tokens)
    .replace(/https?:\/\/[^@]+@github\.com\//, 'https://github.com/')
    // Convert SSH to HTTPS
    .replace(/^git@github\.com:/, 'https://github.com/')
    // Remove trailing .git
    .replace(/\.git$/, '');

  // Only return GitHub URLs
  if (!url.startsWith('https://github.com/')) return null;

  return url;
}
