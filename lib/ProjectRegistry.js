/**
 * ProjectRegistry — Filesystem-based project discovery and registration.
 *
 * Scans a base directory (default: /opt/stacks/) for directories that look
 * like managed projects (contain .beads/, .git/, or both).  For each
 * discovered project it auto-detects the primary tech stack from well-known
 * manifest files and upserts a record into the SQLite projects table.
 *
 * The registry is the single source of truth for "what projects live on this
 * host" and feeds the MCP project_query tool, CLI, and dashboards.
 */

import fs from 'fs';
import path from 'path';
import { logger as rootLogger } from './logger.js';

/** Map manifest file name → tech stack label. */
const TECH_STACK_DETECTORS = [
  { file: 'package.json', stack: 'node' },
  { file: 'Cargo.toml', stack: 'rust' },
  { file: 'go.mod', stack: 'go' },
  { file: 'pyproject.toml', stack: 'python' },
  { file: 'setup.py', stack: 'python' },
  { file: 'requirements.txt', stack: 'python' },
  { file: 'Gemfile', stack: 'ruby' },
  { file: 'pom.xml', stack: 'java' },
  { file: 'build.gradle', stack: 'java' },
  { file: 'mix.exs', stack: 'elixir' },
  { file: 'composer.json', stack: 'php' },
  { file: 'CMakeLists.txt', stack: 'cpp' },
  { file: 'Makefile', stack: 'make' },
  { file: 'docker-compose.yml', stack: 'docker' },
  { file: 'Dockerfile', stack: 'docker' },
];

