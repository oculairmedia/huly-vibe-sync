export class ProjectLettaRepository {
  constructor(db) {
    this.db = db;
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

    return stmt.get(identifier) || null;
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

  getAllWithAgents() {
    return this.db
      .prepare(
        `
      SELECT
        letta_agent_id AS agent_id,
        name AS agent_name,
        identifier AS project_identifier,
        git_url,
        filesystem_path
      FROM projects
      WHERE letta_agent_id IS NOT NULL
      ORDER BY name
    `
      )
      .all();
  }

  lookupByRepo(repo) {
    const pattern = `%${repo}%`;
    return this.db
      .prepare(
        `
      SELECT
        letta_agent_id AS agent_id,
        name AS agent_name,
        identifier AS project_identifier,
        git_url
      FROM projects
      WHERE letta_agent_id IS NOT NULL
        AND git_url IS NOT NULL
        AND LOWER(git_url) LIKE LOWER(?)
      LIMIT 1
    `
      )
      .get(pattern);
  }
}
