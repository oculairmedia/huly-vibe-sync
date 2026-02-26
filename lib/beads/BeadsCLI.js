/**
 * Beads CLI - Beads command execution and issue CRUD operations
 */

import { execShellCommand } from './BeadsGitOps.js';
import { recordApiLatency } from '../HealthService.js';
import {
  readIssuesFromDB as readIssuesFromJSONL,
} from '../BeadsDBReader.js';

function shellQuote(value) {
  const stringValue = String(value ?? '');
  return `'${stringValue.replace(/'/g, `'\"'\"'`)}'`;
}

export function sanitizeIssueTitle(title) {
  return String(title ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function execBeadsCommand(command, workingDir) {
  const commandWithFlag = command.includes('--no-daemon') ? command : `${command} --no-daemon`;
  const fullCommand = `bd ${commandWithFlag}`;
  const startTime = Date.now();

  try {
    const output = await execShellCommand(fullCommand, {
      cwd: workingDir,
      maxBuffer: 10 * 1024 * 1024,
    });

    recordApiLatency('beads', command.split(' ')[0], Date.now() - startTime);
    return output;
  } catch (error) {
    recordApiLatency('beads', command.split(' ')[0], Date.now() - startTime);
    throw new Error(`Beads command failed: ${fullCommand}\n${error.message}`);
  }
}

export async function listBeadsIssues(projectPath, filters = {}) {
  console.log('[Beads] Fetching issues...');

  try {
    let issues = readIssuesFromJSONL(projectPath);

    if (issues.length === 0) {
      let command = 'list --json';
      if (filters.status === 'open') {
        command += ' --status=open';
      } else if (filters.status === 'closed') {
        command += ' --status=closed';
      }

      const output = await execBeadsCommand(command, projectPath);
      if (output) {
        issues = JSON.parse(output);
      }
    } else {
      if (filters.status === 'open') {
        issues = issues.filter(i => i.status === 'open' || i.status === 'in_progress');
      } else if (filters.status === 'closed') {
        issues = issues.filter(i => i.status === 'closed');
      }
    }

    console.log(`[Beads] Found ${issues.length} issues`);
    return issues;
  } catch (error) {
    console.error('[Beads] Error listing issues:', error.message);
    return [];
  }
}

export async function getBeadsIssue(projectPath, issueId) {
  try {
    const output = await execBeadsCommand(`show ${issueId} --json`, projectPath);

    if (!output) {
      return null;
    }

    const issues = JSON.parse(output);
    return issues[0] || null;
  } catch (error) {
    console.error(`[Beads] Error fetching issue ${issueId}:`, error.message);
    return null;
  }
}

export async function createBeadsIssue(projectPath, issueData, config = {}) {
  const title = sanitizeIssueTitle(issueData?.title);

  if (config.sync?.dryRun) {
    console.log(`[Beads] [DRY RUN] Would create issue: ${title}`);
    return null;
  }

  console.log(`[Beads] Creating issue: ${title}`);

  try {
    let command = `create ${shellQuote(title)} --json`;

    if (issueData.priority !== undefined && issueData.priority !== null) {
      command += ` --priority=${issueData.priority}`;
    }

    if (issueData.type) {
      command += ` --type=${issueData.type}`;
    }

    if (issueData.labels && issueData.labels.length > 0) {
      command += ` --labels=${shellQuote(issueData.labels.join(','))}`;
    }

    const output = await execBeadsCommand(command, projectPath);
    const createdIssue = JSON.parse(output);

    if (issueData.description) {
      try {
        await execBeadsCommand(
          `comment ${createdIssue.id} ${shellQuote(issueData.description)}`,
          projectPath
        );
      } catch (commentError) {
        console.warn(`[Beads] Failed to add description as comment: ${commentError.message}`);
      }
    }

    console.log(`[Beads] \u2713 Created issue: ${createdIssue.id}`);
    return createdIssue;
  } catch (error) {
    console.error(`[Beads] Error creating issue "${issueData.title}":`, error.message);
    return null;
  }
}

export async function updateBeadsIssue(projectPath, issueId, field, value, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Beads] [DRY RUN] Would update issue ${issueId} ${field} to: ${value}`);
    return true;
  }

  try {
    let command;

    switch (field) {
      case 'status':
        if (value === 'closed') {
          command = `close ${issueId}`;
        } else if (value === 'open') {
          command = `reopen ${issueId}`;
        } else if (['in_progress', 'blocked', 'deferred'].includes(value)) {
          command = `update ${issueId} --status=${value}`;
        } else {
          console.warn(`[Beads] Unknown status value: ${value}`);
          return false;
        }
        break;
      case 'priority':
        command = `update ${issueId} --priority=${value}`;
        break;
      case 'title':
        command = `update ${issueId} --title=${shellQuote(sanitizeIssueTitle(value))}`;
        break;
      case 'type':
        command = `update ${issueId} --type=${value}`;
        break;
      case 'add-label':
        command = `update ${issueId} --add-label=${shellQuote(value)}`;
        break;
      case 'remove-label':
        command = `update ${issueId} --remove-label=${shellQuote(value)}`;
        break;
      default:
        console.warn(`[Beads] Unsupported field: ${field}`);
        return false;
    }

    await execBeadsCommand(command, projectPath);
    console.log(`[Beads] \u2713 Updated issue ${issueId} ${field} to: ${value}`);
    return true;
  } catch (error) {
    console.error(`[Beads] Error updating issue ${issueId}:`, error.message);
    return false;
  }
}

export async function updateBeadsIssueStatusWithLabel(
  projectPath, issueId, beadsStatus, newLabel, currentLabels = [], config = {}
) {
  const { getHulyStatusLabels } = await import('../statusMapper.js');
  const hulyStatusLabels = getHulyStatusLabels();

  if (config.sync?.dryRun) {
    console.log(
      `[Beads] [DRY RUN] Would update issue ${issueId} status to: ${beadsStatus}, label: ${newLabel}`
    );
    return true;
  }

  try {
    const statusUpdated = await updateBeadsIssue(projectPath, issueId, 'status', beadsStatus, config);
    if (!statusUpdated) {
      return false;
    }

    const currentLabelsSet = new Set(currentLabels);
    for (const label of hulyStatusLabels) {
      if (currentLabelsSet.has(label) && label !== newLabel) {
        await updateBeadsIssue(projectPath, issueId, 'remove-label', label, config);
      }
    }

    if (newLabel && !currentLabelsSet.has(newLabel)) {
      await updateBeadsIssue(projectPath, issueId, 'add-label', newLabel, config);
    }

    return true;
  } catch (error) {
    console.error(`[Beads] Error updating issue ${issueId} status with label:`, error.message);
    return false;
  }
}

export async function closeBeadsIssue(projectPath, issueId, config = {}) {
  return updateBeadsIssue(projectPath, issueId, 'status', 'closed', config);
}

export async function reopenBeadsIssue(projectPath, issueId, config = {}) {
  return updateBeadsIssue(projectPath, issueId, 'status', 'open', config);
}
