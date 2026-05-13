import type Database from 'better-sqlite3';
import { ProjectLettaRepository } from './ProjectLettaRepository';
import type { ProjectRow } from '../../types/db.js';

export interface ProjectUpsert {
  identifier: string;
  name: string;
  huly_id?: string | null;
  vibe_id?: number | null;
  filesystem_path?: string | null;
  git_url?: string | null;
  issue_count?: number | null;
  last_checked_at?: number | null;
  last_sync_at?: number | null;
  status?: string | null;
  created_at?: number | null;
  description_hash?: string | null;
}

export interface ProjectUpdate {
  name?: string | null;
  filesystem_path?: string | null;
  git_url?: string | null;
  status?: string | null;
  last_checked_at?: number | null;
}

export interface BeadsRemoteSnapshot {
  owner?: string | null;
  repo?: string | null;
  url?: string | null;
  name?: string | null;
  status?: string | null;
  visibility?: string | null;
  provisioned_at?: number | null;
  last_push_at?: number | null;
  last_error?: string | null;
}

export class ProjectRepository {
  public letta: ProjectLettaRepository;

  constructor(private db: Database.Database) {
    this.letta = new ProjectLettaRepository(db);
  }

  upsertProject(project: ProjectUpsert): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO projects (identifier, name, huly_id, vibe_id, filesystem_path, git_url,
         issue_count, last_checked_at, last_sync_at, status, created_at, updated_at, description_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(identifier) DO UPDATE SET
           name = excluded.name, huly_id = COALESCE(excluded.huly_id, huly_id),
           vibe_id = COALESCE(excluded.vibe_id, vibe_id),
           filesystem_path = CASE WHEN excluded.filesystem_path IS NOT NULL THEN excluded.filesystem_path ELSE filesystem_path END,
           git_url = COALESCE(excluded.git_url, git_url), issue_count = excluded.issue_count,
           last_checked_at = excluded.last_checked_at, last_sync_at = excluded.last_sync_at,
           status = excluded.status, updated_at = excluded.updated_at,
           description_hash = COALESCE(excluded.description_hash, description_hash)`,
      )
      .run(
        project.identifier, project.name, project.huly_id || null, project.vibe_id || null,
        project.filesystem_path || null, project.git_url || null, project.issue_count || 0,
        project.last_checked_at || now, project.last_sync_at || now,
        project.status || 'active', project.created_at || now, now,
        project.description_hash || null,
      );
  }

  getProject(identifier: string): ProjectRow | null {
    const row = this.db
      .prepare(
        `SELECT p.*, COALESCE(issue_counts.actual_issue_count, 0) AS actual_issue_count,
         CASE WHEN COALESCE(issue_counts.actual_issue_count, 0) > p.issue_count
              THEN issue_counts.actual_issue_count ELSE p.issue_count END AS issue_count
         FROM projects p LEFT JOIN (
           SELECT project_identifier, COUNT(*) AS actual_issue_count FROM issues GROUP BY project_identifier
         ) issue_counts ON issue_counts.project_identifier = p.identifier
         WHERE p.identifier = ?`,
      )
      .get(identifier) as ProjectRow | undefined;
    return row ?? null;
  }

  getProjectByVibeId(vibeId: number): ProjectRow | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE vibe_id = ?').get(vibeId) as ProjectRow | undefined;
    return row ?? null;
  }

  updateProject(identifier: string, updates: ProjectUpdate): ProjectRow | null {
    const existing = this.getProject(identifier);
    if (!existing) return null;

    const nextName = updates.name ?? existing.name;
    const nextFilesystemPath = updates.filesystem_path ?? existing.filesystem_path;
    const nextGitUrl = updates.git_url ?? existing.git_url;
    const nextStatus = updates.status ?? existing.status;
    const now = Date.now();

    this.db
      .prepare('UPDATE projects SET name = ?, filesystem_path = ?, git_url = ?, status = ?, updated_at = ? WHERE identifier = ?')
      .run(nextName, nextFilesystemPath, nextGitUrl, nextStatus, now, identifier);

    return this.getProject(identifier);
  }

  archiveProject(identifier: string): ProjectRow | null {
    return this.updateProject(identifier, { status: 'archived' });
  }

  unarchiveProject(identifier: string): ProjectRow | null {
    return this.updateProject(identifier, { status: 'active' });
  }

  deleteProject(identifier: string): boolean {
    const existing = this.getProject(identifier);
    if (!existing) return false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteProject = this.db.transaction((projectIdentifier: string) => {
      this.db.prepare('DELETE FROM issues WHERE project_identifier = ?').run(projectIdentifier);
      this.db.prepare('DELETE FROM project_files WHERE project_identifier = ?').run(projectIdentifier);
      this.db.prepare('DELETE FROM projects WHERE identifier = ?').run(projectIdentifier);
    }) as (...args: unknown[]) => void;

    deleteProject(identifier);
    return true;
  }

  getAllProjects(): ProjectRow[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY name').all() as ProjectRow[];
  }

  getProjectsToSync(now = Date.now(), staleThreshold = 3600000): ProjectRow[] {
    return this.db.prepare(
      `SELECT * FROM projects WHERE status = 'active'
       AND (last_checked_at IS NULL OR ? - last_checked_at > ?)
       ORDER BY name`,
    ).all(now, staleThreshold) as ProjectRow[];
  }

  getActiveProjects(): ProjectRow[] {
    return this.db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY name').all('active') as ProjectRow[];
  }

  updateProjectActivity(identifier: string, issueCount: number, checkedAt: number = Date.now()): void {
    this.db.prepare(
      'UPDATE projects SET issue_count = ?, last_checked_at = ?, updated_at = ? WHERE identifier = ?',
    ).run(issueCount, checkedAt, checkedAt, identifier);
  }

  getProjectsWithFilesystemPath(): ProjectRow[] {
    return this.db
      .prepare('SELECT * FROM projects WHERE filesystem_path IS NOT NULL AND status = ? ORDER BY name')
      .all('active') as ProjectRow[];
  }

  getProjectFilesystemPath(identifier: string): string | null {
    const row = this.db
      .prepare('SELECT filesystem_path FROM projects WHERE identifier = ?')
      .get(identifier) as { filesystem_path?: string } | undefined;
    return row?.filesystem_path ?? null;
  }

  getProjectByFolderName(folderName: string): ProjectRow | null {
    if (!folderName) return null;
    const row = this.db
      .prepare(
        `SELECT * FROM projects
         WHERE LOWER(filesystem_path) = LOWER(?) OR LOWER(filesystem_path) LIKE LOWER(?) ESCAPE '\\'
         LIMIT 1`,
      )
      .get(folderName, `%${folderName}`) as ProjectRow | undefined;
    return row ?? null;
  }

  resolveProjectIdentifier(input: string | null): string | null {
    if (!input) return null;
    if (this.getProject(input)) return input;
    return this.getProjectByFolderName(input)?.identifier ?? null;
  }

  setProjectBeadsRemote(identifier: string, remote: BeadsRemoteSnapshot): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE projects SET beads_remote_owner = ?, beads_remote_repo = ?, beads_remote_url = ?,
       beads_remote_name = ?, beads_remote_status = ?, beads_remote_visibility = ?,
       beads_remote_provisioned_at = ?, beads_remote_last_push_at = ?,
       beads_remote_last_error = ?, updated_at = ? WHERE identifier = ?`,
    ).run(
      remote.owner ?? null, remote.repo ?? null, remote.url ?? null,
      remote.name ?? null, remote.status ?? null, remote.visibility ?? null,
      remote.provisioned_at ?? now, remote.last_push_at ?? null,
      remote.last_error ?? null, now, identifier,
    );
  }

  getProjectsWithLettaFolders(): ProjectRow[] {
    return this.db.prepare(
      'SELECT * FROM projects WHERE filesystem_path IS NOT NULL AND letta_folder_id IS NOT NULL AND status = ? ORDER BY name',
    ).all('active') as ProjectRow[];
  }

  getBeadsMirrorSyncedAt(identifier: string): number | null {
    const row = this.db.prepare('SELECT beads_mirror_synced_at FROM projects WHERE identifier = ?')
      .get(identifier) as { beads_mirror_synced_at: number | null } | undefined;
    return row?.beads_mirror_synced_at ?? null;
  }

  setBeadsMirrorSyncedAt(identifier: string, timestamp: number, error: string | null = null): void {
    this.db.prepare(
      'UPDATE projects SET beads_mirror_synced_at = ?, beads_mirror_last_error = ?, updated_at = ? WHERE identifier = ?',
    ).run(timestamp, error, Date.now(), identifier);
  }
}
