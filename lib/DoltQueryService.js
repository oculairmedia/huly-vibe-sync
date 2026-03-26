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
      user: opts.user ?? undefined,
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
