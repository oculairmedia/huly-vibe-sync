/**
 * SQLite Database Manager for Sync State
 * Replaces JSON file-based state with proper database
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class SyncDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  /**
   * Initialize database and create tables
   */
  initialize() {
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL'); // Better concurrency
    this.db.pragma('foreign_keys = ON');

    this.createTables();
    console.log(`[DB] Initialized database at ${this.dbPath}`);
  }

  /**
   * Create schema
   */
  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS projects (
        identifier TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        huly_id TEXT,
        vibe_id INTEGER,
        last_sync_at INTEGER,
        issue_count INTEGER DEFAULT 0,
        last_checked_at INTEGER,
        filesystem_path TEXT,
        git_url TEXT,
        status TEXT DEFAULT 'active',
        created_at INTEGER,
        updated_at INTEGER,
        letta_agent_id TEXT,
        letta_folder_id TEXT,
        letta_source_id TEXT,
        letta_last_sync_at INTEGER,
        description_hash TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_projects_last_sync ON projects(last_sync_at);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_issue_count ON projects(issue_count);
      CREATE INDEX IF NOT EXISTS idx_projects_description_hash ON projects(description_hash);

      CREATE TABLE IF NOT EXISTS issues (
        identifier TEXT PRIMARY KEY,
        project_identifier TEXT NOT NULL,
        huly_id TEXT,
        vibe_task_id INTEGER,
        beads_issue_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT,
        priority TEXT,
        last_sync_at INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        vibe_status TEXT,
        beads_status TEXT,
        huly_modified_at INTEGER,
        vibe_modified_at INTEGER,
        beads_modified_at INTEGER,
        FOREIGN KEY (project_identifier) REFERENCES projects(identifier)
      );

      CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_identifier);
      CREATE INDEX IF NOT EXISTS idx_issues_last_sync ON issues(last_sync_at);
      CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
      CREATE INDEX IF NOT EXISTS idx_issues_beads_id ON issues(beads_issue_id);

      CREATE TABLE IF NOT EXISTS sync_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER,
        completed_at INTEGER,
        projects_processed INTEGER,
        projects_failed INTEGER,
        issues_synced INTEGER,
        errors TEXT,
        duration_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_sync_history_started ON sync_history(started_at);

      -- Track uploaded files for incremental sync
      CREATE TABLE IF NOT EXISTS project_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_identifier TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        letta_file_id TEXT,
        file_size INTEGER,
        uploaded_at INTEGER,
        updated_at INTEGER,
        UNIQUE(project_identifier, relative_path),
        FOREIGN KEY (project_identifier) REFERENCES projects(identifier)
      );

      CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_identifier);
      CREATE INDEX IF NOT EXISTS idx_project_files_hash ON project_files(content_hash);
    `);

    // Run migrations for parent-child support
    this.migrateParentChildColumns();
  }

  /**
   * Add parent-child columns to issues table (migration)
   */
  migrateParentChildColumns() {
    // Check if columns exist
    const columns = this.db.prepare("PRAGMA table_info(issues)").all();
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('parent_huly_id')) {
      console.log('[DB] Adding parent_huly_id column to issues table');
      this.db.exec(`ALTER TABLE issues ADD COLUMN parent_huly_id TEXT`);
    }

    if (!columnNames.includes('parent_vibe_id')) {
      console.log('[DB] Adding parent_vibe_id column to issues table');
      this.db.exec(`ALTER TABLE issues ADD COLUMN parent_vibe_id TEXT`);
    }

    if (!columnNames.includes('parent_beads_id')) {
      console.log('[DB] Adding parent_beads_id column to issues table');
      this.db.exec(`ALTER TABLE issues ADD COLUMN parent_beads_id TEXT`);
    }

    if (!columnNames.includes('sub_issue_count')) {
      console.log('[DB] Adding sub_issue_count column to issues table');
      this.db.exec(`ALTER TABLE issues ADD COLUMN sub_issue_count INTEGER DEFAULT 0`);
    }

    // Create indexes for parent lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_issues_parent_huly ON issues(parent_huly_id);
      CREATE INDEX IF NOT EXISTS idx_issues_parent_vibe ON issues(parent_vibe_id);
      CREATE INDEX IF NOT EXISTS idx_issues_parent_beads ON issues(parent_beads_id);
    `);

    // Add content hash columns for change detection
    if (!columnNames.includes('content_hash')) {
      console.log('[DB] Adding content_hash column to issues table');
      this.db.exec(`ALTER TABLE issues ADD COLUMN content_hash TEXT`);
    }

    if (!columnNames.includes('huly_content_hash')) {
      console.log('[DB] Adding huly_content_hash column to issues table');
      this.db.exec(`ALTER TABLE issues ADD COLUMN huly_content_hash TEXT`);
    }

    if (!columnNames.includes('beads_content_hash')) {
      console.log('[DB] Adding beads_content_hash column to issues table');
      this.db.exec(`ALTER TABLE issues ADD COLUMN beads_content_hash TEXT`);
    }

    // Create index for hash lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_issues_content_hash ON issues(content_hash);
    `);

    // Add huly_sync_cursor column to projects for incremental sync
    const projectColumns = this.db.prepare("PRAGMA table_info(projects)").all();
    const projectColumnNames = projectColumns.map(c => c.name);
    
    if (!projectColumnNames.includes('huly_sync_cursor')) {
      console.log('[DB] Adding huly_sync_cursor column to projects table');
      this.db.exec(`ALTER TABLE projects ADD COLUMN huly_sync_cursor TEXT`);
    }
  }

  // ============================================================
  // METADATA OPERATIONS
  // ============================================================

  /**
   * Get last sync timestamp
   */
  getLastSync() {
    const row = this.db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get('last_sync');

    return row ? parseInt(row.value) : null;
  }

  /**
   * Set last sync timestamp
   */
  setLastSync(timestamp) {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
    `
      )
      .run('last_sync', timestamp.toString(), Date.now());
  }

  // ============================================================
  // PROJECT OPERATIONS
  // ============================================================

  /**
   * Compute hash of project description for change detection
   */
  static computeDescriptionHash(description) {
    if (!description) return null;
    return crypto.createHash('sha256').update(description).digest('hex').substring(0, 16);
  }

  /**
   * Compute content hash for an issue (title + description + status + priority)
   * Used for detecting actual content changes vs just timestamp updates
   * 
   * @param {Object} issue - Issue object with title, description, status, priority
   * @returns {string|null} 16-char hex hash or null
   */
  static computeIssueContentHash(issue) {
    if (!issue) return null;
    
    // Normalize and concatenate key fields that represent "content"
    const content = [
      issue.title || '',
      issue.description || '',
      issue.status || '',
      issue.priority || '',
    ].join('|');
    
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Check if issue content has changed by comparing hashes
   * 
   * @param {Object} newIssue - New issue data
   * @param {string} storedHash - Previously stored content hash
   * @returns {boolean} True if content changed
   */
  static hasIssueContentChanged(newIssue, storedHash) {
    if (!storedHash) return true; // No previous hash = treat as changed
    const newHash = SyncDatabase.computeIssueContentHash(newIssue);
    return newHash !== storedHash;
  }

  /**
   * Upsert project
   */
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

  /**
   * Get project by identifier
   */
  getProject(identifier) {
    return this.db.prepare('SELECT * FROM projects WHERE identifier = ?').get(identifier);
  }

  /**
   * Get all projects
   */
  getAllProjects() {
    return this.db.prepare('SELECT * FROM projects ORDER BY name').all();
  }

  /**
   * Get projects that need syncing (haven't been checked recently or have issues)
   * Now also returns projects where metadata has changed even if they're empty
   */
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

    // Filter projects that need syncing based on:
    // 1. Have issues (issue_count > 0) - always sync
    // 2. Description hash is null (needs initial hash calculation) - always sync
    // 3. Description hash has changed (metadata update) - always sync
    // 4. Haven't been checked recently (last_checked_at < cutoff) - sync if cache expired
    return allProjects.filter(project => {
      // Always sync projects with issues
      if (project.issue_count > 0) return true;

      // Check metadata changes (higher priority than cache expiry)
      const currentHash = currentDescriptionHashes[project.identifier];
      if (currentHash) {
        // If we don't have a stored hash yet, include this project to populate it
        if (!project.description_hash) {
          console.log(`[DB] Project ${project.identifier} needs initial hash, forcing sync`);
          return true;
        }
        // If hash changed, include this project
        if (currentHash !== project.description_hash) {
          console.log(`[DB] Project ${project.identifier} metadata changed, forcing sync`);
          return true;
        }
      }

      // Finally check if cache has expired
      if (project.last_checked_at < cutoff) return true;

      return false;
    });
  }

  /**
   * Get projects with issues
   */
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

  /**
   * Update project activity
   */
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

  /**
   * Get Huly sync cursor for a project (for incremental sync)
   * @param {string} identifier - Project identifier
   * @returns {string|null} ISO timestamp of last synced modification, or null for full sync
   */
  getHulySyncCursor(identifier) {
    const row = this.db.prepare('SELECT huly_sync_cursor FROM projects WHERE identifier = ?').get(identifier);
    return row?.huly_sync_cursor || null;
  }

  /**
   * Set Huly sync cursor for a project (after successful sync)
   * @param {string} identifier - Project identifier
   * @param {string} cursor - ISO timestamp from syncMeta.latestModified
   */
  setHulySyncCursor(identifier, cursor) {
    this.db
      .prepare(`UPDATE projects SET huly_sync_cursor = ?, updated_at = ? WHERE identifier = ?`)
      .run(cursor, Date.now(), identifier);
  }

  /**
   * Clear Huly sync cursor (force full sync on next run)
   * @param {string} identifier - Project identifier
   */
  clearHulySyncCursor(identifier) {
    this.db
      .prepare(`UPDATE projects SET huly_sync_cursor = NULL, updated_at = ? WHERE identifier = ?`)
      .run(Date.now(), identifier);
  }

  // ============================================================
  // ISSUE OPERATIONS
  // ============================================================

  /**
   * Upsert issue (with parent-child support and content hashing)
   */
  upsertIssue(issue) {
    const now = Date.now();
    
    // Compute content hash for change detection
    const contentHash = SyncDatabase.computeIssueContentHash(issue);
    
    const stmt = this.db.prepare(`
      INSERT INTO issues (
        identifier, project_identifier, huly_id, vibe_task_id, beads_issue_id,
        title, description, status, priority, last_sync_at, created_at, updated_at,
        huly_modified_at, vibe_modified_at, beads_modified_at, vibe_status, beads_status,
        parent_huly_id, parent_vibe_id, parent_beads_id, sub_issue_count,
        content_hash, huly_content_hash, beads_content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(identifier) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        priority = excluded.priority,
        vibe_task_id = COALESCE(excluded.vibe_task_id, vibe_task_id),
        beads_issue_id = COALESCE(excluded.beads_issue_id, beads_issue_id),
        last_sync_at = excluded.last_sync_at,
        updated_at = excluded.updated_at,
        huly_modified_at = COALESCE(excluded.huly_modified_at, huly_modified_at),
        vibe_modified_at = COALESCE(excluded.vibe_modified_at, vibe_modified_at),
        beads_modified_at = COALESCE(excluded.beads_modified_at, beads_modified_at),
        vibe_status = COALESCE(excluded.vibe_status, vibe_status),
        beads_status = COALESCE(excluded.beads_status, beads_status),
        parent_huly_id = COALESCE(excluded.parent_huly_id, parent_huly_id),
        parent_vibe_id = COALESCE(excluded.parent_vibe_id, parent_vibe_id),
        parent_beads_id = COALESCE(excluded.parent_beads_id, parent_beads_id),
        sub_issue_count = COALESCE(excluded.sub_issue_count, sub_issue_count),
        content_hash = excluded.content_hash,
        huly_content_hash = COALESCE(excluded.huly_content_hash, huly_content_hash),
        beads_content_hash = COALESCE(excluded.beads_content_hash, beads_content_hash)
    `);

    stmt.run(
      issue.identifier,
      issue.project_identifier,
      issue.huly_id || null,
      issue.vibe_task_id || null,
      issue.beads_issue_id || null,
      issue.title || issue.identifier || 'Untitled Issue',
      issue.description || '',
      issue.status || 'unknown',
      issue.priority || 'medium',
      now,
      issue.created_at || now,
      now,
      issue.huly_modified_at || null,
      issue.vibe_modified_at || null,
      issue.beads_modified_at || null,
      issue.vibe_status || null,
      issue.beads_status || null,
      issue.parent_huly_id || null,
      issue.parent_vibe_id || null,
      issue.parent_beads_id || null,
      issue.sub_issue_count || 0,
      contentHash,
      issue.huly_content_hash || null,
      issue.beads_content_hash || null
    );
  }

  /**
   * Get issues for a project
   */
  getProjectIssues(projectIdentifier) {
    return this.db
      .prepare('SELECT * FROM issues WHERE project_identifier = ? ORDER BY identifier')
      .all(projectIdentifier);
  }

  /**
   * Get issue by identifier
   */
  getIssue(identifier) {
    return this.db.prepare('SELECT * FROM issues WHERE identifier = ?').get(identifier);
  }

  /**
   * Get all issues (for beads sync lookups)
   */
  getAllIssues() {
    return this.db.prepare('SELECT * FROM issues ORDER BY identifier').all();
  }

  /**
   * Get issues modified after timestamp
   */
  getModifiedIssues(projectIdentifier, sinceTimestamp) {
    return this.db
      .prepare(
        `
      SELECT * FROM issues
      WHERE project_identifier = ? AND last_sync_at > ?
      ORDER BY identifier
    `
      )
      .all(projectIdentifier, sinceTimestamp);
  }

  /**
   * Check if an issue's content has changed compared to stored hash
   * 
   * @param {string} identifier - Issue identifier
   * @param {Object} newIssue - New issue data to compare
   * @returns {boolean} True if content changed or no previous hash exists
   */
  hasIssueChanged(identifier, newIssue) {
    const stored = this.getIssue(identifier);
    if (!stored || !stored.content_hash) return true;
    return SyncDatabase.hasIssueContentChanged(newIssue, stored.content_hash);
  }

  /**
   * Get issues where content hash differs from Huly source
   * (for detecting Beads-side changes that need to sync back)
   */
  getIssuesWithContentMismatch(projectIdentifier) {
    return this.db
      .prepare(
        `
      SELECT * FROM issues
      WHERE project_identifier = ?
        AND content_hash IS NOT NULL
        AND huly_content_hash IS NOT NULL
        AND content_hash != huly_content_hash
      ORDER BY identifier
    `
      )
      .all(projectIdentifier);
  }

  // ============================================================
  // PARENT-CHILD OPERATIONS
  // ============================================================

  /**
   * Get child issues of a parent (by Huly ID)
   */
  getChildIssuesByHulyParent(parentHulyId) {
    return this.db
      .prepare('SELECT * FROM issues WHERE parent_huly_id = ? ORDER BY identifier')
      .all(parentHulyId);
  }

  /**
   * Get child issues of a parent (by Beads ID)
   */
  getChildIssuesByBeadsParent(parentBeadsId) {
    return this.db
      .prepare('SELECT * FROM issues WHERE parent_beads_id = ? ORDER BY identifier')
      .all(parentBeadsId);
  }

  /**
   * Get issues that are parents (have sub-issues)
   */
  getParentIssues(projectIdentifier) {
    return this.db
      .prepare(
        `
      SELECT * FROM issues
      WHERE project_identifier = ? AND sub_issue_count > 0
      ORDER BY identifier
    `
      )
      .all(projectIdentifier);
  }

  /**
   * Get issues that are children (have a parent)
   */
  getChildIssues(projectIdentifier) {
    return this.db
      .prepare(
        `
      SELECT * FROM issues
      WHERE project_identifier = ? AND parent_huly_id IS NOT NULL
      ORDER BY identifier
    `
      )
      .all(projectIdentifier);
  }

  /**
   * Update parent-child relationship
   */
  updateParentChild(identifier, parentHulyId, parentBeadsId = null) {
    this.db
      .prepare(
        `
      UPDATE issues
      SET parent_huly_id = ?, parent_beads_id = ?, updated_at = ?
      WHERE identifier = ?
    `
      )
      .run(parentHulyId, parentBeadsId, Date.now(), identifier);
  }

  /**
   * Update sub-issue count for a parent
   */
  updateSubIssueCount(identifier, count) {
    this.db
      .prepare(
        `
      UPDATE issues
      SET sub_issue_count = ?, updated_at = ?
      WHERE identifier = ?
    `
      )
      .run(count, Date.now(), identifier);
  }

  // ============================================================
  // SYNC HISTORY
  // ============================================================

  /**
   * Start a sync run
   */
  startSyncRun() {
    const result = this.db
      .prepare(
        `
      INSERT INTO sync_history (started_at)
      VALUES (?)
    `
      )
      .run(Date.now());

    return result.lastInsertRowid;
  }

  /**
   * Complete a sync run
   */
  completeSyncRun(syncId, stats) {
    this.db
      .prepare(
        `
      UPDATE sync_history
      SET completed_at = ?,
          projects_processed = ?,
          projects_failed = ?,
          issues_synced = ?,
          errors = ?,
          duration_ms = ?
      WHERE id = ?
    `
      )
      .run(
        Date.now(),
        stats.projectsProcessed || 0,
        stats.projectsFailed || 0,
        stats.issuesSynced || 0,
        JSON.stringify(stats.errors || []),
        stats.durationMs || 0,
        syncId
      );
  }

  /**
   * Get recent sync history
   */
  getRecentSyncs(limit = 10) {
    return this.db
      .prepare(
        `
      SELECT * FROM sync_history
      ORDER BY started_at DESC
      LIMIT ?
    `
      )
      .all(limit);
  }

  // ============================================================
  // FILE TRACKING OPERATIONS (for incremental Letta uploads)
  // ============================================================

  /**
   * Get all tracked files for a project
   */
  getProjectFiles(projectIdentifier) {
    return this.db
      .prepare('SELECT * FROM project_files WHERE project_identifier = ?')
      .all(projectIdentifier);
  }

  /**
   * Get a specific tracked file
   */
  getProjectFile(projectIdentifier, relativePath) {
    return this.db
      .prepare('SELECT * FROM project_files WHERE project_identifier = ? AND relative_path = ?')
      .get(projectIdentifier, relativePath);
  }

  /**
   * Upsert a file tracking record
   */
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

  /**
   * Delete a file tracking record
   */
  deleteProjectFile(projectIdentifier, relativePath) {
    this.db
      .prepare('DELETE FROM project_files WHERE project_identifier = ? AND relative_path = ?')
      .run(projectIdentifier, relativePath);
  }

  /**
   * Delete all file tracking records for a project
   */
  deleteAllProjectFiles(projectIdentifier) {
    this.db
      .prepare('DELETE FROM project_files WHERE project_identifier = ?')
      .run(projectIdentifier);
  }

  /**
   * Get files that need to be deleted (exist in DB but not in current file list)
   */
  getOrphanedFiles(projectIdentifier, currentFilePaths) {
    const allTracked = this.getProjectFiles(projectIdentifier);
    const currentSet = new Set(currentFilePaths);
    return allTracked.filter(f => !currentSet.has(f.relative_path));
  }

  /**
   * Get projects that have both a filesystem path and Letta folder ID
   * Used by FileWatcher to determine which projects to watch
   */
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

  // ============================================================
  // ANALYTICS / QUERIES
  // ============================================================

  /**
   * Get sync statistics
   */
  getStats() {
    const totalProjects = this.db.prepare('SELECT COUNT(*) as count FROM projects').get().count;
    const activeProjects = this.db
      .prepare('SELECT COUNT(*) as count FROM projects WHERE issue_count > 0')
      .get().count;
    const totalIssues = this.db.prepare('SELECT COUNT(*) as count FROM issues').get().count;
    const lastSync = this.getLastSync();

    return {
      totalProjects,
      activeProjects,
      emptyProjects: totalProjects - activeProjects,
      totalIssues,
      lastSync: lastSync ? new Date(lastSync).toISOString() : 'never',
    };
  }

  /**
   * Get project summary with issue counts
   */
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

  // ============================================================
  // MIGRATION / IMPORT
  // ============================================================

  /**
   * Import from old JSON state file
   */
  importFromJSON(jsonState) {
    const transaction = this.db.transaction(() => {
      // Import metadata
      if (jsonState.lastSync) {
        this.setLastSync(jsonState.lastSync);
      }

      // Import project activity
      if (jsonState.projectActivity) {
        Object.entries(jsonState.projectActivity).forEach(([identifier, activity]) => {
          this.upsertProject({
            identifier,
            name: identifier, // Will be updated on next sync
            issue_count: activity.issueCount || 0,
            last_checked_at: activity.lastChecked || Date.now(),
          });
        });
      }

      // Import project timestamps
      if (jsonState.projectTimestamps) {
        Object.entries(jsonState.projectTimestamps).forEach(([identifier, timestamp]) => {
          this.db
            .prepare(
              `
            UPDATE projects SET last_sync_at = ? WHERE identifier = ?
          `
            )
            .run(timestamp, identifier);
        });
      }
    });

    transaction();
    console.log('[DB] Imported data from JSON state');
  }

  /**
   * Get Letta agent information for a project
   * @param {string} identifier - Project identifier
   * @returns {Object|null} - Letta info or null if not found
   */
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

  /**
   * Set Letta agent, folder, and source IDs for a project
   * @param {string} identifier - Project identifier
   * @param {Object} lettaInfo - Letta information
   * @param {string} lettaInfo.agentId - Letta agent ID
   * @param {string} [lettaInfo.folderId] - Optional folder ID
   * @param {string} [lettaInfo.sourceId] - Optional source ID
   */
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

  /**
   * Set Letta folder ID for a project
   * @param {string} identifier - Project identifier
   * @param {string} folderId - Letta folder ID
   */
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

  /**
   * Set Letta source ID for a project
   * @param {string} identifier - Project identifier
   * @param {string} sourceId - Letta source ID
   */
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

  /**
   * Update the last sync timestamp for Letta agent
   * @param {string} identifier - Project identifier
   * @param {number} timestamp - Sync timestamp (milliseconds)
   */
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

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      console.log('[DB] Database closed');
    }
  }
}

