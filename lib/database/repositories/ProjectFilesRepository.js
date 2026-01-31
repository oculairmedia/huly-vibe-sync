export class ProjectFilesRepository {
  constructor(db) {
    this.db = db;
  }

  getProjectFiles(projectIdentifier) {
    return this.db
      .prepare('SELECT * FROM project_files WHERE project_identifier = ?')
      .all(projectIdentifier);
  }

  getProjectFile(projectIdentifier, relativePath) {
    return this.db
      .prepare('SELECT * FROM project_files WHERE project_identifier = ? AND relative_path = ?')
      .get(projectIdentifier, relativePath);
  }

  upsertProjectFile(fileInfo) {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO project_files (
        project_identifier, relative_path, content_hash, letta_file_id, file_size, uploaded_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_identifier, relative_path) DO UPDATE SET
        content_hash = excluded.content_hash,
        letta_file_id = excluded.letta_file_id,
        file_size = excluded.file_size,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      fileInfo.project_identifier,
      fileInfo.relative_path,
      fileInfo.content_hash,
      fileInfo.letta_file_id || null,
      fileInfo.file_size || 0,
      fileInfo.uploaded_at || now,
      now
    );
  }

  deleteProjectFile(projectIdentifier, relativePath) {
    this.db
      .prepare('DELETE FROM project_files WHERE project_identifier = ? AND relative_path = ?')
      .run(projectIdentifier, relativePath);
  }

  deleteAllProjectFiles(projectIdentifier) {
    this.db
      .prepare('DELETE FROM project_files WHERE project_identifier = ?')
      .run(projectIdentifier);
  }

  getOrphanedFiles(projectIdentifier, currentFilePaths) {
    const allTracked = this.getProjectFiles(projectIdentifier);
    const currentSet = new Set(currentFilePaths);
    return allTracked.filter(f => !currentSet.has(f.relative_path));
  }
}
