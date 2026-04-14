/**
 * Type declarations for LettaMemoryBuilders.js
 */

export interface NormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  createdOn: number;
  modifiedOn: number;
  component: string | null;
  assignee: string | null;
}

export interface Project {
  name: string;
  identifier: string;
  description?: string;
  status?: string;
}

export function buildProjectMeta(
  project: Project,
  repoPath: string | null,
  gitUrl: string | null
): any;

export function buildBoardConfig(): any;

export function buildBoardMetrics(issues: NormalizedIssue[]): any;

export function buildHotspots(issues: NormalizedIssue[]): any;

export function buildBacklogSummary(issues: NormalizedIssue[]): any;

export function buildRecentActivity(activityData: any): any;

export function buildComponentsSummary(issues: NormalizedIssue[]): any;

export function buildChangeLog(
  currentIssues: NormalizedIssue[],
  lastSyncTimestamp: number | null,
  db: any,
  projectIdentifier: string
): any;

export function buildExpression(role?: string): string;

export function buildScratchpad(): any;
