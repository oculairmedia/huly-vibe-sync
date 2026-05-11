/**
 * Beads issue types. Source from BeadsAdapter.js JSON output,
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
