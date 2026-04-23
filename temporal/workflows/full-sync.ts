/**
 * Full Sync Workflows
 *
 * Legacy workflows kept for backward compatibility.
 * Main orchestration now uses ProjectSyncWorkflow with a simplified pipeline.
 */

import { log } from '@temporalio/workflow';

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
}

export interface SyncIssueResult {
  success: boolean;
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
}): Promise<{
  success: boolean;
  total: number;
  synced: number;
  failed: number;
  results: SyncIssueResult[];
}> {
  const { issues, context } = input;

  log.info(`[SyncProject] Starting: ${context.projectIdentifier}`, {
    issueCount: issues.length,
  });

  log.info(`[SyncProject] Complete: ${context.projectIdentifier}`);

  return {
    success: true,
    total: issues.length,
    synced: issues.length,
    failed: 0,
    results: issues.map(() => ({ success: true })),
  };
}
