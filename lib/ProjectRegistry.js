import fs from 'fs';
import path from 'path';
import { logger as rootLogger } from './logger.js';

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
  constructor(opts = null) {
    const db = opts?.db;
    const baseDir = opts?.baseDir;
    const parentLogger = opts?.logger;
    if (!db) throw new Error('ProjectRegistry requires a db instance');
    this.db = db;
    this.baseDir = baseDir || process.env.STACKS_DIR || '/opt/stacks';
    this.log = (parentLogger || rootLogger).child({ module: 'project-registry' });
  }

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

      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const hasGit = fs.existsSync(path.join(dirPath, '.git'));

      if (!hasGit) continue;

      results.discovered++;

      try {
        this._registerDir(dirPath, { hasGit });
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

  getProjects(filters = {}) {
    let rows = this.db.getAllProjects();

    if (filters.status) {
      rows = rows.filter(r => r.status === filters.status);
    }
    if (filters.tech_stack) {
      rows = rows.filter(r => r.tech_stack === filters.tech_stack);
    }
    if (filters.mcp_enabled !== undefined) {
      const flag = filters.mcp_enabled ? 1 : 0;
      rows = rows.filter(r => r.mcp_enabled === flag);
    }

    return rows;
  }

  getProject(identifier) {
    const project = this.db.getProject(identifier);
    if (project) return project;

    const resolved = this.db.resolveProjectIdentifier(identifier);
    if (resolved) return this.db.getProject(resolved);

    return null;
  }

  registerProject(dirPath) {
    const absPath = path.resolve(dirPath);

    if (!fs.existsSync(absPath)) {
      throw new Error(`Directory does not exist: ${absPath}`);
    }

    const hasGit = fs.existsSync(path.join(absPath, '.git'));

    this._registerDir(absPath, { hasGit });

    const folderName = path.basename(absPath);
    return this.getProjectByPath(absPath) || this.getProject(folderName);
  }

  updateProject(identifier, updates = {}) {
    const existing = this.getProject(identifier);
    if (!existing) {
      return null;
    }

    const nextUpdates = {};

    if (updates.name !== undefined) {
      nextUpdates.name = updates.name;
    }

    if (updates.filesystem_path !== undefined) {
      const absPath = path.resolve(updates.filesystem_path);
      if (!fs.existsSync(absPath)) {
        throw new Error(`Directory does not exist: ${absPath}`);
      }
      nextUpdates.filesystem_path = absPath;
    }

    if (updates.git_url !== undefined) {
      nextUpdates.git_url = updates.git_url;
    }

    if (updates.status !== undefined) {
      nextUpdates.status = updates.status;
    }

    const updated = this.db.updateProject(existing.identifier, nextUpdates);

    if (updated?.filesystem_path) {
      const techStack = this._detectTechStack(updated.filesystem_path);
      this.db.db
        .prepare(
          `
            UPDATE projects
            SET tech_stack = ?,
                updated_at = ?
            WHERE identifier = ?
          `
        )
        .run(techStack, Date.now(), updated.identifier);
    }

    return this.getProject(existing.identifier);
  }

  archiveProject(identifier) {
    return this.db.archiveProject(identifier);
  }

  unarchiveProject(identifier) {
    return this.db.unarchiveProject(identifier);
  }

  deleteProject(identifier) {
    const existing = this.getProject(identifier);
    if (!existing) {
      return false;
    }

    return this.db.deleteProject(existing.identifier);
  }

  getProjectByPath(fsPath) {
    const normalised = path.resolve(fsPath);
    const all = this.db.getAllProjects();
    return all.find(p => p.filesystem_path === normalised) || null;
  }

  _detectTechStack(dirPath) {
    for (const { file, stack } of TECH_STACK_DETECTORS) {
      if (fs.existsSync(path.join(dirPath, file))) {
        return stack;
      }
    }
    return null;
  }

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

  _registerDir(dirPath, { hasGit }) {
    const folderName = path.basename(dirPath);
    const now = Date.now();

    if (!hasGit) {
      throw new Error(`Directory is not a git repository: ${dirPath}`);
    }

    const techStack = this._detectTechStack(dirPath);
    const gitUrl = hasGit ? this._readGitUrl(dirPath) : null;

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

    const stmt = this.db.db.prepare(`
      UPDATE projects
      SET tech_stack = ?,
          last_scan_at = ?,
          mcp_enabled = COALESCE(mcp_enabled, 1)
      WHERE identifier = ?
    `);
    stmt.run(techStack, now, identifier);
  }
}
