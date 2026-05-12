/**
 * Beads issue types. Source from BeadsAdapter JSON output,
 * LettaMemoryBuilders.d.ts NormalizedIssue, and API route payloads.
 */

export interface BeadsIssue {
  id: string;
  title: string;
  description: string;
  status: string;
  statusLabel: string;
  priority: string;
  issue_type: string;
  assignee: string | null;
  owner: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  labels: string[];
  dependencies: BeadsDependency[];
  dependency_count: number;
  dependent_count: number;
  comment_count: number;
  acceptance_criteria?: string;
  notes?: string;
}

export interface BeadsDependency {
  issue_id: string;
  depends_on_id: string;
  type: string;
  created_at: string;
  created_by: string;
  metadata: string;
}

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

/**
 * Canonical normalized Beads issue shape produced by BeadsAdapter._normalizeIssue.
 * Reused across BeadsAdapter, BeadsIssueService, and API routes (Phase 5).
 */
export interface NormalizedBeadsIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  issue_type: string;
  description: string;
  assignee: string | null;
  labels: string[];
  notes: string[];
  comments: string[];
  blockedBy: string[];
  blocked_by: string[];
  blocks: string[];
  parent_huly_id: string | null;
  parent_vibe_id: string | null;
  sub_issue_count: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | undefined;
  created_at: string;
  updated_at: string;
  closed_at: string | undefined;
  acceptance_criteria: string | undefined;
  dependency_count: number | undefined;
  dependent_count: number | undefined;
  comment_count: number | undefined;
}

export interface NormalizedWorkItems {
  items: NormalizedBeadsIssue[];
}

export interface BeadsProject {
  identifier: string;
  filesystem_path: string;
}

export interface BeadsIssueSummary {
  total_known: number;
  ready: number;
  in_progress: number;
  blocked: number;
  closed_recent: number;
}

export interface BeadsTrackerCapabilities {
  work_items: boolean;
  activity: boolean;
  agents: boolean;
  conversations: boolean;
  priority: boolean;
  status: boolean;
  parent_child: boolean;
  labels: boolean;
  dependencies: boolean;
}

export type BeadsIssueStatus = 'todo' | 'in_progress' | 'blocked' | 'deferred' | 'closed';
export type NormalizedStatus = 'open' | 'in_progress' | 'blocked' | 'deferred' | 'closed';
