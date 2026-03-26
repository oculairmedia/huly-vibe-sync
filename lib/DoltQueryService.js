/**
 * Dolt Query Service
 *
 * Provides a SQL interface to the beads Dolt database.
 * Uses mysql2/promise for connection pooling to the Dolt SQL server.
 *
 * @module DoltQueryService
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

/** Default Dolt SQL server host */
const DEFAULT_HOST = '127.0.0.1';

/** Default database name */
const DEFAULT_DATABASE = 'huly_vibe_sync';

/** Port file relative to repo root */
const PORT_FILE = '.beads/dolt-server.port';

/**
 * Read the Dolt SQL server port from the port file.
 *
 * @param {string} repoPath - Path to the repository root
 * @returns {number} The port number
 * @throws {Error} If the port file cannot be read or contains invalid data
 */
function discoverPort(repoPath) {
  const portFile = path.join(repoPath, PORT_FILE);
  if (!fs.existsSync(portFile)) {
    throw new Error(`Dolt server port file not found: ${portFile}`);
  }
  const raw = fs.readFileSync(portFile, 'utf-8').trim();
  const port = parseInt(raw, 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port in ${portFile}: ${raw}`);
  }
  return port;
}

/**
 * Service for querying the beads Dolt database via SQL.
 *
 * Usage:
 * ```js
 * const svc = new DoltQueryService();
 * await svc.connect('/opt/stacks/huly-vibe-sync');
 * const counts = await svc.getStatusCounts();
 * await svc.disconnect();
 * ```
 */
export class DoltQueryService {
  constructor() {
    /** @type {import('mysql2/promise').Pool|null} */
    this.pool = null;

    /** @type {string|null} */
    this.repoPath = null;
  }

  /**
   * Initialize the connection pool for a workspace.
   *
   * Auto-discovers the port from `.beads/dolt-server.port`.
   *
   * @param {string} repoPath - Path to the repository root
   * @param {Object} [opts] - Optional overrides
   * @param {number} [opts.port] - Override auto-discovered port
   * @param {string} [opts.host] - Override host (default 127.0.0.1)
   * @param {string} [opts.database] - Override database name
   * @param {number} [opts.connectionLimit] - Pool connection limit (default 5)
   * @returns {Promise<void>}
   */
  async connect(repoPath, opts = {}) {
    this.repoPath = repoPath;
    const port = opts.port ?? discoverPort(repoPath);
    const host = opts.host ?? DEFAULT_HOST;
    const database = opts.database ?? DEFAULT_DATABASE;
    const connectionLimit = opts.connectionLimit ?? 5;

    this.pool = mysql.createPool({
      host,
      port,
      database,
      user: opts.user ?? 'root',
      password: opts.password ?? undefined,
      connectionLimit,
      waitForConnections: true,
      queueLimit: 0,
    });
  }

  /**
   * Ensure the pool is connected before executing queries.
   *
   * @private
   * @throws {Error} If pool is not initialized
   */
  _ensureConnected() {
    if (!this.pool) {
      throw new Error('DoltQueryService is not connected. Call connect() first.');
    }
  }

  /**
   * Get issue counts grouped by status.
   *
   * @returns {Promise<Array<{status: string, count: number}>>}
   */
  async getStatusCounts() {
    this._ensureConnected();
    const [rows] = await this.pool.execute(
      'SELECT status, COUNT(*) AS count FROM issues GROUP BY status'
    );
    return rows;
  }

  /**
   * Get open issues sorted by priority (0=urgent first).
   *
   * @returns {Promise<Array<Object>>}
   */
  async getOpenByPriority() {
    this._ensureConnected();
    const [rows] = await this.pool.execute(
      'SELECT * FROM issues WHERE status = ? ORDER BY priority ASC',
      ['open']
    );
    return rows;
  }

  /**
   * Look up a single issue by ID, including its labels.
   *
   * @param {string} id - The issue ID (e.g. 'huly-vibe-sync-abc')
   * @returns {Promise<Object|null>} The issue with a `labels` array, or null
   */
  async getIssueById(id) {
    this._ensureConnected();
    const [issues] = await this.pool.execute(
      `SELECT i.*, GROUP_CONCAT(l.label) AS labels
       FROM issues i
       LEFT JOIN labels l ON i.id = l.issue_id
       WHERE i.id = ?
       GROUP BY i.id`,
      [id]
    );
    if (issues.length === 0) {
      return null;
    }
    const issue = issues[0];
    issue.labels = issue.labels ? issue.labels.split(',') : [];
    return issue;
  }

  /**
   * Get issues filtered by status.
   *
   * @param {string} status - Status value (e.g. 'open', 'in-progress', 'closed')
   * @returns {Promise<Array<Object>>}
   */
  async getIssuesByStatus(status) {
    this._ensureConnected();
    const [rows] = await this.pool.execute(
      'SELECT * FROM issues WHERE status = ? ORDER BY updated_at DESC',
      [status]
    );
    return rows;
  }

  /**
   * Get recent changes using Dolt's diff functionality.
   *
   * @param {string} sinceCommit - Commit hash to diff from
   * @returns {Promise<Array<Object>>}
   */
  async getRecentChanges(sinceCommit) {
    this._ensureConnected();
    const [rows] = await this.pool.execute(
      "SELECT * FROM dolt_diff('issues', ?, 'HEAD')",
      [sinceCommit]
    );
    return rows;
  }

  /**
   * Get the current HEAD commit hash.
   *
   * @returns {Promise<string>} The commit hash
   */
  async getCurrentCommitHash() {
    this._ensureConnected();
    const [rows] = await this.pool.execute("SELECT dolt_hashof('HEAD') AS hash");
    return rows[0].hash;
  }

  /**
   * Get the commit log.
   *
   * @param {number} [limit=20] - Maximum number of commits to return
   * @returns {Promise<Array<Object>>}
   */
  async getCommitLog(limit = 20) {
    this._ensureConnected();
    const [rows] = await this.pool.execute(
      'SELECT * FROM dolt_log LIMIT ?',
      [limit]
    );
    return rows;
  }

  /**
   * Run a query as of a specific commit hash (Dolt time travel).
   *
   * @param {string} commitHash - The commit hash to query at
   * @param {string} sql - The SQL query to execute
   * @returns {Promise<Array<Object>>}
   */
  async queryAsOf(commitHash, sql) {
    this._ensureConnected();
    const asOfSql = `${sql} AS OF '${commitHash}'`;
    const [rows] = await this.pool.execute(asOfSql);
    return rows;
  }

  /**
   * Get recent activity from Dolt diffs by time-traveling to a past commit.
   *
   * Finds the commit closest to `hoursAgo` hours in the past (default 24h),
   * diffs the `issues` table between that commit and HEAD, and classifies
   * each change as created / updated / closed / deleted.
   *
   * @param {number} [hoursAgo=24] - How far back to look for a base commit
   * @returns {Promise<Object>} Activity data in the format expected by
   *   `buildRecentActivityFromSQL()`: `{ changes, summary, byStatus, since }`
   */
  async getRecentActivityFromDolt(hoursAgo = 24) {
    this._ensureConnected();

    // 1. Get commit log and find the commit closest to `hoursAgo` ago
    const commits = await this.getCommitLog(100);
    if (!commits || commits.length === 0) {
      return { changes: [], summary: { created: 0, updated: 0, closed: 0, deleted: 0, total: 0 }, byStatus: {}, since: null };
    }

    const cutoff = Date.now() - hoursAgo * 60 * 60 * 1000;
    let baseCommit = null;

    for (const commit of commits) {
      const commitDate = commit.date instanceof Date
        ? commit.date.getTime()
        : new Date(commit.date).getTime();
      if (commitDate <= cutoff) {
        baseCommit = commit.commit_hash;
        break;
      }
    }

    // Graceful fallback: if no commit older than cutoff, use the oldest available commit
    if (!baseCommit) {
      baseCommit = commits[commits.length - 1].commit_hash;
    }

    // 2. Diff issues table between base commit and HEAD
    const diffRows = await this.getRecentChanges(baseCommit);

    // 3. Classify each diff row
    const changes = diffRows.map(row => {
      let action;
      if (row.diff_type === 'added') {
        action = 'created';
      } else if (row.diff_type === 'removed') {
        action = 'deleted';
      } else if (row.diff_type === 'modified' && row.to_status === 'closed') {
        action = 'closed';
      } else {
        action = 'updated';
      }

      return {
        action,
        id: row.to_id || row.from_id,
        title: row.to_title || row.from_title || '',
        from_status: row.from_status || null,
        to_status: row.to_status || null,
        updated_at: row.to_updated_at || row.from_updated_at || null,
        diff_type: row.diff_type,
      };
    });

    // 4. Compute summary counts
    const summary = { created: 0, updated: 0, closed: 0, deleted: 0, total: changes.length };
    const byStatus = {};

    for (const change of changes) {
      summary[change.action] = (summary[change.action] || 0) + 1;
      const status = change.to_status || change.from_status || 'unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
    }

    const baseCommitObj = commits.find(c => c.commit_hash === baseCommit);
    const since = baseCommitObj?.date
      ? (baseCommitObj.date instanceof Date ? baseCommitObj.date.toISOString() : new Date(baseCommitObj.date).toISOString())
      : null;

    return { changes, summary, byStatus, since };
  }

  /**
   * Get combined board metrics and component stats in a single query.
   * Groups by both status and issue_type to minimize round-trips.
   *
   * @returns {Promise<Array<{status: string, issue_type: string|null, cnt: number}>>}
   */
  async getBoardAndComponentStats() {
    this._ensureConnected();
    const [rows] = await this.pool.execute(
      'SELECT status, issue_type, COUNT(*) as cnt FROM issues GROUP BY status, issue_type'
    );
    return rows;
  }

  /**
   * Get all hotspot categories in a single UNION query.
   * Returns rows tagged with hotspot_type for client-side splitting.
   *
   * @returns {Promise<Array<Object>>}
   */
  async getHotspots() {
    this._ensureConnected();
    const [rows] = await this.pool.execute(`
      SELECT id, title, status, description, updated_at, priority, 'blocked' as hotspot_type
      FROM issues
      WHERE (LOWER(title) LIKE '%blocked%'
         OR LOWER(title) LIKE '%blocker%'
         OR LOWER(title) LIKE '%waiting on%'
         OR LOWER(title) LIKE '%waiting for%'
         OR LOWER(title) LIKE '%stuck%'
         OR LOWER(description) LIKE '%blocked%'
         OR LOWER(description) LIKE '%blocker%'
         OR LOWER(description) LIKE '%waiting on%'
         OR LOWER(description) LIKE '%waiting for%'
         OR LOWER(description) LIKE '%stuck%')
        AND status != 'closed'
      LIMIT 10

      UNION ALL

      SELECT id, title, status, NULL as description, updated_at, priority, 'aging_wip' as hotspot_type
      FROM issues
      WHERE status = 'in-progress'
        AND updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY updated_at ASC
      LIMIT 10

      UNION ALL

      SELECT id, title, status, NULL as description, NULL as updated_at, priority, 'high_priority' as hotspot_type
      FROM issues
      WHERE status = 'open' AND priority <= 1
      ORDER BY priority ASC
      LIMIT 10
    `);
    return rows;
  }

  /**
   * Close the connection pool.
   *
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.repoPath = null;
  }
}

export { discoverPort };
export default DoltQueryService;
