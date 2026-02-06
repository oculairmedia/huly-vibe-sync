/**
 * SQLite Database Manager for Sync State
 * Replaces JSON file-based state with proper database
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { BookStackRepository } from './database/repositories/BookStackRepository.js';
import { IssueRepository } from './database/repositories/IssueRepository.js';
import { MetadataRepository } from './database/repositories/MetadataRepository.js';
import { ProjectFilesRepository } from './database/repositories/ProjectFilesRepository.js';
import { ProjectRepository } from './database/repositories/ProjectRepository.js';
import { SyncHistoryRepository } from './database/repositories/SyncHistoryRepository.js';
import {
  computeDescriptionHash,
  computeIssueContentHash,
  hasIssueContentChanged,
} from './database/utils.js';
import { runAllMigrations } from './database/migrations.js';

export class SyncDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.metadata = null;
    this.projects = null;
    this.issues = null;
    this.syncHistory = null;
    this.projectFiles = null;
    this.bookstack = null;
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
    this.metadata = new MetadataRepository(this.db);
    this.projects = new ProjectRepository(this.db);
    this.issues = new IssueRepository(this.db);
    this.syncHistory = new SyncHistoryRepository(this.db);
    this.projectFiles = new ProjectFilesRepository(this.db);
    this.bookstack = new BookStackRepository(this.db);
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
        deleted_from_huly INTEGER DEFAULT 0,
        deleted_from_vibe INTEGER DEFAULT 0,
        deleted_from_beads INTEGER DEFAULT 0,
        FOREIGN KEY (project_identifier) REFERENCES projects(identifier)
      );

      CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_identifier);
      CREATE INDEX IF NOT EXISTS idx_issues_last_sync ON issues(last_sync_at);
      CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
      CREATE INDEX IF NOT EXISTS idx_issues_beads_id ON issues(beads_issue_id);
      CREATE INDEX IF NOT EXISTS idx_issues_deleted_from_huly ON issues(deleted_from_huly);

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

    // Run migrations for parent-child support, BookStack, deletion tracking
    runAllMigrations(this.db);
  }

  getBookStackLastExport(projectIdentifier) {
    return this.bookstack.getBookStackLastExport(projectIdentifier);
  }

  setBookStackLastExport(projectIdentifier, timestamp) {
    this.bookstack.setBookStackLastExport(projectIdentifier, timestamp);
  }

  upsertBookStackPage(page) {
    this.bookstack.upsertBookStackPage(page);
  }

  getBookStackPages(projectIdentifier) {
    return this.bookstack.getBookStackPages(projectIdentifier);
  }

  getBookStackPageByPath(localPath) {
    return this.bookstack.getBookStackPageByPath(localPath);
  }

  // ============================================================
  // METADATA OPERATIONS
  // ============================================================

  /**
   * Get last sync timestamp
   */
  getLastSync() {
    return this.metadata.getLastSync();
  }

  /**
   * Set last sync timestamp
   */
  setLastSync(timestamp) {
    this.metadata.setLastSync(timestamp);
  }

  // ============================================================
  // PROJECT OPERATIONS
  // ============================================================

  /**
   * Compute hash of project description for change detection
   */
  static computeDescriptionHash(description) {
    return computeDescriptionHash(description);
  }

  /**
   * Compute content hash for an issue (title + description + status + priority)
   * Used for detecting actual content changes vs just timestamp updates
   *
   * @param {Object} issue - Issue object with title, description, status, priority
   * @returns {string|null} 16-char hex hash or null
   */
  static computeIssueContentHash(issue) {
    return computeIssueContentHash(issue);
  }

  /**
   * Check if issue content has changed by comparing hashes
   *
   * @param {Object} newIssue - New issue data
   * @param {string} storedHash - Previously stored content hash
   * @returns {boolean} True if content changed
   */
  static hasIssueContentChanged(newIssue, storedHash) {
    return hasIssueContentChanged(newIssue, storedHash);
  }

  /**
   * Upsert project
   */
  upsertProject(project) {
    this.projects.upsertProject(project);
  }

  /**
   * Get project by identifier
   */
  getProject(identifier) {
    return this.projects.getProject(identifier);
  }

  /**
   * Get all projects
   */
  getAllProjects() {
    return this.projects.getAllProjects();
  }

  /**
   * Get projects that need syncing (haven't been checked recently or have issues)
   * Now also returns projects where metadata has changed even if they're empty
   */
  getProjectsToSync(cacheExpiryMs = 300000, currentDescriptionHashes = {}) {
    return this.projects.getProjectsToSync(cacheExpiryMs, currentDescriptionHashes);
  }

  /**
   * Get projects with issues
   */
  getActiveProjects() {
    return this.projects.getActiveProjects();
  }

  /**
   * Update project activity
   */
  updateProjectActivity(identifier, issueCount) {
    this.projects.updateProjectActivity(identifier, issueCount);
  }

  /**
   * Get Huly sync cursor for a project (for incremental sync)
   * @param {string} identifier - Project identifier
   * @returns {string|null} ISO timestamp of last synced modification, or null for full sync
   */
  getHulySyncCursor(identifier) {
    return this.projects.getHulySyncCursor(identifier);
  }

  /**
   * Set Huly sync cursor for a project (after successful sync)
   * @param {string} identifier - Project identifier
   * @param {string} cursor - ISO timestamp from syncMeta.latestModified
   */
  setHulySyncCursor(identifier, cursor) {
    this.projects.setHulySyncCursor(identifier, cursor);
  }

  /**
   * Clear Huly sync cursor (force full sync on next run)
   * @param {string} identifier - Project identifier
   */
  clearHulySyncCursor(identifier) {
    this.projects.clearHulySyncCursor(identifier);
  }

  // ============================================================
  // ISSUE OPERATIONS
  // ============================================================

  /**
   * Upsert issue (with parent-child support and content hashing)
   */
  upsertIssue(issue) {
    this.issues.upsertIssue(issue);
  }

  /**
   * Get issues for a project
   */
  getProjectIssues(projectIdentifier) {
    return this.issues.getProjectIssues(projectIdentifier);
  }

  /**
   * Get issue by identifier
   */
  getIssue(identifier) {
    return this.issues.getIssue(identifier);
  }

  markDeletedFromHuly(identifier) {
    return this.issues.markDeletedFromHuly(identifier);
  }

  isDeletedFromHuly(identifier) {
    return this.issues.isDeletedFromHuly(identifier);
  }

  markDeletedFromVibe(identifier) {
    return this.issues.markDeletedFromVibe(identifier);
  }

  markDeletedFromBeads(identifier) {
    return this.issues.markDeletedFromBeads(identifier);
  }

  deleteIssue(identifier) {
    return this.issues.deleteIssue(identifier);
  }

  getAllIssues() {
    return this.issues.getAllIssues();
  }

  getIssuesWithVibeTaskId(projectIdentifier = null) {
    return this.issues.getIssuesWithVibeTaskId(projectIdentifier);
  }

  getIssuesWithBeadsIssueId(projectIdentifier = null) {
    return this.issues.getIssuesWithBeadsIssueId(projectIdentifier);
  }

  /**
   * Get issues modified after timestamp
   */
  getModifiedIssues(projectIdentifier, sinceTimestamp) {
    return this.issues.getModifiedIssues(projectIdentifier, sinceTimestamp);
  }

  /**
   * Check if an issue's content has changed compared to stored hash
   *
   * @param {string} identifier - Issue identifier
   * @param {Object} newIssue - New issue data to compare
   * @returns {boolean} True if content changed or no previous hash exists
   */
  hasIssueChanged(identifier, newIssue) {
    return this.issues.hasIssueChanged(identifier, newIssue);
  }

  /**
   * Get issues where content hash differs from Huly source
   * (for detecting Beads-side changes that need to sync back)
   */
  getIssuesWithContentMismatch(projectIdentifier) {
    return this.issues.getIssuesWithContentMismatch(projectIdentifier);
  }

  // ============================================================
  // PARENT-CHILD OPERATIONS
  // ============================================================

  /**
   * Get child issues of a parent (by Huly ID)
   */
  getChildIssuesByHulyParent(parentHulyId) {
    return this.issues.getChildIssuesByHulyParent(parentHulyId);
  }

  /**
   * Get child issues of a parent (by Beads ID)
   */
  getChildIssuesByBeadsParent(parentBeadsId) {
    return this.issues.getChildIssuesByBeadsParent(parentBeadsId);
  }

  /**
   * Get issues that are parents (have sub-issues)
   */
  getParentIssues(projectIdentifier) {
    return this.issues.getParentIssues(projectIdentifier);
  }

  /**
   * Get issues that are children (have a parent)
   */
  getChildIssues(projectIdentifier) {
    return this.issues.getChildIssues(projectIdentifier);
  }

  /**
   * Update parent-child relationship
   */
  updateParentChild(identifier, parentHulyId, parentBeadsId = null) {
    this.issues.updateParentChild(identifier, parentHulyId, parentBeadsId);
  }

  /**
   * Update sub-issue count for a parent
   */
  updateSubIssueCount(identifier, count) {
    this.issues.updateSubIssueCount(identifier, count);
  }

  // ============================================================
  // SYNC HISTORY
  // ============================================================

  /**
   * Start a sync run
   */
  startSyncRun() {
    return this.syncHistory.startSyncRun();
  }

  /**
   * Complete a sync run
   */
  completeSyncRun(syncId, stats) {
    this.syncHistory.completeSyncRun(syncId, stats);
  }

  /**
   * Get recent sync history
   */
  getRecentSyncs(limit = 10) {
    return this.syncHistory.getRecentSyncs(limit);
  }

  // ============================================================
  // FILE TRACKING OPERATIONS (for incremental Letta uploads)
  // ============================================================

  /**
   * Get all tracked files for a project
   */
  getProjectFiles(projectIdentifier) {
    return this.projectFiles.getProjectFiles(projectIdentifier);
  }

  /**
   * Get a specific tracked file
   */
  getProjectFile(projectIdentifier, relativePath) {
    return this.projectFiles.getProjectFile(projectIdentifier, relativePath);
  }

  /**
   * Upsert a file tracking record
   */
  upsertProjectFile(fileInfo) {
    this.projectFiles.upsertProjectFile(fileInfo);
  }

  /**
   * Delete a file tracking record
   */
  deleteProjectFile(projectIdentifier, relativePath) {
    this.projectFiles.deleteProjectFile(projectIdentifier, relativePath);
  }

  /**
   * Delete all file tracking records for a project
   */
  deleteAllProjectFiles(projectIdentifier) {
    this.projectFiles.deleteAllProjectFiles(projectIdentifier);
  }

  /**
   * Get files that need to be deleted (exist in DB but not in current file list)
   */
  getOrphanedFiles(projectIdentifier, currentFilePaths) {
    return this.projectFiles.getOrphanedFiles(projectIdentifier, currentFilePaths);
  }

  /**
   * Get projects that have both a filesystem path and Letta folder ID
   * Used by FileWatcher to determine which projects to watch
   */
  getProjectsWithLettaFolders() {
    return this.projects.getProjectsWithLettaFolders();
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
    return this.projects.getProjectSummary();
  }

  /**
   * Get all projects with filesystem paths (for Beads watching)
   * @returns {Array<{identifier: string, name: string, filesystem_path: string}>}
   */
  getProjectsWithFilesystemPath() {
    return this.projects.getProjectsWithFilesystemPath();
  }

  getProjectFilesystemPath(identifier) {
    return this.projects.getProjectFilesystemPath(identifier);
  }

  getAllProjectsWithAgents() {
    return this.projects.getAllWithAgents();
  }

  lookupProjectByRepo(repo) {
    return this.projects.lookupByRepo(repo);
  }

  /**
   * Get project by Vibe ID
   * @param {string} vibeId - Vibe project UUID
   * @returns {Object|null} Project or null if not found
   */
  getProjectByVibeId(vibeId) {
    return this.projects.getProjectByVibeId(vibeId);
  }

  /**
   * Get project identifier by folder name or path
   * Supports:
   * - Full path: "/opt/stacks/lettatoolsselector" → "LTSEL"
   * - Folder name: "lettatoolsselector" → "LTSEL"
   * - Case-insensitive matching
   *
   * @param {string} folderNameOrPath - Folder name or full filesystem path
   * @returns {string|null} Project identifier or null if not found
   */
  getProjectByFolderName(folderNameOrPath) {
    return this.projects.getProjectByFolderName(folderNameOrPath);
  }

  /**
   * Resolve a project identifier that might be a folder name
   * Returns the valid Huly project identifier, or null if not resolvable
   *
   * @param {string} projectIdOrFolder - Either a Huly project ID or folder name
   * @returns {string|null} Valid project identifier or null
   */
  resolveProjectIdentifier(projectIdOrFolder) {
    return this.projects.resolveProjectIdentifier(projectIdOrFolder);
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
    return this.projects.getProjectLettaInfo(identifier);
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
    this.projects.setProjectLettaAgent(identifier, lettaInfo);
  }

  /**
   * Set Letta folder ID for a project
   * @param {string} identifier - Project identifier
   * @param {string} folderId - Letta folder ID
   */
  setProjectLettaFolderId(identifier, folderId) {
    this.projects.setProjectLettaFolderId(identifier, folderId);
  }

  /**
   * Set Letta source ID for a project
   * @param {string} identifier - Project identifier
   * @param {string} sourceId - Letta source ID
   */
  setProjectLettaSourceId(identifier, sourceId) {
    this.projects.setProjectLettaSourceId(identifier, sourceId);
  }

  /**
   * Update the last sync timestamp for Letta agent
   * @param {string} identifier - Project identifier
   * @param {number} timestamp - Sync timestamp (milliseconds)
   */
  setProjectLettaSyncAt(identifier, timestamp) {
    this.projects.setProjectLettaSyncAt(identifier, timestamp);
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