export class ProjectRegistry {
  /**
   * @param {Object} opts
   * @param {import('./database.js').SyncDatabase} opts.db
   * @param {string} [opts.baseDir] — root directory to scan (default from config or /opt/stacks)
   * @param {import('pino').Logger} [opts.logger]
   */
  constructor({ db, baseDir, logger: parentLogger } = {}) {
    if (!db) throw new Error('ProjectRegistry requires a db instance');
    this.db = db;
    this.baseDir = baseDir || process.env.STACKS_DIR || '/opt/stacks';
    this.log = (parentLogger || rootLogger).child({ module: 'project-registry' });
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Scan baseDir for project directories, detect tech stack, count beads
   * issues, and upsert each into the projects table.
   *
   * @returns {{ discovered: number, updated: number, errors: string[] }}
   */
  scanProjects() {
    const results = { discovered: 0, updated: 0, errors: [] };

    let entries;
    try {
      entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    } catch (err) {
      this.log.error({ err, baseDir: this.baseDir }, 'Failed to read base directory');
      results.errors.push(`Cannot read ${this.baseDir}: ${err.message}`);
      return results;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dirPath = path.join(this.baseDir, entry.name);

      // Skip hidden directories and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const hasBeads = fs.existsSync(path.join(dirPath, '.beads'));
      const hasGit = fs.existsSync(path.join(dirPath, '.git'));

      if (!hasBeads && !hasGit) continue;

      results.discovered++;

      try {
        this._registerDir(dirPath, { hasBeads, hasGit });
        results.updated++;
      } catch (err) {
        const msg = `Failed to register ${dirPath}: ${err.message}`;
        this.log.warn({ err, dirPath }, msg);
        results.errors.push(msg);
      }
    }

    this.log.info(
      { discovered: results.discovered, updated: results.updated, errors: results.errors.length },
      'Project scan complete'
    );

    return results;
  }

  /**
   * Get projects from the database with optional filters.
   *
   * @param {Object} [filters]
   * @param {string} [filters.status] — e.g. 'active'
   * @param {string} [filters.tech_stack]
   * @param {boolean} [filters.has_beads] — only projects with beads_prefix set
   * @param {boolean} [filters.mcp_enabled]
   * @returns {Object[]}
   */
  getProjects(filters = {}) {
    let rows = this.db.getAllProjects();

    if (filters.status) {
      rows = rows.filter(r => r.status === filters.status);
    }
    if (filters.tech_stack) {
      rows = rows.filter(r => r.tech_stack === filters.tech_stack);
    }
    if (filters.has_beads !== undefined) {
      rows = filters.has_beads
        ? rows.filter(r => r.beads_prefix != null)
        : rows.filter(r => r.beads_prefix == null);
    }
    if (filters.mcp_enabled !== undefined) {
      const flag = filters.mcp_enabled ? 1 : 0;
      rows = rows.filter(r => r.mcp_enabled === flag);
    }

    return rows;
  }

  /**
   * Get a single project by its identifier (e.g. "HVSYN") or by folder name.
   *
   * @param {string} identifier — project identifier or folder name
   * @returns {Object|null}
   */
  getProject(identifier) {
    // Try direct lookup first
    const project = this.db.getProject(identifier);
    if (project) return project;

    // Fallback: resolve folder name → identifier
    const resolved = this.db.resolveProjectIdentifier(identifier);
    if (resolved) return this.db.getProject(resolved);

    return null;
  }

  /**
   * Manually register a project from a filesystem path.
   * Performs the same detection as scanProjects for a single directory.
   *
   * @param {string} dirPath — absolute path to the project directory
   * @returns {Object} — the upserted project row
   */
  registerProject(dirPath) {
    const absPath = path.resolve(dirPath);

    if (!fs.existsSync(absPath)) {
      throw new Error(`Directory does not exist: ${absPath}`);
    }

    const hasBeads = fs.existsSync(path.join(absPath, '.beads'));
    const hasGit = fs.existsSync(path.join(absPath, '.git'));

    this._registerDir(absPath, { hasBeads, hasGit });

    // Return the freshly-written row
    const folderName = path.basename(absPath);
    return this.getProjectByPath(absPath) || this.getProject(folderName);
  }

  /**
   * Look up a project by its filesystem_path column.
   *
   * @param {string} fsPath
   * @returns {Object|null}
   */
  getProjectByPath(fsPath) {
    const normalised = path.resolve(fsPath);
    const all = this.db.getAllProjects();
    return all.find(p => p.filesystem_path === normalised) || null;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Detect the primary tech stack from well-known manifest files.
   * @param {string} dirPath
   * @returns {string|null}
   */
  _detectTechStack(dirPath) {
    for (const { file, stack } of TECH_STACK_DETECTORS) {
      if (fs.existsSync(path.join(dirPath, file))) {
        return stack;
      }
    }
    return null;
  }

  /**
   * Read beads prefix from .beads/config.json (if it exists).
   * @param {string} dirPath
   * @returns {string|null}
   */
  _readBeadsPrefix(dirPath) {
    const configPath = path.join(dirPath, '.beads', 'config.json');
    try {
      if (!fs.existsSync(configPath)) return null;
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return data.prefix || data.project_prefix || null;
    } catch {
      return null;
    }
  }

  /**
   * Count beads issues (by listing .beads/issues/*.json or similar).
   * Falls back to 0 if anything goes wrong.
   * @param {string} dirPath
   * @returns {number}
   */
  _countBeadsIssues(dirPath) {
    const issuesDir = path.join(dirPath, '.beads', 'issues');
    try {
      if (!fs.existsSync(issuesDir)) return 0;
      const entries = fs.readdirSync(issuesDir);
      return entries.filter(e => e.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  /**
   * Read git remote URL from .git/config (quick regex, no spawning git).
   * @param {string} dirPath
   * @returns {string|null}
   */
  _readGitUrl(dirPath) {
    const gitConfigPath = path.join(dirPath, '.git', 'config');
    try {
      if (!fs.existsSync(gitConfigPath)) return null;
      const content = fs.readFileSync(gitConfigPath, 'utf8');
      const match = content.match(/url\s*=\s*(.+)/);
      return match ? match[1].trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Upsert a directory into the projects table.
   * @param {string} dirPath
   * @param {{ hasBeads: boolean, hasGit: boolean }} flags
   */
  _registerDir(dirPath, { hasBeads, hasGit }) {
    const folderName = path.basename(dirPath);
    const now = Date.now();

    const techStack = this._detectTechStack(dirPath);
    const beadsPrefix = hasBeads ? this._readBeadsPrefix(dirPath) : null;
    const beadsIssueCount = hasBeads ? this._countBeadsIssues(dirPath) : 0;
    const gitUrl = hasGit ? this._readGitUrl(dirPath) : null;

    // Look up existing project by filesystem_path to preserve its identifier
    const existing = this.getProjectByPath(dirPath);
    const identifier = existing?.identifier || folderName;

    this.db.upsertProject({
      identifier,
      name: existing?.name || folderName,
      filesystem_path: dirPath,
      git_url: gitUrl,
      status: 'active',
      last_checked_at: now,
    });

    // Use raw SQL for the new registry columns to avoid touching the
    // existing upsertProject contract which other callers depend on.
    const stmt = this.db.db.prepare(`
      UPDATE projects
      SET tech_stack = ?,
          beads_prefix = COALESCE(?, beads_prefix),
          beads_issue_count = ?,
          last_scan_at = ?,
          mcp_enabled = COALESCE(mcp_enabled, 1)
      WHERE identifier = ?
    `);
    stmt.run(techStack, beadsPrefix, beadsIssueCount, now, identifier);
  }
}
