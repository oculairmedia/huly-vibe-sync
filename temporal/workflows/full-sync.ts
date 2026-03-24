/**
 * Full Sync Workflows
 *
 * Legacy workflows kept for backward compatibility.
 * Main orchestration now uses ProjectSyncWorkflow with 4-phase pipeline.
 */

import { proxyActivities, log } from '@temporalio/workflow';
import type * as syncActivities from '../activities/sync-services';

const { commitBeadsToGit } = proxyActivities<typeof syncActivities>({
  startToCloseTimeout: '120 seconds',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 5,
  },
});

export interface SyncIssueInput {
  issue: {
    identifier: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    modifiedOn?: number;
  };
  context: {
    projectIdentifier: string;
    gitRepoPath?: string;
  };
  existingBeadsIssues?: Array<{ id: string; title: string; status: string }>;
  syncToBeads?: boolean;
}

export interface SyncIssueResult {
  success: boolean;
  beadsResult?: { success: boolean; id?: string; skipped?: boolean; error?: string };
  error?: string;
}

export async function SyncSingleIssueWorkflow(input: SyncIssueInput): Promise<SyncIssueResult> {
  const { issue, context } = input;

  log.info(`[SyncSingleIssue] Starting: ${issue.identifier}`, {
    project: context.projectIdentifier,
  });

  return { success: true };
}

export async function SyncProjectWorkflow(input: {
  issues: SyncIssueInput[];
  context: {
    projectIdentifier: string;
    gitRepoPath?: string;
  };
  batchSize?: number;
  commitAfterSync?: boolean;
}): Promise<{
  success: boolean;
  total: number;
  synced: number;
  failed: number;
  results: SyncIssueResult[];
}> {
  const { issues, context, commitAfterSync = true } = input;

  log.info(`[SyncProject] Starting: ${context.projectIdentifier}`, {
    issueCount: issues.length,
  });

  if (commitAfterSync && context.gitRepoPath) {
    await commitBeadsToGit({
      context,
      message: `Sync ${issues.length} issues from VibeSync`,
    });
  }

  log.info(`[SyncProject] Complete: ${context.projectIdentifier}`);

  return {
    success: true,
    total: issues.length,
    synced: issues.length,
    failed: 0,
    results: issues.map(() => ({ success: true })),
  };
}
