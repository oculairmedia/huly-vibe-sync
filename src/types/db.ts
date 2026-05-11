/** Row types sourced from the SQLite schema in lib/database.js CREATE TABLE statements. */

export interface ProjectRow {
  identifier: string;
  name: string;
  huly_id: string | null;
  vibe_id: number | null;
  last_sync_at: number | null;
  issue_count: number;
  last_checked_at: number | null;
  filesystem_path: string | null;
  git_url: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  letta_agent_id: string | null;
  letta_folder_id: string | null;
  letta_source_id: string | null;
  letta_last_sync_at: number | null;
  description_hash: string | null;
  beads_remote_owner: string | null;
  beads_remote_repo: string | null;
  beads_remote_url: string | null;
  beads_remote_name: string | null;
  beads_remote_status: string | null;
  beads_remote_visibility: string | null;
  beads_remote_provisioned_at: number | null;
  beads_remote_last_push_at: number | null;
  beads_remote_last_error: string | null;
}

export interface IssueRow {
  identifier: string;
  project_identifier: string;
  huly_id: string | null;
  vibe_task_id: number | null;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  last_sync_at: number | null;
  created_at: number | null;
  updated_at: number | null;
  vibe_status: string | null;
  huly_modified_at: number | null;
  vibe_modified_at: number | null;
  deleted_from_huly: number;
  deleted_from_vibe: number;
}

export interface SyncStateRow {
  key: string;
  value: string | null;
  updated_at: number | null;
}

export interface SyncHistoryRow {
  id: number;
  started_at: number | null;
  completed_at: number | null;
  projects_processed: number | null;
  projects_failed: number | null;
  issues_synced: number | null;
  errors: string | null;
  duration_ms: number | null;
}

export interface ProjectFileRow {
  id: number;
  project_identifier: string;
  relative_path: string;
  content_hash: string;
  letta_file_id: string | null;
  file_size: number | null;
  uploaded_at: number | null;
  updated_at: number | null;
}

export interface BookStackPageRow {
  id: number;
  project_identifier: string | null;
  local_path: string;
  book_stack_id: number | null;
  book_stack_slug: string | null;
  title: string | null;
  content_hash: string | null;
  last_export_at: number | null;
  last_import_at: number | null;
  created_at: number | null;
  updated_at: number | null;
}
