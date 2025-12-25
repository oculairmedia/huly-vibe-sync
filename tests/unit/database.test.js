/**
 * Unit Tests for Database Module
 * 
 * Tests SQLite database operations for sync state management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncDatabase } from '../../lib/database.js';
import fs from 'fs';
import path from 'path';

describe('SyncDatabase', () => {
  let db;
  let testDbPath;

  beforeEach(() => {
    // Create unique test database for each test
    testDbPath = path.join(process.env.DB_PATH.replace('.db', `-${Date.now()}.db`));
    db = new SyncDatabase(testDbPath);
    db.initialize();
  });

  afterEach(() => {
    // Clean up test database
    if (db.db) {
      db.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    // Clean up WAL and SHM files
    ['-wal', '-shm'].forEach(suffix => {
      const file = testDbPath + suffix;
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  describe('initialization', () => {
    it('should create database file', () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should create all required tables', () => {
      const tables = db.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all();
      
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('sync_metadata');
      expect(tableNames).toContain('projects');
      expect(tableNames).toContain('issues');
      expect(tableNames).toContain('sync_history');
    });

    it('should create indexes', () => {
      const indexes = db.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index'"
      ).all();
      
      const indexNames = indexes.map(i => i.name);
      expect(indexNames.length).toBeGreaterThan(0);
      expect(indexNames).toContain('idx_projects_last_sync');
      expect(indexNames).toContain('idx_issues_project');
    });

    it('should enable WAL mode', () => {
      const journalMode = db.db.pragma('journal_mode', { simple: true });
      expect(journalMode).toBe('wal');
    });

    it('should enable foreign keys', () => {
      const foreignKeys = db.db.pragma('foreign_keys', { simple: true });
      expect(foreignKeys).toBe(1);
    });
  });

  describe('metadata operations', () => {
    describe('getLastSync', () => {
      it('should return null when no sync has occurred', () => {
        const lastSync = db.getLastSync();
        expect(lastSync).toBeNull();
      });

      it('should return last sync timestamp after setting', () => {
        const timestamp = Date.now();
        db.setLastSync(timestamp);
        
        const lastSync = db.getLastSync();
        expect(lastSync).toBe(timestamp);
      });
    });

    describe('setLastSync', () => {
      it('should store sync timestamp', () => {
        const timestamp = 1234567890;
        db.setLastSync(timestamp);
        
        const lastSync = db.getLastSync();
        expect(lastSync).toBe(timestamp);
      });

      it('should update existing timestamp', () => {
        db.setLastSync(1000);
        db.setLastSync(2000);
        
        const lastSync = db.getLastSync();
        expect(lastSync).toBe(2000);
      });
    });
  });

  describe('project operations', () => {
    describe('computeDescriptionHash', () => {
      it('should compute hash for valid description', () => {
        const hash = SyncDatabase.computeDescriptionHash('Test description');
        expect(hash).toBeTruthy();
        expect(hash).toHaveLength(16); // SHA256 substring
      });

      it('should return null for empty description', () => {
        expect(SyncDatabase.computeDescriptionHash('')).toBeNull();
        expect(SyncDatabase.computeDescriptionHash(null)).toBeNull();
        expect(SyncDatabase.computeDescriptionHash(undefined)).toBeNull();
      });

      it('should produce consistent hashes', () => {
        const hash1 = SyncDatabase.computeDescriptionHash('Test');
        const hash2 = SyncDatabase.computeDescriptionHash('Test');
        expect(hash1).toBe(hash2);
      });

      it('should produce different hashes for different content', () => {
        const hash1 = SyncDatabase.computeDescriptionHash('Test A');
        const hash2 = SyncDatabase.computeDescriptionHash('Test B');
        expect(hash1).not.toBe(hash2);
      });
    });

    describe('upsertProject', () => {
      it('should insert new project', () => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Test Project',
          huly_id: 'huly-123',
          vibe_id: 456,
        });

        const project = db.getProject('TEST');
        expect(project).toBeTruthy();
        expect(project.identifier).toBe('TEST');
        expect(project.name).toBe('Test Project');
        expect(project.huly_id).toBe('huly-123');
        expect(project.vibe_id).toBe(456);
      });

      it('should update existing project', () => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Original Name',
        });

        db.upsertProject({
          identifier: 'TEST',
          name: 'Updated Name',
        });

        const project = db.getProject('TEST');
        expect(project.name).toBe('Updated Name');
      });

      it('should set default values', () => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Test Project',
        });

        const project = db.getProject('TEST');
        expect(project.issue_count).toBe(0);
        expect(project.status).toBe('active');
        expect(project.created_at).toBeTruthy();
        expect(project.updated_at).toBeTruthy();
      });

      it('should preserve null values correctly', () => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Test',
          filesystem_path: '/path/to/repo',
        });

        // Update without filesystem_path (should preserve it)
        db.upsertProject({
          identifier: 'TEST',
          name: 'Test Updated',
        });

        const project = db.getProject('TEST');
        expect(project.filesystem_path).toBe('/path/to/repo');
      });
    });

    describe('getProject', () => {
      it('should retrieve project by identifier', () => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Test Project',
        });

        const project = db.getProject('TEST');
        expect(project.identifier).toBe('TEST');
      });

      it('should return undefined for non-existent project', () => {
        const project = db.getProject('NONEXISTENT');
        expect(project).toBeUndefined();
      });
    });

    describe('getAllProjects', () => {
      it('should return empty array when no projects', () => {
        const projects = db.getAllProjects();
        expect(projects).toEqual([]);
      });

      it('should return all projects ordered by name', () => {
        db.upsertProject({ identifier: 'C', name: 'Charlie' });
        db.upsertProject({ identifier: 'A', name: 'Alpha' });
        db.upsertProject({ identifier: 'B', name: 'Bravo' });

        const projects = db.getAllProjects();
        expect(projects).toHaveLength(3);
        expect(projects[0].name).toBe('Alpha');
        expect(projects[1].name).toBe('Bravo');
        expect(projects[2].name).toBe('Charlie');
      });
    });

    describe('getProjectsToSync', () => {
      it('should return projects with issues', () => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Test',
          issue_count: 5,
          last_checked_at: Date.now() - 600000, // 10 minutes ago
        });

        const projects = db.getProjectsToSync(300000); // 5 minute cache
        expect(projects).toHaveLength(1);
        expect(projects[0].identifier).toBe('TEST');
      });

      it('should not return recently checked empty projects', () => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Test',
          issue_count: 0,
          last_checked_at: Date.now(), // Just checked
        });

        const projects = db.getProjectsToSync(300000);
        expect(projects).toHaveLength(0);
      });

      it('should return old empty projects past cache expiry', () => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Test',
          issue_count: 0,
          last_checked_at: Date.now() - 600000, // 10 minutes ago
        });

        const projects = db.getProjectsToSync(300000); // 5 minute cache
        expect(projects).toHaveLength(1);
      });

      it('should return projects with changed descriptions', () => {
        const oldHash = SyncDatabase.computeDescriptionHash('Old description');
        const newHash = SyncDatabase.computeDescriptionHash('New description');

        db.upsertProject({
          identifier: 'TEST',
          name: 'Test',
          issue_count: 0,
          last_checked_at: Date.now(), // Recently checked
          description_hash: oldHash,
        });

        const projects = db.getProjectsToSync(300000, {
          'TEST': newHash, // Description changed
        });
        
        expect(projects).toHaveLength(1);
      });

      it('should return projects without description hash', () => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Test',
          issue_count: 0,
          last_checked_at: Date.now(),
          description_hash: null,
        });

        const projects = db.getProjectsToSync(300000, {
          'TEST': 'some-hash',
        });
        
        expect(projects).toHaveLength(1);
      });

      it('should filter inactive projects', () => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Test',
          issue_count: 5,
          status: 'archived',
        });

        const projects = db.getProjectsToSync();
        expect(projects).toHaveLength(0);
      });
    });

    describe('getActiveProjects', () => {
      it('should return only projects with issues', () => {
        db.upsertProject({ identifier: 'A', name: 'A', issue_count: 0 });
        db.upsertProject({ identifier: 'B', name: 'B', issue_count: 5 });
        db.upsertProject({ identifier: 'C', name: 'C', issue_count: 10 });

        const projects = db.getActiveProjects();
        expect(projects).toHaveLength(2);
        expect(projects[0].issue_count).toBe(10); // Ordered DESC
        expect(projects[1].issue_count).toBe(5);
      });
    });

    describe('updateProjectActivity', () => {
      it('should update issue count and timestamp', () => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Test',
          issue_count: 0,
        });

        db.updateProjectActivity('TEST', 10);

        const project = db.getProject('TEST');
        expect(project.issue_count).toBe(10);
        expect(project.last_sync_at).toBeTruthy();
      });
    });
  });

  describe('issue operations', () => {
    beforeEach(() => {
      // Create a project for issues to reference
      db.upsertProject({
        identifier: 'TEST',
        name: 'Test Project',
      });
    });

    describe('upsertIssue', () => {
      it('should insert new issue', () => {
        db.upsertIssue({
          identifier: 'TEST-1',
          project_identifier: 'TEST',
          title: 'Test Issue',
          huly_id: 'huly-123',
          vibe_task_id: 456,
          status: 'todo',
          priority: 'high',
        });

        const issue = db.getIssue('TEST-1');
        expect(issue).toBeTruthy();
        expect(issue.identifier).toBe('TEST-1');
        expect(issue.title).toBe('Test Issue');
      });

      it('should update existing issue', () => {
        db.upsertIssue({
          identifier: 'TEST-1',
          project_identifier: 'TEST',
          title: 'Original Title',
        });

        db.upsertIssue({
          identifier: 'TEST-1',
          project_identifier: 'TEST',
          title: 'Updated Title',
        });

        const issue = db.getIssue('TEST-1');
        expect(issue.title).toBe('Updated Title');
      });

      it('should set timestamps', () => {
        db.upsertIssue({
          identifier: 'TEST-1',
          project_identifier: 'TEST',
          title: 'Test',
        });

        const issue = db.getIssue('TEST-1');
        expect(issue.created_at).toBeTruthy();
        expect(issue.updated_at).toBeTruthy();
      });
    });

    describe('getIssue', () => {
      it('should retrieve issue by identifier', () => {
        db.upsertIssue({
          identifier: 'TEST-1',
          project_identifier: 'TEST',
          title: 'Test Issue',
        });

        const issue = db.getIssue('TEST-1');
        expect(issue.identifier).toBe('TEST-1');
      });

      it('should return undefined for non-existent issue', () => {
        const issue = db.getIssue('NONEXISTENT-1');
        expect(issue).toBeUndefined();
      });
    });

    describe('getProjectIssues', () => {
      it('should return all issues for project', () => {
        db.upsertIssue({
          identifier: 'TEST-1',
          project_identifier: 'TEST',
          title: 'Issue 1',
        });
        db.upsertIssue({
          identifier: 'TEST-2',
          project_identifier: 'TEST',
          title: 'Issue 2',
        });

        const issues = db.getProjectIssues('TEST');
        expect(issues).toHaveLength(2);
      });

      it('should return empty array for project with no issues', () => {
        const issues = db.getProjectIssues('TEST');
        expect(issues).toEqual([]);
      });

      it('should not return issues from other projects', () => {
        db.upsertProject({ identifier: 'OTHER', name: 'Other' });
        
        db.upsertIssue({
          identifier: 'OTHER-1',
          project_identifier: 'OTHER',
          title: 'Other Issue',
        });

        const issues = db.getProjectIssues('TEST');
        expect(issues).toHaveLength(0);
      });
    });

    describe('getModifiedIssues', () => {
      it('should return issues modified after timestamp', () => {
        const cutoffTime = Date.now();
        
        // Create an old issue and manually set its last_sync_at
        db.upsertIssue({
          identifier: 'TEST-1',
          project_identifier: 'TEST',
          title: 'Old Issue',
        });

        // Force old timestamp
        db.db.prepare(
          'UPDATE issues SET last_sync_at = ? WHERE identifier = ?'
        ).run(cutoffTime - 10000, 'TEST-1');

        // Wait a moment to ensure different timestamp
        const waitMs = 10;
        const endTime = Date.now() + waitMs;
        while (Date.now() < endTime) {}

        // Create new issue (will have current last_sync_at)
        db.upsertIssue({
          identifier: 'TEST-2',
          project_identifier: 'TEST',
          title: 'New Issue',
        });

        const modified = db.getModifiedIssues('TEST', cutoffTime);
        expect(modified.length).toBeGreaterThanOrEqual(1);
        expect(modified.some(i => i.identifier === 'TEST-2')).toBe(true);
      });
    });
  });

  describe('sync history', () => {
    describe('startSyncRun', () => {
      it('should create sync record', () => {
        const syncId = db.startSyncRun();
        expect(syncId).toBeGreaterThan(0);
        
        const syncs = db.getRecentSyncs(1);
        expect(syncs).toHaveLength(1);
        expect(syncs[0].id).toBe(syncId);
      });
    });

    describe('completeSyncRun', () => {
      it('should update sync record with results', () => {
        const syncId = db.startSyncRun();
        
        db.completeSyncRun(syncId, {
          projectsProcessed: 5,
          projectsFailed: 1,
          issuesSynced: 20,
          errors: ['Error 1'],
          durationMs: 1234,
        });

        const syncs = db.getRecentSyncs(1);
        expect(syncs[0].projects_processed).toBe(5);
        expect(syncs[0].projects_failed).toBe(1);
        expect(syncs[0].issues_synced).toBe(20);
        expect(syncs[0].duration_ms).toBe(1234);
      });
    });

    describe('getRecentSyncs', () => {
      it('should return recent syncs in descending order', () => {
        db.startSyncRun();
        db.startSyncRun();
        db.startSyncRun();

        const syncs = db.getRecentSyncs(2);
        expect(syncs).toHaveLength(2);
        expect(syncs[0].id).toBeGreaterThan(syncs[1].id);
      });
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      db.upsertProject({ identifier: 'A', name: 'A', issue_count: 0 });
      db.upsertProject({ identifier: 'B', name: 'B', issue_count: 5 });
      
      db.upsertIssue({
        identifier: 'B-1',
        project_identifier: 'B',
        title: 'Issue 1',
      });
      db.upsertIssue({
        identifier: 'B-2',
        project_identifier: 'B',
        title: 'Issue 2',
      });
      
      db.setLastSync(Date.now());
    });

    describe('getStats', () => {
      it('should return database statistics', () => {
        const stats = db.getStats();
        
        expect(stats.totalProjects).toBe(2);
        expect(stats.activeProjects).toBe(1); // Only B has issues
        expect(stats.emptyProjects).toBe(1); // A has no issues
        expect(stats.totalIssues).toBe(2);
        expect(stats.lastSync).toBeTruthy();
      });
    });

    describe('getProjectSummary', () => {
      it('should return project summary with all projects', () => {
        const summary = db.getProjectSummary();
        
        expect(Array.isArray(summary)).toBe(true);
        expect(summary).toHaveLength(2);
        expect(summary[0].identifier).toBe('B'); // Sorted by issue_count DESC
        expect(summary[0].issue_count).toBe(5);
        expect(summary[1].identifier).toBe('A');
        expect(summary[1].issue_count).toBe(0);
      });
    });
  });

  describe('Letta integration', () => {
    beforeEach(() => {
      db.upsertProject({
        identifier: 'TEST',
        name: 'Test Project',
      });
    });

    describe('getProjectLettaInfo', () => {
      it('should return Letta info for project', () => {
        db.setProjectLettaAgent('TEST', {
          agentId: 'agent-123',
          folderId: 'folder-123',
          sourceId: 'source-123',
        });

        const info = db.getProjectLettaInfo('TEST');
        expect(info.letta_agent_id).toBe('agent-123');
        expect(info.letta_folder_id).toBe('folder-123');
        expect(info.letta_source_id).toBe('source-123');
      });

      it('should return null values for project without Letta', () => {
        const info = db.getProjectLettaInfo('TEST');
        expect(info.letta_agent_id).toBeNull();
      });
    });

    describe('setProjectLettaAgent', () => {
      it('should store Letta agent info', () => {
        db.setProjectLettaAgent('TEST', {
          agentId: 'agent-123',
          folderId: 'folder-123',
          sourceId: 'source-123',
        });

        const project = db.getProject('TEST');
        expect(project.letta_agent_id).toBe('agent-123');
        expect(project.letta_folder_id).toBe('folder-123');
        expect(project.letta_source_id).toBe('source-123');
      });
    });

    describe('setProjectLettaFolderId', () => {
      it('should store folder ID', () => {
        db.setProjectLettaFolderId('TEST', 'folder-123');

        const project = db.getProject('TEST');
        expect(project.letta_folder_id).toBe('folder-123');
      });
    });

    describe('setProjectLettaSourceId', () => {
      it('should store source ID', () => {
        db.setProjectLettaSourceId('TEST', 'source-123');

        const project = db.getProject('TEST');
        expect(project.letta_source_id).toBe('source-123');
      });
    });
  });

  describe('database cleanup', () => {
    describe('close', () => {
      it('should close database connection', () => {
        expect(() => db.close()).not.toThrow();
      });

      it('should prevent operations after close', () => {
        db.close();
        expect(() => db.getAllProjects()).toThrow();
      });
    });
  });

  describe('Beads integration', () => {
    beforeEach(() => {
      // Create a project for issues to reference
      db.upsertProject({
        identifier: 'BEADS',
        name: 'Beads Test Project',
      });
    });

    describe('beads_issue_id column', () => {
      it('should store beads_issue_id when upserting issue', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue with Beads ID',
          beads_issue_id: 'project-abc123',
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_issue_id).toBe('project-abc123');
      });

      it('should preserve beads_issue_id when updating other fields', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Original',
          beads_issue_id: 'project-abc123',
        });

        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Updated Title',
          // beads_issue_id not provided
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.title).toBe('Updated Title');
        expect(issue.beads_issue_id).toBe('project-abc123');
      });

      it('should allow null beads_issue_id', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue without Beads',
          beads_issue_id: null,
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_issue_id).toBeNull();
      });

      it('should update beads_issue_id when provided', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue',
          beads_issue_id: 'project-old',
        });

        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue',
          beads_issue_id: 'project-new',
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_issue_id).toBe('project-new');
      });
    });

    describe('beads_status column', () => {
      it('should store beads_status when upserting issue', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Open Issue',
          beads_status: 'open',
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_status).toBe('open');
      });

      it('should store closed status', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Closed Issue',
          beads_status: 'closed',
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_status).toBe('closed');
      });

      it('should preserve beads_status when updating other fields', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Original',
          beads_status: 'open',
        });

        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Updated Title',
          // beads_status not provided
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_status).toBe('open');
      });

      it('should update beads_status when provided', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue',
          beads_status: 'open',
        });

        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue',
          beads_status: 'closed',
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_status).toBe('closed');
      });
    });

    describe('beads_modified_at column', () => {
      it('should store beads_modified_at timestamp', () => {
        const timestamp = Date.now();
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue',
          beads_modified_at: timestamp,
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_modified_at).toBe(timestamp);
      });

      it('should allow null beads_modified_at', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue',
          beads_modified_at: null,
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_modified_at).toBeNull();
      });

      it('should preserve beads_modified_at when updating other fields', () => {
        const timestamp = 1234567890;
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Original',
          beads_modified_at: timestamp,
        });

        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Updated Title',
          // beads_modified_at not provided
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_modified_at).toBe(timestamp);
      });

      it('should update beads_modified_at when provided', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue',
          beads_modified_at: 1000,
        });

        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue',
          beads_modified_at: 2000,
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_modified_at).toBe(2000);
      });
    });

    describe('combined Beads fields', () => {
      it('should store all Beads fields together', () => {
        const timestamp = Date.now();
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Full Beads Issue',
          beads_issue_id: 'project-full',
          beads_status: 'open',
          beads_modified_at: timestamp,
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.beads_issue_id).toBe('project-full');
        expect(issue.beads_status).toBe('open');
        expect(issue.beads_modified_at).toBe(timestamp);
      });

      it('should work alongside Huly and Vibe fields', () => {
        const timestamp = Date.now();
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Multi-system Issue',
          // Huly fields
          huly_id: 'huly-123',
          status: 'In Progress',
          priority: 'High',
          huly_modified_at: timestamp - 1000,
          // Vibe fields
          vibe_task_id: 456,
          vibe_status: 'in_progress',
          vibe_modified_at: timestamp - 500,
          // Beads fields
          beads_issue_id: 'project-abc',
          beads_status: 'open',
          beads_modified_at: timestamp,
        });

        const issue = db.getIssue('BEADS-1');
        // Verify all systems' data is stored
        expect(issue.huly_id).toBe('huly-123');
        expect(issue.vibe_task_id).toBe(456);
        expect(issue.beads_issue_id).toBe('project-abc');
      });

      it('should handle partial Beads updates correctly', () => {
        // First insert with all fields
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue',
          beads_issue_id: 'project-abc',
          beads_status: 'open',
          beads_modified_at: 1000,
        });

        // Update with beads_status change (title must be re-provided as upsert overwrites it)
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue', // must include to preserve
          beads_status: 'closed',
          beads_modified_at: 2000,
        });

        const issue = db.getIssue('BEADS-1');
        expect(issue.title).toBe('Issue'); // preserved by re-providing
        expect(issue.beads_issue_id).toBe('project-abc'); // preserved via COALESCE
        expect(issue.beads_status).toBe('closed'); // updated
        expect(issue.beads_modified_at).toBe(2000); // updated
      });
    });

    describe('getAllIssues for Beads sync', () => {
      it('should return all issues including Beads fields', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Issue 1',
          beads_issue_id: 'project-1',
          beads_status: 'open',
        });
        db.upsertIssue({
          identifier: 'BEADS-2',
          project_identifier: 'BEADS',
          title: 'Issue 2',
          beads_issue_id: 'project-2',
          beads_status: 'closed',
        });

        const issues = db.getAllIssues();
        expect(issues.length).toBeGreaterThanOrEqual(2);
        
        const beadsIssues = issues.filter(i => i.project_identifier === 'BEADS');
        expect(beadsIssues).toHaveLength(2);
        expect(beadsIssues.find(i => i.beads_issue_id === 'project-1')).toBeTruthy();
        expect(beadsIssues.find(i => i.beads_issue_id === 'project-2')).toBeTruthy();
      });

      it('should find issue by beads_issue_id via getAllIssues', () => {
        db.upsertIssue({
          identifier: 'BEADS-1',
          project_identifier: 'BEADS',
          title: 'Target Issue',
          beads_issue_id: 'project-target',
        });

        const issues = db.getAllIssues();
        const found = issues.find(i => i.beads_issue_id === 'project-target');
        
        expect(found).toBeTruthy();
        expect(found.identifier).toBe('BEADS-1');
      });
    });
  });

  describe('edge cases', () => {
    it('should handle very long project names', () => {
      const longName = 'A'.repeat(1000);
      db.upsertProject({
        identifier: 'TEST',
        name: longName,
      });

      const project = db.getProject('TEST');
      expect(project.name).toBe(longName);
    });

    it('should handle special characters in identifiers', () => {
      db.upsertProject({
        identifier: 'TEST-123_ABC',
        name: 'Test',
      });

      const project = db.getProject('TEST-123_ABC');
      expect(project).toBeTruthy();
    });

    it('should handle concurrent upserts', () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          Promise.resolve(db.upsertProject({
            identifier: 'TEST',
            name: `Name ${i}`,
          }))
        );
      }

      return Promise.all(promises).then(() => {
        const project = db.getProject('TEST');
        expect(project).toBeTruthy();
      });
    });
  });
});
