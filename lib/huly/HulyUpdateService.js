/**
 * Huly Update Service - Issue update operations with deduplicated boilerplate
 */

import { recordApiLatency } from '../HealthService.js';

/**
 * Generic update helper - eliminates duplication across status/description/priority/title updates
 */
async function updateHulyIssueField(hulyClient, issueIdentifier, field, value, config = {}) {
  const displayValue = field === 'description' ? '(content)' : value;

  if (config.sync?.dryRun) {
    console.log(`[Huly] [DRY RUN] Would update issue ${issueIdentifier} ${field} to: ${displayValue}`);
    return true;
  }

  const startTime = Date.now();
  try {
    if (typeof hulyClient.updateIssue === 'function') {
      await hulyClient.updateIssue(issueIdentifier, field, value);
    } else if (typeof hulyClient.callTool === 'function') {
      await hulyClient.callTool('huly_issue_ops', {
        operation: 'update',
        issue_identifier: issueIdentifier,
        update: { field, value },
      });
    } else {
      throw new Error('Unsupported client type');
    }

    recordApiLatency('huly', 'updateIssue', Date.now() - startTime);
    console.log(`[Huly] \u2713 Updated issue ${issueIdentifier} ${field}${field !== 'description' ? ` to: ${value}` : ''}`);
    return true;
  } catch (error) {
    recordApiLatency('huly', 'updateIssue', Date.now() - startTime);
    console.error(`[Huly] Error updating issue ${issueIdentifier} ${field}:`, error.message);
    return false;
  }
}

export async function updateHulyIssueStatus(hulyClient, issueIdentifier, status, config = {}) {
  return updateHulyIssueField(hulyClient, issueIdentifier, 'status', status, config);
}

export async function updateHulyIssueDescription(hulyClient, issueIdentifier, description, config = {}) {
  return updateHulyIssueField(hulyClient, issueIdentifier, 'description', description, config);
}

export async function updateHulyIssuePriority(hulyClient, issueIdentifier, priority, config = {}) {
  return updateHulyIssueField(hulyClient, issueIdentifier, 'priority', priority, config);
}

export async function updateHulyIssueTitle(hulyClient, issueIdentifier, title, config = {}) {
  return updateHulyIssueField(hulyClient, issueIdentifier, 'title', title, config);
}

export async function createHulyIssue(hulyClient, projectIdentifier, issueData, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Huly] [DRY RUN] Would create issue in ${projectIdentifier}: ${issueData.title}`);
    return { identifier: `${projectIdentifier}-DRY`, ...issueData };
  }

  const startTime = Date.now();
  try {
    let result;

    if (typeof hulyClient.createIssue === 'function') {
      result = await hulyClient.createIssue(projectIdentifier, issueData);
    } else if (typeof hulyClient.callTool === 'function') {
      result = await hulyClient.callTool('huly_issue_ops', {
        operation: 'create',
        project_identifier: projectIdentifier,
        issue_data: issueData,
      });
    } else {
      throw new Error('Unsupported client type');
    }

    recordApiLatency('huly', 'createIssue', Date.now() - startTime);
    console.log(`[Huly] \u2713 Created issue: ${result.identifier} - ${issueData.title}`);
    return result;
  } catch (error) {
    recordApiLatency('huly', 'createIssue', Date.now() - startTime);
    console.error(`[Huly] Error creating issue in ${projectIdentifier}:`, error.message);
    return null;
  }
}
