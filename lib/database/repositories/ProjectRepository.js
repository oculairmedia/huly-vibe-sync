export class ProjectRepository {
  constructor(db) {
    this.db = db;
  }

  upsertProject(project) {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO projects (
        identifier, name, huly_id, vibe_id, filesystem_path, git_url,
        issue_count, last_checked_at, last_sync_at, status, created_at, updated_at, description_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(identifier) DO UPDATE SET
        name = excluded.name,
        huly_id = COALESCE(excluded.huly_id, huly_id),
        vibe_id = COALESCE(excluded.vibe_id, vibe_id),
        filesystem_path = CASE WHEN excluded.filesystem_path IS NOT NULL THEN excluded.filesystem_path ELSE filesystem_path END,
        git_url = COALESCE(excluded.git_url, git_url),
        issue_count = excluded.issue_count,
        last_checked_at = excluded.last_checked_at,
        last_sync_at = excluded.last_sync_at,
        status = excluded.status,
        updated_at = excluded.updated_at,
        description_hash = COALESCE(excluded.description_hash, description_hash)
    `);

    stmt.run(
      project.identifier,
      project.name,
      project.huly_id || null,
      project.vibe_id || null,
      project.filesystem_path || null,
      project.git_url || null,
      project.issue_count || 0,
      project.last_checked_at || now,
      project.last_sync_at || now,
      project.status || 'active',
      project.created_at || now,
      now,
      project.description_hash || null
    );
  }

  getProject(identifier) {
    return this.db.prepare('SELECT * FROM projects WHERE identifier = ?').get(identifier);
  }

  getAllProjects() {
    return this.db.prepare('SELECT * FROM projects ORDER BY name').all();
  }

  getProjectsToSync(cacheExpiryMs = 300000, currentDescriptionHashes = {}) {
    const cutoff = Date.now() - cacheExpiryMs;
    const allProjects = this.db
      .prepare(
        `
      SELECT * FROM projects
      WHERE status = 'active'
      ORDER BY issue_count DESC, name
    `
      )
      .all();

    return allProjects.filter(project => {
      if (project.issue_count > 0) return true;

      const currentHash = currentDescriptionHashes[project.identifier];
      if (currentHash) {
        if (!project.description_hash) {
          console.log(`[DB] Project ${project.identifier} needs initial hash, forcing sync`);
          return true;
        }
        if (currentHash !== project.description_hash) {
          console.log(`[DB] Project ${project.identifier} metadata changed, forcing sync`);
          return true;
        }
      }

      if (project.last_checked_at < cutoff) return true;

      return false;
    });
  }

  getActiveProjects() {
    return this.db
      .prepare(
        `
      SELECT * FROM projects
      WHERE issue_count > 0
      ORDER BY issue_count DESC
    `
      )
      .all();
  }

  updateProjectActivity(identifier, issueCount) {
    this.db
      .prepare(
        `
      UPDATE projects
      SET issue_count = ?, last_checked_at = ?, updated_at = ?
      WHERE identifier = ?
    `
      )
      .run(issueCount, Date.now(), Date.now(), identifier);
  }

  getHulySyncCursor(identifier) {
    const row = this.db
      .prepare('SELECT huly_sync_cursor FROM projects WHERE identifier = ?')
      .get(identifier);
    return row?.huly_sync_cursor || null;
  }

  setHulySyncCursor(identifier, cursor) {
    this.db
      .prepare(`UPDATE projects SET huly_sync_cursor = ?, updated_at = ? WHERE identifier = ?`)
      .run(cursor, Date.now(), identifier);
  }

  clearHulySyncCursor(identifier) {
    this.db
      .prepare(`UPDATE projects SET huly_sync_cursor = NULL, updated_at = ? WHERE identifier = ?`)
      .run(Date.now(), identifier);
  }

  getProjectsWithLettaFolders() {
    return this.db
      .prepare(
        `
      SELECT identifier, name, filesystem_path, letta_folder_id
      FROM projects
      WHERE status = 'active'
        AND filesystem_path IS NOT NULL
        AND letta_folder_id IS NOT NULL
      ORDER BY name
    `
      )
      .all();
  }

  getProjectSummary() {
    return this.db
      .prepare(
        `
      SELECT identifier, name, issue_count, last_sync_at, last_checked_at, filesystem_path
      FROM projects
      ORDER BY issue_count DESC, name
    `
      )
      .all();
  }

  getProjectsWithFilesystemPath() {
    return this.db
      .prepare(
        `
      SELECT identifier, name, filesystem_path
      FROM projects
      WHERE filesystem_path IS NOT NULL
      ORDER BY name
    `
      )
      .all();
  }

  getProjectFilesystemPath(identifier) {
    const row = this.db
      .prepare('SELECT filesystem_path FROM projects WHERE identifier = ?')
      .get(identifier);
    return row?.filesystem_path || null;
  }

  getProjectByVibeId(vibeId) {
    return this.db
      .prepare(
        `
      SELECT identifier, name, huly_id, vibe_id, filesystem_path
      FROM projects
      WHERE vibe_id = ?
    `
      )
      .get(vibeId);
  }

  getProjectByFolderName(folderNameOrPath) {
    if (!folderNameOrPath) return null;

    const folderName = folderNameOrPath
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .pop()
      ?.toLowerCase();

    if (!folderName) return null;

    let project = this.db
      .prepare(
        `
      SELECT identifier, name, filesystem_path
      FROM projects
      WHERE LOWER(filesystem_path) = LOWER(?)
    `
      )
      .get(folderNameOrPath);

    if (project) return project.identifier;

    const allProjects = this.db
      .prepare(
        `
      SELECT identifier, name, filesystem_path
      FROM projects
      WHERE filesystem_path IS NOT NULL
    `
      )
      .all();

    for (const p of allProjects) {
      const storedFolderName = p.filesystem_path
        ?.replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .pop()
        ?.toLowerCase();

      if (storedFolderName === folderName) {
        return p.identifier;
      }
    }

    return null;
  }

  resolveProjectIdentifier(projectIdOrFolder) {
    if (!projectIdOrFolder) return null;

    const directMatch = this.db
      .prepare('SELECT identifier FROM projects WHERE identifier = ?')
      .get(projectIdOrFolder);

    if (directMatch) return directMatch.identifier;

    return this.getProjectByFolderName(projectIdOrFolder);
  }

  getProjectLettaInfo(identifier) {
    const stmt = this.db.prepare(`
      SELECT 
        letta_agent_id,
        letta_folder_id,
        letta_source_id,
        letta_last_sync_at
      FROM projects
      WHERE identifier = ?
    `);

    const result = stmt.get(identifier);
    return result || null;
  }

  setProjectLettaAgent(identifier, lettaInfo) {
    const { agentId, folderId, sourceId } = lettaInfo;

    const stmt = this.db.prepare(`
      UPDATE projects
      SET 
        letta_agent_id = ?,
        letta_folder_id = ?,
        letta_source_id = ?,
        updated_at = ?
      WHERE identifier = ?
    `);

    stmt.run(agentId, folderId || null, sourceId || null, Date.now(), identifier);
  }

  setProjectLettaFolderId(identifier, folderId) {
    const stmt = this.db.prepare(`
      UPDATE projects
      SET 
        letta_folder_id = ?,
        updated_at = ?
      WHERE identifier = ?
    `);

    stmt.run(folderId, Date.now(), identifier);
  }

  setProjectLettaSourceId(identifier, sourceId) {
    const stmt = this.db.prepare(`
      UPDATE projects
      SET 
        letta_source_id = ?,
        updated_at = ?
      WHERE identifier = ?
    `);

    stmt.run(sourceId, Date.now(), identifier);
  }

  setProjectLettaSyncAt(identifier, timestamp) {
    const stmt = this.db.prepare(`
      UPDATE projects
      SET 
        letta_last_sync_at = ?,
        updated_at = ?
      WHERE identifier = ?
    `);

    stmt.run(timestamp, Date.now(), identifier);
  }
}
