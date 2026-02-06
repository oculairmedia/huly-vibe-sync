/**
 * Beads Parent-Child Operations - Core dependency CRUD operations
 */

import { execBeadsCommand } from './BeadsCLI.js';
import fs from 'fs';
import path from 'path';

function isValidProjectPath(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') {
    return false;
  }

  if (!path.isAbsolute(projectPath)) {
    return false;
  }

  return fs.existsSync(projectPath);
}

export async function addParentChildDependency(projectPath, childId, parentId, config = {}) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for dependency add: ${projectPath}`);
    return false;
  }

  if (config.sync?.dryRun) {
    console.log(`[Beads] [DRY RUN] Would add parent-child: ${childId} -> ${parentId}`);
    return true;
  }

  try {
    const command = `dep add ${childId} ${parentId} --type=parent-child`;
    await execBeadsCommand(command, projectPath);
    console.log(`[Beads] \u2713 Added parent-child dependency: ${childId} -> ${parentId}`);
    return true;
  } catch (error) {
    if (
      error.message?.includes('already exists') ||
      error.message?.includes('duplicate') ||
      error.message?.includes('UNIQUE constraint')
    ) {
      console.log(`[Beads] Parent-child dependency already exists: ${childId} -> ${parentId}`);
      return true;
    }
    console.error(`[Beads] Error adding parent-child dependency:`, error.message);
    return false;
  }
}

export async function removeParentChildDependency(projectPath, childId, parentId, config = {}) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for dependency remove: ${projectPath}`);
    return false;
  }

  if (config.sync?.dryRun) {
    console.log(`[Beads] [DRY RUN] Would remove parent-child: ${childId} -> ${parentId}`);
    return true;
  }

  try {
    const command = `dep remove ${childId} ${parentId}`;
    await execBeadsCommand(command, projectPath);
    console.log(`[Beads] \u2713 Removed parent-child dependency: ${childId} -> ${parentId}`);
    return true;
  } catch (error) {
    console.error(`[Beads] Error removing parent-child dependency:`, error.message);
    return false;
  }
}

export async function getDependencyTree(projectPath, issueId) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for dependency tree: ${projectPath}`);
    return null;
  }

  try {
    const command = `dep tree ${issueId} --json`;
    const output = await execBeadsCommand(command, projectPath);
    return JSON.parse(output);
  } catch (error) {
    console.error(`[Beads] Error getting dependency tree for ${issueId}:`, error.message);
    return null;
  }
}

export async function getDependencyTreeSafe(projectPath, issueId) {
  if (!isValidProjectPath(projectPath)) {
    return null;
  }

  try {
    const command = `dep tree ${issueId} --json`;
    const output = await execBeadsCommand(command, projectPath);
    return JSON.parse(output);
  } catch {
    return null;
  }
}

export async function getIssueWithDependencies(projectPath, issueId) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for issue dependencies: ${projectPath}`);
    return null;
  }

  try {
    const command = `show ${issueId} --json`;
    const output = await execBeadsCommand(command, projectPath);
    const issues = JSON.parse(output);
    return issues[0] || null;
  } catch (error) {
    console.error(`[Beads] Error getting issue ${issueId}:`, error.message);
    return null;
  }
}

export async function getBeadsParentId(projectPath, issueId) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for parent lookup: ${projectPath}`);
    return null;
  }

  try {
    const command = `dep tree ${issueId} --json`;
    const output = await execBeadsCommand(command, projectPath);
    const tree = JSON.parse(output);

    for (const node of tree) {
      if (node.depth === 1 && node.id !== issueId) {
        return node.id;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

export async function getBeadsIssuesWithDependencies(projectPath) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for dependency list: ${projectPath}`);
    return [];
  }

  try {
    const command = `list --json`;
    const output = await execBeadsCommand(command, projectPath);
    const issues = JSON.parse(output);
    return issues;
  } catch (error) {
    console.error(`[Beads] Error getting issues with dependencies:`, error.message);
    return [];
  }
}

export async function getParentChildRelationships(projectPath, issueId) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for relationships: ${projectPath}`);
    return [];
  }

  try {
    const command = `dep tree ${issueId} --json`;
    const output = await execBeadsCommand(command, projectPath);
    const tree = JSON.parse(output);

    const relationships = [];

    for (const node of tree) {
      if (node.depth > 0 && node.parent_id && node.parent_id !== node.id) {
        relationships.push({
          childId: node.parent_id,
          parentId: node.id,
          type: 'parent-child',
        });
      }
    }

    return relationships;
  } catch (error) {
    console.error(
      `[Beads] Error getting parent-child relationships for ${issueId}:`,
      error.message
    );
    return [];
  }
}

export { isValidProjectPath };
