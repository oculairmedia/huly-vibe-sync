/**
 * Integration Tests for Beads Sync Flows
 * 
 * Tests synchronization between Huly and Beads issue tracker
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncDatabase } from '../../lib/database.js';
import {
  createMockBeadsIssue,
  createMockBeadsIssueList,
  createMockCreateOutput,
  createSyncPair,
  MOCK_CONFIG,
} from '../mocks/beadsMocks.js';
import {
  createMockHulyIssue,
} from '../mocks/hulyMocks.js';

// Mock child_process before importing BeadsService
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

// Now import the sync functions (after mocking)
const {
  syncHulyIssueToBeads,
  syncBeadsIssueToHuly,
  listBeadsIssues,
  createBeadsIssue,
  closeBeadsIssue,
} = await import('../../lib/BeadsService.js');

describe('Beads Sync Integration Tests', () => {
  let db;
  const testDbPath = ':memory:';
  const testProjectPath = '/test/project';

  beforeEach(() => {
    // Initialize database
    db = new SyncDatabase(testDbPath);
    db.initialize();
    
    // Create test project
    db.upsertProject({
      identifier: 'TEST',
      name: 'Test Project',
    });
    
    // Reset mocks
    vi.clearAllMocks();
    mockExecSync.mockReset();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.restoreAllMocks();
  });

  describe('syncHulyIssueToBeads - New Issue Creation', () => {
    it('should create new Beads issue from Huly issue', async () => {
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'New Feature Request',
        status: 'Backlog',
        priority: 'High',
        description: 'Implement new feature',
        modifiedOn: Date.now(),
        project: 'TEST',
      });
      
      const createdBeadsIssue = createMockBeadsIssue({
        id: 'test-project-abc',
        title: 'New Feature Request',
        status: 'open',
        priority: 1,
      });
      
      mockExecSync.mockReturnValue(JSON.stringify(createdBeadsIssue));
      
      const result = await syncHulyIssueToBeads(
        testProjectPath,
        hulyIssue,
        [], // No existing beads issues
        db,
        MOCK_CONFIG.default
      );
      
      expect(result).toBeDefined();
      expect(result.id).toBe('test-project-abc');
      
      // Verify database was updated
      const dbIssue = db.getIssue('TEST-1');
      expect(dbIssue.beads_issue_id).toBe('test-project-abc');
      expect(dbIssue.beads_status).toBe('open');
    });

    it('should close Beads issue if Huly issue is Done', async () => {
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Completed Task',
        status: 'Done',
        modifiedOn: Date.now(),
        project: 'TEST',
      });
      
      const createdBeadsIssue = createMockBeadsIssue({
        id: 'test-project-done',
        title: 'Completed Task',
        status: 'open',
      });
      
      // First call creates, second adds comment (description), third closes
      mockExecSync
        .mockReturnValueOnce(JSON.stringify(createdBeadsIssue))
        .mockReturnValueOnce('') // comment command (adds description)
        .mockReturnValueOnce(''); // close command
      
      await syncHulyIssueToBeads(
        testProjectPath,
        hulyIssue,
        [],
        db,
        MOCK_CONFIG.default
      );
      
      // Verify close was called (might be call 2 or 3 depending on description)
      const closeCall = mockExecSync.mock.calls.find(call => call[0].includes('close'));
      expect(closeCall).toBeDefined();
      expect(closeCall[0]).toContain('close');
    });

    it('should return null in dry run mode', async () => {
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Dry Run Issue',
        project: 'TEST',
      });
      
      const result = await syncHulyIssueToBeads(
        testProjectPath,
        hulyIssue,
        [],
        db,
        MOCK_CONFIG.dryRun
      );
      
      expect(result).toBeNull();
      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });

  describe('syncHulyIssueToBeads - Issue Updates', () => {
    it('should skip update when no changes detected', async () => {
      const { hulyIssue, beadsIssue, dbRecord } = createSyncPair({
        identifier: 'TEST-1',
        title: 'Same Title',
        hulyStatus: 'Backlog',
        beadsStatus: 'open',
        hulyPriority: 'Medium',
        beadsPriority: 2,
      });
      
      // Pre-populate database
      db.upsertIssue(dbRecord);
      
      const result = await syncHulyIssueToBeads(
        testProjectPath,
        hulyIssue,
        [beadsIssue],
        db,
        MOCK_CONFIG.default
      );
      
      // No changes needed
      expect(result).toBeNull();
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('should update Beads when Huly status changes', async () => {
      // Setup: Issue exists in both systems
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue',
        beads_issue_id: 'test-project-abc',
        beads_status: 'open',
        huly_modified_at: Date.now() - 10000, // 10 seconds ago
        beads_modified_at: Date.now() - 20000, // 20 seconds ago
      });
      
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Issue',
        status: 'Done', // Changed to Done
        modifiedOn: Date.now(), // Now (most recent)
        project: 'TEST',
      });
      
      const beadsIssue = createMockBeadsIssue({
        id: 'test-project-abc',
        title: 'Issue',
        status: 'open',
        updated_at: new Date(Date.now() - 20000).toISOString(),
      });
      
      mockExecSync.mockReturnValue('');
      
      const result = await syncHulyIssueToBeads(
        testProjectPath,
        hulyIssue,
        [beadsIssue],
        db,
        MOCK_CONFIG.default
      );
      
      expect(result).toBeDefined();
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('close'),
        expect.any(Object)
      );
    });

    it('should update Beads when Huly priority changes', async () => {
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue',
        beads_issue_id: 'test-project-abc',
        huly_modified_at: Date.now() - 10000,
        beads_modified_at: Date.now() - 20000,
      });
      
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Issue',
        status: 'Backlog',
        priority: 'Urgent', // Changed to urgent
        modifiedOn: Date.now(),
        project: 'TEST',
      });
      
      const beadsIssue = createMockBeadsIssue({
        id: 'test-project-abc',
        title: 'Issue',
        status: 'open',
        priority: 2, // Was medium
        updated_at: new Date(Date.now() - 20000).toISOString(),
      });
      
      mockExecSync.mockReturnValue('');
      
      await syncHulyIssueToBeads(
        testProjectPath,
        hulyIssue,
        [beadsIssue],
        db,
        MOCK_CONFIG.default
      );
      
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--priority=0'),
        expect.any(Object)
      );
    });
  });

  describe('syncHulyIssueToBeads - Conflict Resolution', () => {
    it('should defer to Beads when Beads is newer and Huly unchanged', async () => {
      const now = Date.now();
      
      // Beads was modified after the last sync
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue',
        beads_issue_id: 'test-project-abc',
        huly_modified_at: now - 30000, // Huly: 30 sec ago (unchanged since last sync)
        beads_modified_at: now - 30000, // Last seen beads at this time
      });
      
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Issue',
        status: 'Backlog',
        modifiedOn: now - 30000, // Same as last seen (no change)
        project: 'TEST',
      });
      
      const beadsIssue = createMockBeadsIssue({
        id: 'test-project-abc',
        title: 'Issue - Updated in Beads',
        status: 'open',
        updated_at: new Date(now - 10000).toISOString(), // Beads: 10 sec ago (NEWER)
      });
      
      const result = await syncHulyIssueToBeads(
        testProjectPath,
        hulyIssue,
        [beadsIssue],
        db,
        MOCK_CONFIG.default
      );
      
      // Should defer to Beads (return null, don't update)
      expect(result).toBeNull();
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('should apply Huly changes when Huly is newer in conflict', async () => {
      const now = Date.now();
      
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue',
        beads_issue_id: 'test-project-abc',
        huly_modified_at: now - 30000,
        beads_modified_at: now - 30000,
      });
      
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Issue - Updated in Huly',
        status: 'Backlog',
        modifiedOn: now - 5000, // Huly: 5 sec ago (NEWER)
        project: 'TEST',
      });
      
      const beadsIssue = createMockBeadsIssue({
        id: 'test-project-abc',
        title: 'Issue',
        status: 'open',
        updated_at: new Date(now - 10000).toISOString(), // Beads: 10 sec ago
      });
      
      mockExecSync.mockReturnValue('');
      
      const result = await syncHulyIssueToBeads(
        testProjectPath,
        hulyIssue,
        [beadsIssue],
        db,
        MOCK_CONFIG.default
      );
      
      // Should apply Huly changes (Huly wins conflict)
      expect(result).toBeDefined();
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--title='),
        expect.any(Object)
      );
    });
  });

  describe('Database State After Sync', () => {
    it('should update all Beads fields in database after create', async () => {
      const now = Date.now();
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'New Issue',
        status: 'In Progress',
        priority: 'High',
        modifiedOn: now,
        project: 'TEST',
      });
      
      const createdBeadsIssue = createMockBeadsIssue({
        id: 'test-project-new',
        title: 'New Issue',
        status: 'open',
        priority: 1,
        updated_at: new Date(now).toISOString(),
      });
      
      mockExecSync.mockReturnValue(JSON.stringify(createdBeadsIssue));
      
      await syncHulyIssueToBeads(
        testProjectPath,
        hulyIssue,
        [],
        db,
        MOCK_CONFIG.default
      );
      
      const dbIssue = db.getIssue('TEST-1');
      expect(dbIssue.beads_issue_id).toBe('test-project-new');
      expect(dbIssue.beads_status).toBe('open');
      expect(dbIssue.beads_modified_at).toBeDefined();
      expect(dbIssue.huly_modified_at).toBe(now);
    });

    it('should preserve beads_issue_id across updates', async () => {
      const beadsIssueId = 'test-project-persistent';
      
      // First create
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue',
        beads_issue_id: beadsIssueId,
        beads_status: 'open',
        huly_modified_at: Date.now() - 20000,
        beads_modified_at: Date.now() - 20000,
      });
      
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Updated Issue',
        status: 'Done',
        modifiedOn: Date.now(),
        project: 'TEST',
      });
      
      const beadsIssue = createMockBeadsIssue({
        id: beadsIssueId,
        title: 'Issue',
        status: 'open',
        updated_at: new Date(Date.now() - 20000).toISOString(),
      });
      
      mockExecSync.mockReturnValue('');
      
      await syncHulyIssueToBeads(
        testProjectPath,
        hulyIssue,
        [beadsIssue],
        db,
        MOCK_CONFIG.default
      );
      
      // beads_issue_id should remain the same
      const dbIssue = db.getIssue('TEST-1');
      expect(dbIssue.beads_issue_id).toBe(beadsIssueId);
      expect(dbIssue.beads_status).toBe('closed');
    });
  });

  describe('getAllIssues for Beads Lookup', () => {
    it('should find issues by beads_issue_id', async () => {
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue 1',
        beads_issue_id: 'beads-id-1',
      });
      db.upsertIssue({
        identifier: 'TEST-2',
        project_identifier: 'TEST',
        title: 'Issue 2',
        beads_issue_id: 'beads-id-2',
      });
      db.upsertIssue({
        identifier: 'TEST-3',
        project_identifier: 'TEST',
        title: 'Issue 3',
        // No beads_issue_id
      });
      
      const allIssues = db.getAllIssues();
      
      // Should be able to find by beads_issue_id
      const beadsIssue1 = allIssues.find(i => i.beads_issue_id === 'beads-id-1');
      const beadsIssue2 = allIssues.find(i => i.beads_issue_id === 'beads-id-2');
      const noBeadsId = allIssues.filter(i => !i.beads_issue_id);
      
      expect(beadsIssue1.identifier).toBe('TEST-1');
      expect(beadsIssue2.identifier).toBe('TEST-2');
      expect(noBeadsId.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle CLI errors gracefully', async () => {
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Will Fail',
        project: 'TEST',
      });
      
      mockExecSync.mockImplementation(() => {
        throw new Error('CLI error: database locked');
      });
      
      const result = await syncHulyIssueToBeads(
        testProjectPath,
        hulyIssue,
        [],
        db,
        MOCK_CONFIG.default
      );
      
      expect(result).toBeNull();
    });

    it('should handle missing project path', async () => {
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Issue',
        project: 'TEST',
      });
      
      mockExecSync.mockImplementation(() => {
        throw new Error('Not a beads repository');
      });
      
      const result = await syncHulyIssueToBeads(
        '/nonexistent/path',
        hulyIssue,
        [],
        db,
        MOCK_CONFIG.default
      );
      
      expect(result).toBeNull();
    });
  });

  describe('Priority Mapping Integration', () => {
    it('should map Huly Urgent to Beads P0', async () => {
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Urgent Issue',
        priority: 'Urgent',
        project: 'TEST',
      });
      
      const createdIssue = createMockBeadsIssue({ id: 'test-urgent' });
      mockExecSync.mockReturnValue(JSON.stringify(createdIssue));
      
      await syncHulyIssueToBeads(testProjectPath, hulyIssue, [], db, MOCK_CONFIG.default);
      
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--priority=0'),
        expect.any(Object)
      );
    });

    it('should map Huly High to Beads P1', async () => {
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'High Priority Issue',
        priority: 'High',
        project: 'TEST',
      });
      
      const createdIssue = createMockBeadsIssue({ id: 'test-high' });
      mockExecSync.mockReturnValue(JSON.stringify(createdIssue));
      
      await syncHulyIssueToBeads(testProjectPath, hulyIssue, [], db, MOCK_CONFIG.default);
      
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--priority=1'),
        expect.any(Object)
      );
    });

    it('should map Huly Low to Beads P3', async () => {
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Low Priority Issue',
        priority: 'Low',
        project: 'TEST',
      });
      
      const createdIssue = createMockBeadsIssue({ id: 'test-low' });
      mockExecSync.mockReturnValue(JSON.stringify(createdIssue));
      
      await syncHulyIssueToBeads(testProjectPath, hulyIssue, [], db, MOCK_CONFIG.default);
      
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--priority=3'),
        expect.any(Object)
      );
    });
  });

  describe('Type Mapping Integration', () => {
    it('should map Huly Bug to Beads bug type', async () => {
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'Bug Report',
        type: 'Bug',
        project: 'TEST',
      });
      
      const createdIssue = createMockBeadsIssue({ id: 'test-bug' });
      mockExecSync.mockReturnValue(JSON.stringify(createdIssue));
      
      await syncHulyIssueToBeads(testProjectPath, hulyIssue, [], db, MOCK_CONFIG.default);
      
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--type=bug'),
        expect.any(Object)
      );
    });

    it('should map Huly Feature to Beads feature type', async () => {
      const hulyIssue = createMockHulyIssue({
        identifier: 'TEST-1',
        title: 'New Feature',
        type: 'Feature',
        project: 'TEST',
      });
      
      const createdIssue = createMockBeadsIssue({ id: 'test-feature' });
      mockExecSync.mockReturnValue(JSON.stringify(createdIssue));
      
      await syncHulyIssueToBeads(testProjectPath, hulyIssue, [], db, MOCK_CONFIG.default);
      
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--type=feature'),
        expect.any(Object)
      );
    });
  });
});
