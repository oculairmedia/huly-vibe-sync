/**
 * Type declarations for LettaMemoryBuilders.js
 */

export interface BeadsIssue {
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
  _beads: {
    raw_status: string;
    raw_priority: number;
    closed_at: string | null;
    close_reason: string | null;
  };
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

export function buildBoardMetrics(issues: BeadsIssue[]): any;

export function buildHotspots(issues: BeadsIssue[]): any;

export function buildBacklogSummary(issues: BeadsIssue[]): any;

export function buildRecentActivity(activityData: any): any;

export function buildComponentsSummary(issues: BeadsIssue[]): any;

export function buildChangeLog(
  currentIssues: BeadsIssue[],
  lastSyncTimestamp: number | null,
  db: any,
  projectIdentifier: string
): any;

export function buildExpression(role?: string): string;

export function buildScratchpad(): any;
