import type Database from 'better-sqlite3';

export class ProjectFilesRepository {
  constructor(private db: Database.Database) {}

  getProjectFiles(projectIdentifier: string): unknown[] {
    return this.db
      .prepare('SELECT * FROM project_files WHERE project_identifier = ?')
      .all(projectIdentifier);
  }

  getProjectFile(projectIdentifier: string, relativePath: string): unknown {
    return this.db
      .prepare('SELECT * FROM project_files WHERE project_identifier = ? AND relative_path = ?')
      .get(projectIdentifier, relativePath);
  }

  upsertProjectFile(fileInfo: Record<string, unknown>): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO project_files (project_identifier, relative_path, content_hash,
         letta_file_id, file_size, uploaded_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_identifier, relative_path) DO UPDATE SET
           content_hash = excluded.content_hash, letta_file_id = excluded.letta_file_id,
           file_size = excluded.file_size, updated_at = excluded.updated_at`,
      )
      .run(
        fileInfo.project_identifier, fileInfo.relative_path, fileInfo.content_hash,
        (fileInfo.letta_file_id as string) || null, (fileInfo.file_size as number) || 0,
        (fileInfo.uploaded_at as number) || now, now,
      );
  }

  deleteProjectFile(projectIdentifier: string, relativePath: string): void {
    this.db
      .prepare('DELETE FROM project_files WHERE project_identifier = ? AND relative_path = ?')
      .run(projectIdentifier, relativePath);
  }

  deleteAllProjectFiles(projectIdentifier: string): void {
    this.db.prepare('DELETE FROM project_files WHERE project_identifier = ?').run(projectIdentifier);
  }

  getOrphanedFiles(projectIdentifier: string, currentFilePaths: string[]): unknown[] {
    const allTracked = this.getProjectFiles(projectIdentifier) as Array<{ relative_path: string }>;
    const currentSet = new Set(currentFilePaths);
    return allTracked.filter((f) => !currentSet.has(f.relative_path));
  }
}
