/**
 * Git Path Resolvers - Filesystem path extraction and git URL handling
 */

import fs from 'fs';
import path from 'path';

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

  const patterns = [/(?:Path|Filesystem|Directory|Location):\s*([^\n\r]+)/i];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const p = match[1].trim();
      return p.replace(/[,;.]$/, '').trim();
    }
  }

  return null;
}

/**
 * Get git URL from local repository
 *
 * @param {string} repoPath - Path to the git repository
 * @returns {string|null} The git remote URL or null if not found
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
 * Validate a git repository path
 *
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
 *
 * @param {Object} hulyProject - The Huly project object
 * @returns {string} The determined git repository path
 */
export function determineGitRepoPath(hulyProject) {
  const filesystemPath = extractFilesystemPath(hulyProject.description);
  if (filesystemPath && fs.existsSync(filesystemPath)) {
    console.log(`[Vibe] Using filesystem path from Huly: ${filesystemPath}`);
    return filesystemPath;
  }

  const placeholder = `/opt/stacks/huly-sync-placeholders/${hulyProject.identifier}`;
  console.log(`[Vibe] Using placeholder path: ${placeholder}`);
  return placeholder;
}

/**
 * Resolve the GitHub remote URL for a filesystem path.
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
 *
 * @param {string} rawUrl - Raw git remote URL
 * @returns {string|null} Clean URL or null if not a GitHub URL
 */
export function cleanGitUrl(rawUrl) {
  if (!rawUrl) return null;

  let url = rawUrl
    .replace(/https?:\/\/[^@]+@github\.com\//, 'https://github.com/')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '');

  if (!url.startsWith('https://github.com/')) return null;

  return url;
}
