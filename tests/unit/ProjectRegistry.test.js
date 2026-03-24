import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectRegistry } from '../../lib/ProjectRegistry.js';
import { SyncDatabase } from '../../lib/database.js';
import fs from 'fs';
import path from 'path';

describe('ProjectRegistry', () => {
  let db;
  let testDbPath;
  let testStacksDir;

  beforeEach(() => {
    testDbPath = path.join(process.env.DB_PATH.replace('.db', `-registry-${Date.now()}.db`));
    db = new SyncDatabase(testDbPath);
    db.initialize();

    testStacksDir = path.join(process.env.STACKS_DIR, `reg-${Date.now()}`);
    fs.mkdirSync(testStacksDir, { recursive: true });
  });

  afterEach(() => {
    if (db.db) db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    ['-wal', '-shm'].forEach(suffix => {
      const file = testDbPath + suffix;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
    if (fs.existsSync(testStacksDir)) {
      fs.rmSync(testStacksDir, { recursive: true, force: true });
    }
  });

  function createDir(name, { git = false, beads = false, files = [] } = {}) {
    const dirPath = path.join(testStacksDir, name);
    fs.mkdirSync(dirPath, { recursive: true });
    if (git) fs.mkdirSync(path.join(dirPath, '.git'), { recursive: true });
    if (beads) {
      fs.mkdirSync(path.join(dirPath, '.beads', 'issues'), { recursive: true });
    }
    for (const f of files) {
      const filePath = path.join(dirPath, f.name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, f.content || '');
    }
    return dirPath;
  }

  describe('constructor', () => {
    it('should throw when db is not provided', () => {
      expect(() => new ProjectRegistry({})).toThrow('requires a db instance');
    });

    it('should use provided baseDir', () => {
      const registry = new ProjectRegistry({ db, baseDir: '/custom/dir' });
      expect(registry.baseDir).toBe('/custom/dir');
    });

    it('should default to STACKS_DIR env or /opt/stacks', () => {
      const original = process.env.STACKS_DIR;
      process.env.STACKS_DIR = '/test/stacks';
      const registry = new ProjectRegistry({ db });
      expect(registry.baseDir).toBe('/test/stacks');
      process.env.STACKS_DIR = original;
    });
  });

  describe('scanProjects', () => {
    it('should discover directories with .git', () => {
      createDir('my-git-project', { git: true });
      createDir('plain-dir');

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const result = registry.scanProjects();

      expect(result.discovered).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should discover directories with .beads', () => {
      createDir('my-beads-project', { beads: true });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const result = registry.scanProjects();

      expect(result.discovered).toBe(1);
      expect(result.updated).toBe(1);
    });

    it('should discover directories with both .git and .beads', () => {
      createDir('full-project', { git: true, beads: true });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const result = registry.scanProjects();

      expect(result.discovered).toBe(1);
      expect(result.updated).toBe(1);
    });

    it('should skip directories without .git or .beads', () => {
      createDir('no-markers');

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const result = registry.scanProjects();

      expect(result.discovered).toBe(0);
    });

    it('should skip hidden directories', () => {
      createDir('.hidden-project', { git: true });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const result = registry.scanProjects();

      expect(result.discovered).toBe(0);
    });

    it('should skip node_modules', () => {
      createDir('node_modules', { git: true });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const result = registry.scanProjects();

      expect(result.discovered).toBe(0);
    });

    it('should handle non-existent baseDir gracefully', () => {
      const registry = new ProjectRegistry({ db, baseDir: '/nonexistent/path' });
      const result = registry.scanProjects();

      expect(result.discovered).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Cannot read');
    });

    it('should discover multiple projects', () => {
      createDir('project-a', { git: true });
      createDir('project-b', { beads: true });
      createDir('project-c', { git: true, beads: true });
      createDir('not-a-project');

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const result = registry.scanProjects();

      expect(result.discovered).toBe(3);
      expect(result.updated).toBe(3);
    });

    it('should upsert projects into the database', () => {
      createDir('db-test-project', { git: true });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('db-test-project');
      expect(project).toBeTruthy();
      expect(project.filesystem_path).toBe(path.join(testStacksDir, 'db-test-project'));
      expect(project.status).toBe('active');
    });

    it('should preserve existing project identifiers on rescan', () => {
      const dirPath = createDir('existing-proj', { git: true });
      db.upsertProject({
        identifier: 'EXIST',
        name: 'Existing Project',
        filesystem_path: dirPath,
      });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('EXIST');
      expect(project).toBeTruthy();
      expect(project.name).toBe('Existing Project');
    });
  });

  describe('tech stack detection', () => {
    it('should detect node from package.json', () => {
      createDir('node-proj', { git: true, files: [{ name: 'package.json', content: '{}' }] });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('node-proj');
      expect(project.tech_stack).toBe('node');
    });

    it('should detect rust from Cargo.toml', () => {
      createDir('rust-proj', { git: true, files: [{ name: 'Cargo.toml', content: '' }] });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('rust-proj');
      expect(project.tech_stack).toBe('rust');
    });

    it('should detect go from go.mod', () => {
      createDir('go-proj', { git: true, files: [{ name: 'go.mod', content: '' }] });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('go-proj');
      expect(project.tech_stack).toBe('go');
    });

    it('should detect python from pyproject.toml', () => {
      createDir('py-proj', { git: true, files: [{ name: 'pyproject.toml', content: '' }] });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('py-proj');
      expect(project.tech_stack).toBe('python');
    });

    it('should detect python from requirements.txt', () => {
      createDir('py-proj2', { git: true, files: [{ name: 'requirements.txt', content: '' }] });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('py-proj2');
      expect(project.tech_stack).toBe('python');
    });

    it('should detect java from pom.xml', () => {
      createDir('java-proj', { git: true, files: [{ name: 'pom.xml', content: '' }] });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('java-proj');
      expect(project.tech_stack).toBe('java');
    });

    it('should detect docker from docker-compose.yml', () => {
      createDir('docker-proj', { git: true, files: [{ name: 'docker-compose.yml', content: '' }] });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('docker-proj');
      expect(project.tech_stack).toBe('docker');
    });

    it('should return null for unknown tech stack', () => {
      createDir('mystery-proj', { git: true });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('mystery-proj');
      expect(project.tech_stack).toBeNull();
    });

    it('should use first matching detector (priority order)', () => {
      createDir('multi-proj', {
        git: true,
        files: [
          { name: 'package.json', content: '{}' },
          { name: 'Cargo.toml', content: '' },
        ],
      });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('multi-proj');
      expect(project.tech_stack).toBe('node');
    });
  });

  describe('beads detection', () => {
    it('should count beads issues', () => {
      createDir('beads-proj', {
        beads: true,
        files: [
          { name: '.beads/issues/issue-1.json', content: '{}' },
          { name: '.beads/issues/issue-2.json', content: '{}' },
          { name: '.beads/issues/issue-3.json', content: '{}' },
        ],
      });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('beads-proj');
      expect(project.beads_issue_count).toBe(3);
    });

    it('should read beads prefix from config.json', () => {
      createDir('prefixed-proj', {
        beads: true,
        files: [{ name: '.beads/config.json', content: JSON.stringify({ prefix: 'PFXD' }) }],
      });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('prefixed-proj');
      expect(project.beads_prefix).toBe('PFXD');
    });

    it('should handle missing beads config gracefully', () => {
      createDir('no-config-proj', { beads: true });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('no-config-proj');
      expect(project.beads_prefix).toBeNull();
    });

    it('should set beads_issue_count to 0 for non-beads projects', () => {
      createDir('git-only', { git: true });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('git-only');
      expect(project.beads_issue_count).toBe(0);
    });
  });

  describe('git URL detection', () => {
    it('should read git remote URL', () => {
      const dirPath = createDir('git-url-proj', { git: true });
      const gitConfig = `[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = https://github.com/test/repo.git
\tfetch = +refs/heads/*:refs/remotes/origin/*`;
      fs.writeFileSync(path.join(dirPath, '.git', 'config'), gitConfig);

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('git-url-proj');
      expect(project.git_url).toBe('https://github.com/test/repo.git');
    });

    it('should handle missing git config', () => {
      createDir('no-git-config', { git: true });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('no-git-config');
      expect(project.git_url).toBeNull();
    });
  });

  describe('getProjects', () => {
    beforeEach(() => {
      createDir('proj-a', {
        git: true,
        beads: true,
        files: [
          { name: 'package.json', content: '{}' },
          { name: '.beads/config.json', content: JSON.stringify({ prefix: 'PA' }) },
        ],
      });
      createDir('proj-b', {
        git: true,
        files: [{ name: 'Cargo.toml', content: '' }],
      });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();
    });

    it('should return all projects without filters', () => {
      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const projects = registry.getProjects();

      expect(projects.length).toBe(2);
    });

    it('should filter by tech_stack', () => {
      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const nodeProjects = registry.getProjects({ tech_stack: 'node' });

      expect(nodeProjects.length).toBe(1);
      expect(nodeProjects[0].tech_stack).toBe('node');
    });

    it('should filter by has_beads', () => {
      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const beadsProjects = registry.getProjects({ has_beads: true });

      expect(beadsProjects.length).toBe(1);
      expect(beadsProjects[0].beads_prefix).toBe('PA');
    });

    it('should filter by status', () => {
      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const activeProjects = registry.getProjects({ status: 'active' });

      expect(activeProjects.length).toBe(2);
    });
  });

  describe('getProject', () => {
    it('should find project by identifier', () => {
      const dirPath = createDir('find-me', { git: true });
      db.upsertProject({
        identifier: 'FIND',
        name: 'Find Me',
        filesystem_path: dirPath,
      });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const project = registry.getProject('FIND');

      expect(project).toBeTruthy();
      expect(project.identifier).toBe('FIND');
    });

    it('should find project by folder name via resolveProjectIdentifier', () => {
      const dirPath = createDir('my-folder', { git: true });
      db.upsertProject({
        identifier: 'MYFLD',
        name: 'My Folder',
        filesystem_path: dirPath,
      });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const project = registry.getProject('my-folder');

      expect(project).toBeTruthy();
      expect(project.identifier).toBe('MYFLD');
    });

    it('should return null for unknown identifier', () => {
      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const project = registry.getProject('NONEXISTENT');

      expect(project).toBeNull();
    });
  });

  describe('registerProject', () => {
    it('should register a single project by path', () => {
      const dirPath = createDir('manual-reg', {
        git: true,
        files: [{ name: 'package.json', content: '{}' }],
      });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const project = registry.registerProject(dirPath);

      expect(project).toBeTruthy();
      expect(project.filesystem_path).toBe(dirPath);
      expect(project.tech_stack).toBe('node');
    });

    it('should throw for non-existent directory', () => {
      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });

      expect(() => registry.registerProject('/nonexistent/dir')).toThrow('does not exist');
    });

    it('should work for directory without .git or .beads', () => {
      const dirPath = createDir('plain-reg');

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const project = registry.registerProject(dirPath);

      expect(project).toBeTruthy();
      expect(project.filesystem_path).toBe(dirPath);
    });
  });

  describe('getProjectByPath', () => {
    it('should find project by filesystem path', () => {
      const dirPath = createDir('path-lookup', { git: true });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = registry.getProjectByPath(dirPath);
      expect(project).toBeTruthy();
      expect(project.filesystem_path).toBe(dirPath);
    });

    it('should return null for unregistered path', () => {
      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      const project = registry.getProjectByPath('/unknown/path');

      expect(project).toBeNull();
    });
  });

  describe('last_scan_at and mcp_enabled', () => {
    it('should set last_scan_at on scan', () => {
      createDir('scan-time', { git: true });

      const before = Date.now();
      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();
      const after = Date.now();

      const project = db.getProject('scan-time');
      expect(project.last_scan_at).toBeGreaterThanOrEqual(before);
      expect(project.last_scan_at).toBeLessThanOrEqual(after);
    });

    it('should default mcp_enabled to 1', () => {
      createDir('mcp-default', { git: true });

      const registry = new ProjectRegistry({ db, baseDir: testStacksDir });
      registry.scanProjects();

      const project = db.getProject('mcp-default');
      expect(project.mcp_enabled).toBe(1);
    });
  });
});
