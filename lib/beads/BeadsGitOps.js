/**
 * Beads Git Operations - Shell commands, git operations, staging, and committing
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export async function execShellCommand(command, options = {}) {
  try {
    const { stdout } = await execAsync(command, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    });

    return typeof stdout === 'string' ? stdout.trim() : String(stdout ?? '').trim();
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout) : '';
    const stderr = error?.stderr ? String(error.stderr) : '';
    const message = error?.message || String(error);
    const details = [stderr, stdout].filter(Boolean).join('\n');
    throw new Error(details ? `${message}\n${details}` : message);
  }
}

export async function execGitCommand(command, workingDir, options = {}) {
  const fullCommand = `git ${command}`;

  try {
    return await execShellCommand(fullCommand, {
      cwd: workingDir,
      ...options,
    });
  } catch (error) {
    const message = error?.message || String(error);
    throw new Error(`Git command failed: ${fullCommand}\n${message}`);
  }
}

export async function isGitRepository(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') {
    return false;
  }

  if (!fs.existsSync(projectPath)) {
    return false;
  }

  try {
    await execGitCommand('rev-parse --is-inside-work-tree', projectPath);
    return true;
  } catch {
    return false;
  }
}

export async function hasStagedChanges(projectPath) {
  try {
    const output = await execGitCommand('diff --cached --name-only', projectPath);
    return Boolean(output);
  } catch {
    return false;
  }
}

export async function stageBeadsFiles(projectPath, files) {
  const existingFiles = files
    .map(file => file.trim())
    .filter(Boolean)
    .filter(file => fs.existsSync(path.join(projectPath, file)));

  if (existingFiles.length === 0) {
    return false;
  }

  const args = existingFiles.map(file => `"${file}"`).join(' ');
  await execGitCommand(`add -A -- ${args}`, projectPath);
  return true;
}

export async function commitStagedChanges(projectPath, commitMessage) {
  if (!(await hasStagedChanges(projectPath))) {
    return false;
  }

  const escapedMessage = commitMessage.replace(/"/g, '\\"');

  try {
    await execGitCommand(`commit -m "${escapedMessage}"`, projectPath);
    return true;
  } catch (error) {
    const errorMsg = error?.message || String(error);

    try {
      await execGitCommand(`commit --no-verify -m "${escapedMessage}"`, projectPath);
      return true;
    } catch {
      throw new Error(errorMsg);
    }
  }
}

export async function commitBeadsSyncFiles(projectPath, commitMessage) {
  if (!(await isGitRepository(projectPath))) {
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

  const didStage = await stageBeadsFiles(projectPath, beadsFiles);
  if (!didStage) {
    return false;
  }

  return await commitStagedChanges(projectPath, commitMessage);
}

export async function beadsWorkingTreeDirty(projectPath) {
  if (!(await isGitRepository(projectPath))) {
    return false;
  }

  try {
    const output = await execGitCommand('status --porcelain=v1 -- .beads', projectPath);
    return Boolean(output);
  } catch {
    return false;
  }
}
