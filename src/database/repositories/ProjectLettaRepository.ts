import type Database from 'better-sqlite3';

export interface LettaAgentInfo {
  agentId: string;
  folderId?: string | null;
  sourceId?: string | null;
}

export class ProjectLettaRepository {
  constructor(private db: Database.Database) {}

  getProjectLettaInfo(identifier: string) {
    const stmt = this.db.prepare(
      `SELECT letta_agent_id, letta_folder_id, letta_source_id, letta_last_sync_at
       FROM projects WHERE identifier = ?`,
    );
    return stmt.get(identifier) || null;
  }

  setProjectLettaAgent(identifier: string, lettaInfo: LettaAgentInfo): void {
    const { agentId, folderId, sourceId } = lettaInfo;
    this.db
      .prepare(
        `UPDATE projects SET letta_agent_id = ?, letta_folder_id = ?, letta_source_id = ?, updated_at = ?
         WHERE identifier = ?`,
      )
      .run(agentId, folderId || null, sourceId || null, Date.now(), identifier);
  }

  setProjectLettaFolderId(identifier: string, folderId: string): void {
    this.db
      .prepare('UPDATE projects SET letta_folder_id = ?, updated_at = ? WHERE identifier = ?')
      .run(folderId, Date.now(), identifier);
  }

  setProjectLettaSourceId(identifier: string, sourceId: string): void {
    this.db
      .prepare('UPDATE projects SET letta_source_id = ?, updated_at = ? WHERE identifier = ?')
      .run(sourceId, Date.now(), identifier);
  }

  setProjectLettaSyncAt(identifier: string, timestamp: number): void {
    this.db
      .prepare('UPDATE projects SET letta_last_sync_at = ?, updated_at = ? WHERE identifier = ?')
      .run(timestamp, Date.now(), identifier);
  }

  getAllWithAgents(): unknown[] {
    return this.db
      .prepare(
        `SELECT letta_agent_id AS agent_id, name AS agent_name,
                identifier AS project_identifier, git_url, filesystem_path
         FROM projects WHERE letta_agent_id IS NOT NULL ORDER BY name`,
      )
      .all();
  }

  lookupByRepo(repo: string): unknown {
    const pattern = `%${repo}%`;
    return this.db
      .prepare(
        `SELECT letta_agent_id AS agent_id, name AS agent_name,
                identifier AS project_identifier, git_url
         FROM projects WHERE letta_agent_id IS NOT NULL AND git_url IS NOT NULL
         AND LOWER(git_url) LIKE LOWER(?) LIMIT 1`,
      )
      .get(pattern);
  }
}