/**
 * Migrate from legacy JSON state file to SQLite database
 *
 * @param {SyncDatabase} db - Database instance
 * @param {string} jsonFilePath - Path to legacy JSON state file
 * @returns {boolean} True if migration was performed
 */
export function migrateFromJSON(db, jsonFilePath) {
  if (!fs.existsSync(jsonFilePath)) {
    return false;
  }

  // Check if database is empty (new database)
  const lastSync = db.getLastSync();
  if (lastSync) {
    // Database already has data, skip migration
    return false;
  }

  console.log('[Migration] Detected existing JSON state file, importing data...');

  try {
    const oldState = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
    db.importFromJSON(oldState);

    // Backup old file
    const backupFile = `${jsonFilePath}.backup-${Date.now()}`;
    fs.renameSync(jsonFilePath, backupFile);
    console.log(`[Migration] ✓ Migration complete, old file backed up to ${backupFile}`);
    return true;
  } catch (migrationError) {
    console.error('[Migration] ✗ Failed to migrate JSON data:', migrationError.message);
    console.error('[Migration] Continuing with empty database...');
    return false;
  }
}

/**
 * Factory function to create and initialize database
 */
export function createSyncDatabase(dbPath) {
  const db = new SyncDatabase(dbPath);
  db.initialize();
  return db;
}
