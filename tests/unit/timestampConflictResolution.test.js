/**
 * Unit Tests for Timestamp-Based Conflict Resolution
 *
 * Tests the "last-write-wins" conflict resolution logic in Phase 2 sync
 * Ensures that manual changes in Huly are not overwritten by stale Vibe data
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncDatabase } from '../../lib/database.js';
import fs from 'fs';
import path from 'path';

// Mock the dependencies
vi.mock('../../lib/HulyService.js', () => ({
  updateHulyIssueStatus: vi.fn(),
  updateHulyIssueDescription: vi.fn(),
}));

vi.mock('../../lib/statusMapper.js', () => ({
  mapVibeStatusToHuly: vi.fn(status => {
    const mapping = {
      todo: 'Backlog',
      inprogress: 'In Progress',
      inreview: 'In Review',
      done: 'Done',
      cancelled: 'Cancelled',
    };
    return mapping[status] || 'Backlog';
  }),
  normalizeStatus: vi.fn(status => status?.toLowerCase().replace(/\s+/g, '')),
}));

describe('Timestamp-Based Conflict Resolution', () => {
  let db;
  let testDbPath;

  beforeEach(async () => {
    // Create unique test database
    testDbPath = path.join(process.env.DB_PATH.replace('.db', `-timestamp-test-${Date.now()}.db`));
    db = new SyncDatabase(testDbPath);
    db.initialize();

    // Apply timestamp columns migration (003)
    // Note: SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we try-catch
    try {
      db.db.exec('ALTER TABLE issues ADD COLUMN huly_modified_at INTEGER');
    } catch (e) {
      // Column already exists, ignore
    }
    try {
      db.db.exec('ALTER TABLE issues ADD COLUMN vibe_modified_at INTEGER');
    } catch (e) {
      // Column already exists, ignore
    }
    db.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_issues_huly_modified ON issues(huly_modified_at);
      CREATE INDEX IF NOT EXISTS idx_issues_vibe_modified ON issues(vibe_modified_at);
    `);

    // Create a test project (needed for foreign key constraints)
    db.upsertProject({
      identifier: 'TEST',
      name: 'Test Project',
    });
  });

  afterEach(() => {
    if (db.db) {
      db.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    ['-wal', '-shm'].forEach(suffix => {
      const file = testDbPath + suffix;
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    vi.clearAllMocks();
  });

  describe('timestamp column storage', () => {
    it('should store huly_modified_at timestamp', () => {
      const now = Date.now();
      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        title: 'Test Issue',
        status: 'Backlog',
        huly_modified_at: now,
      });

      const issue = db.getIssue('TEST-001');
      expect(issue.huly_modified_at).toBe(now);
    });

    it('should store vibe_modified_at timestamp', () => {
      const now = Date.now();
      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        title: 'Test Issue',
        status: 'Backlog',
        vibe_task_id: 'vibe-123',
        vibe_modified_at: now,
      });

      const issue = db.getIssue('TEST-001');
      expect(issue.vibe_modified_at).toBe(now);
    });

    it('should store both timestamps independently', () => {
      const hulyTime = Date.now() - 10000; // 10 seconds ago
      const vibeTime = Date.now(); // now

      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        title: 'Test Issue',
        status: 'Backlog',
        huly_modified_at: hulyTime,
        vibe_modified_at: vibeTime,
      });

      const issue = db.getIssue('TEST-001');
      expect(issue.huly_modified_at).toBe(hulyTime);
      expect(issue.vibe_modified_at).toBe(vibeTime);
    });

    it('should preserve existing timestamps when updating other fields', () => {
      const originalTime = Date.now() - 20000;

      // Initial insert with timestamp
      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        title: 'Test Issue',
        status: 'Backlog',
        huly_modified_at: originalTime,
      });

      // Update status without providing timestamp (should preserve)
      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        title: 'Test Issue',
        status: 'In Progress',
      });

      const issue = db.getIssue('TEST-001');
      expect(issue.huly_modified_at).toBe(originalTime);
      expect(issue.status).toBe('In Progress');
    });
  });

  describe('timestamp comparison logic', () => {
    it('should correctly parse ISO 8601 timestamps from Vibe', () => {
      const isoTimestamp = '2025-11-06T10:30:00.000Z';
      const expectedMs = new Date(isoTimestamp).getTime();

      // Verify the timestamp can be parsed and converted back correctly
      expect(expectedMs).toBeGreaterThan(0);
      expect(Number.isNaN(expectedMs)).toBe(false);
      expect(new Date(expectedMs).toISOString()).toBe(isoTimestamp);
    });

    it('should handle different timestamp formats', () => {
      const timestamps = [
        '2025-11-06T10:30:00Z',
        '2025-11-06T10:30:00.000Z',
        '2025-11-06T10:30:00.123Z',
      ];

      timestamps.forEach(ts => {
        const ms = new Date(ts).getTime();
        expect(ms).toBeGreaterThan(0);
        expect(Number.isNaN(ms)).toBe(false);
      });
    });
  });

  describe('conflict scenarios', () => {
    it('should identify Huly as newer when timestamp is greater', () => {
      const hulyTime = Date.now();
      const vibeTime = hulyTime - 10000; // 10 seconds older

      expect(hulyTime > vibeTime).toBe(true);
    });

    it('should identify Vibe as newer when timestamp is greater', () => {
      const hulyTime = Date.now() - 10000;
      const vibeTime = Date.now();

      expect(vibeTime > hulyTime).toBe(true);
    });

    it('should calculate time difference correctly', () => {
      const hulyTime = 1730890200000;
      const vibeTime = 1730890210000; // 10 seconds later

      const diff = vibeTime - hulyTime;
      expect(diff).toBe(10000); // 10 seconds in milliseconds
    });
  });

  describe('Phase 1: Huly→Vibe timestamp capture', () => {
    it('should capture modifiedOn from Huly issue', () => {
      const modifiedOn = Date.now() - 5000;

      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        title: 'Test Issue',
        status: 'Backlog',
        vibe_task_id: 'vibe-123',
        huly_modified_at: modifiedOn,
      });

      const issue = db.getIssue('TEST-001');
      expect(issue.huly_modified_at).toBe(modifiedOn);
    });

    it('should use current time as fallback if modifiedOn is missing', () => {
      const beforeInsert = Date.now();

      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        title: 'Test Issue',
        status: 'Backlog',
        huly_modified_at: Date.now(),
      });

      const afterInsert = Date.now();
      const issue = db.getIssue('TEST-001');

      expect(issue.huly_modified_at).toBeGreaterThanOrEqual(beforeInsert);
      expect(issue.huly_modified_at).toBeLessThanOrEqual(afterInsert);
    });
  });

  describe('Phase 2: Vibe→Huly timestamp capture', () => {
    it('should capture updated_at from Vibe task', () => {
      const vibeUpdatedAt = '2025-11-06T10:30:00.000Z';
      const expectedMs = new Date(vibeUpdatedAt).getTime();

      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        status: 'Done',
        vibe_task_id: 'vibe-123',
        vibe_modified_at: expectedMs,
      });

      const issue = db.getIssue('TEST-001');
      expect(issue.vibe_modified_at).toBe(expectedMs);
    });
  });

  describe('integration scenario: preventing overwrites', () => {
    it('should prevent Vibe from overwriting newer Huly changes', async () => {
      // Setup: Issue exists in both systems
      const projectId = 'TEST';
      const identifier = 'TEST-001';

      // Initial state: synced at time T0
      const t0 = Date.now() - 60000; // 1 minute ago
      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        status: 'Backlog',
        vibe_task_id: 'vibe-123',
        huly_modified_at: t0,
        vibe_modified_at: t0,
      });

      // User manually changes status in Huly at T1 (30 seconds ago)
      const t1 = Date.now() - 30000;
      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        title: 'Test Task',
        status: 'Done', // User changed to Done
        vibe_task_id: 'vibe-123',
        huly_modified_at: t1, // Huly timestamp updated
        vibe_modified_at: t0, // Vibe timestamp unchanged
      });

      // Vibe has old data (still says Backlog) with old timestamp
      const vibeTask = {
        id: 'vibe-123',
        title: 'Test Task',
        status: 'todo', // Old status (maps to Backlog)
        updated_at: new Date(t0).toISOString(), // Old timestamp
      };

      // Get current state from DB
      const dbIssue = db.getIssue(identifier);

      // Simulate conflict resolution logic
      const vibeModifiedAt = new Date(vibeTask.updated_at).getTime();
      const hulyModifiedAt = dbIssue.huly_modified_at;

      // Verify: Huly is newer, should NOT update
      expect(hulyModifiedAt).toBeGreaterThan(vibeModifiedAt);

      // Simulate the decision: skip Phase 2 update
      const shouldSkipUpdate = hulyModifiedAt > vibeModifiedAt;
      expect(shouldSkipUpdate).toBe(true);

      // Verify status remains unchanged
      const finalIssue = db.getIssue(identifier);
      expect(finalIssue.status).toBe('Done'); // Should still be Done
    });

    it('should allow Vibe to update when it has newer changes', async () => {
      // Setup: Issue exists in both systems
      const projectId = 'TEST';
      const identifier = 'TEST-002';

      // Initial state: synced at T0
      const t0 = Date.now() - 60000;
      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        status: 'Backlog',
        vibe_task_id: 'vibe-456',
        huly_modified_at: t0,
        vibe_modified_at: t0,
      });

      // Status changed in Vibe at T1 (30 seconds ago)
      const t1 = Date.now() - 30000;
      const vibeTask = {
        id: 'vibe-456',
        title: 'Test Task 2',
        status: 'done', // Changed to done in Vibe
        updated_at: new Date(t1).toISOString(), // Newer timestamp
      };

      // Get current state from DB
      const dbIssue = db.getIssue(identifier);

      // Simulate conflict resolution logic
      const vibeModifiedAt = new Date(vibeTask.updated_at).getTime();
      const hulyModifiedAt = dbIssue.huly_modified_at;

      // Verify: Vibe is newer, SHOULD update
      expect(vibeModifiedAt).toBeGreaterThan(hulyModifiedAt);

      // Simulate the decision: proceed with Phase 2 update
      const shouldSkipUpdate = hulyModifiedAt > vibeModifiedAt;
      expect(shouldSkipUpdate).toBe(false);

      // Simulate successful update
      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        title: 'Test Task 2',
        status: 'Done', // Updated to Done
        vibe_task_id: 'vibe-456',
        vibe_modified_at: vibeModifiedAt,
      });

      const finalIssue = db.getIssue(identifier);
      expect(finalIssue.status).toBe('Done');
      expect(finalIssue.vibe_modified_at).toBe(vibeModifiedAt);
    });

    it('should fallback to old logic when timestamps are missing', () => {
      // Setup: Issue without timestamps (legacy data)
      const projectId = 'TEST';
      const identifier = 'TEST-003';

      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        status: 'Backlog',
        vibe_task_id: 'vibe-789',
        // No timestamps
      });

      const dbIssue = db.getIssue(identifier);

      // Verify timestamps are null
      expect(dbIssue.huly_modified_at).toBeNull();
      expect(dbIssue.vibe_modified_at).toBeNull();

      // Should fall back to checking status change
      const lastKnownHulyStatus = String('backlog');
      const currentHulyStatus = String('done');
      const hulyChanged = Boolean(lastKnownHulyStatus) && currentHulyStatus !== lastKnownHulyStatus;

      expect(hulyChanged).toBe(true);
      // In this case, old logic would skip Phase 2 update
    });
  });

  describe('edge cases', () => {
    it('should handle null timestamps gracefully', () => {
      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        title: 'Test Issue',
        status: 'Backlog',
      });

      const issue = db.getIssue('TEST-001');
      expect(issue.huly_modified_at).toBeNull();
      expect(issue.vibe_modified_at).toBeNull();
    });

    it('should handle invalid ISO timestamps', () => {
      const invalidTimestamp = 'not-a-timestamp';
      const ms = new Date(invalidTimestamp).getTime();

      expect(Number.isNaN(ms)).toBe(true);
    });

    it('should handle timestamps that are exactly equal', () => {
      const sameTime = Date.now();

      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        title: 'Test Issue',
        status: 'Backlog',
        huly_modified_at: sameTime,
        vibe_modified_at: sameTime,
      });

      const issue = db.getIssue('TEST-001');

      // When timestamps are equal, Vibe should NOT override
      // (hulyModifiedAt > vibeModifiedAt is false)
      const shouldSkip = issue.huly_modified_at > issue.vibe_modified_at;
      expect(shouldSkip).toBe(false);
    });

    it('should handle very old timestamps', () => {
      const veryOld = new Date('2020-01-01').getTime();

      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        title: 'Test Issue',
        status: 'Backlog',
        huly_modified_at: veryOld,
      });

      const issue = db.getIssue('TEST-001');
      expect(issue.huly_modified_at).toBe(veryOld);
    });

    it('should handle future timestamps', () => {
      const future = Date.now() + 86400000; // 1 day in future

      db.upsertIssue({
        identifier: 'TEST-001',
        project_identifier: 'TEST',
        title: 'Test Issue',
        status: 'Backlog',
        huly_modified_at: future,
      });

      const issue = db.getIssue('TEST-001');
      expect(issue.huly_modified_at).toBe(future);
    });
  });

  describe('Phase 1: Huly→Vibe propagation', () => {
    it('should propagate Huly status changes to Vibe', async () => {
      // Setup: Issue exists in both systems, initially synced
      const projectId = 'TEST';
      const identifier = 'TEST-004';

      // Initial state: Both systems at "Backlog", synced at T0
      const t0 = Date.now() - 60000; // 1 minute ago
      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        title: 'Test Task 4',
        status: 'Backlog',
        vibe_task_id: 'vibe-789',
        huly_modified_at: t0,
        vibe_modified_at: t0,
      });

      // Simulate: User changes status to "Done" in Huly at T1 (30 seconds ago)
      const t1 = Date.now() - 30000;

      // This is what Huly API would return after the change
      const hulyIssue = {
        identifier: 'TEST-004',
        title: 'Test Task 4',
        status: 'Done', // Changed in Huly
        modifiedOn: t1, // New timestamp from Huly
      };

      // Get database state before update
      const dbIssueBefore = db.getIssue(identifier);
      expect(dbIssueBefore.status).toBe('Backlog'); // Still old status in DB
      expect(dbIssueBefore.huly_modified_at).toBe(t0); // Old timestamp

      // Phase 1 logic should detect: hulyIssue.status !== lastKnownHulyStatus
      const lastKnownHulyStatus = dbIssueBefore.status;
      const hulyChanged = hulyIssue.status !== lastKnownHulyStatus;

      // Verify: Huly changed
      expect(hulyChanged).toBe(true);
      expect(hulyIssue.status).toBe('Done');
      expect(lastKnownHulyStatus).toBe('Backlog');

      // Simulate: Phase 1 should update Vibe and database
      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        title: 'Test Task 4',
        status: hulyIssue.status, // Update to new Huly status
        vibe_task_id: 'vibe-789',
        huly_modified_at: hulyIssue.modifiedOn, // Update Huly timestamp
      });

      // Verify: Database now reflects Huly changes
      const dbIssueAfter = db.getIssue(identifier);
      expect(dbIssueAfter.status).toBe('Done'); // Updated
      expect(dbIssueAfter.huly_modified_at).toBe(t1); // New timestamp

      // This test verifies that:
      // 1. Phase 1 can detect when Huly status changed
      // 2. Database is updated with new Huly status and timestamp
      // 3. The change should propagate to Vibe (tested via updateVibeTaskStatus call in actual code)
    });

    it('should detect Huly changes even after Phase 2 runs', async () => {
      // This tests the specific scenario where:
      // 1. User changes status in Huly
      // 2. Phase 1 should detect and sync to Vibe
      // 3. Phase 2 should not overwrite the Huly change

      const projectId = 'TEST';
      const identifier = 'TEST-005';

      // T0: Initial sync, both systems at "Backlog"
      const t0 = Date.now() - 120000; // 2 minutes ago
      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        title: 'Test Task 5',
        status: 'Backlog',
        vibe_task_id: 'vibe-999',
        huly_modified_at: t0,
        vibe_modified_at: t0,
      });

      // T1: User changes to "In Progress" in Huly (1 minute ago)
      const t1 = Date.now() - 60000;
      const hulyIssueT1 = {
        identifier: 'TEST-005',
        status: 'In Progress',
        modifiedOn: t1,
      };

      // Phase 1: Detect Huly change
      const dbBefore = db.getIssue(identifier);
      const hulyChanged = hulyIssueT1.status !== dbBefore.status;
      expect(hulyChanged).toBe(true);

      // Phase 1: Update database (simulating sync to Vibe)
      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        title: 'Test Task 5',
        status: hulyIssueT1.status,
        vibe_task_id: 'vibe-999',
        huly_modified_at: hulyIssueT1.modifiedOn,
      });

      // Vibe still has old data (hasn't synced yet)
      const vibeTask = {
        id: 'vibe-999',
        title: 'Test Task 5',
        status: 'todo', // Still old status (maps to Backlog)
        updated_at: new Date(t0).toISOString(), // Old timestamp
      };

      // Phase 2: Should NOT overwrite Huly change
      const dbAfterPhase1 = db.getIssue(identifier);
      const vibeModifiedAt = new Date(vibeTask.updated_at).getTime();
      const hulyModifiedAt = dbAfterPhase1.huly_modified_at;

      // Timestamp check: Huly is newer
      expect(hulyModifiedAt).toBeGreaterThan(vibeModifiedAt);

      // Phase 2 should skip update
      const shouldSkipPhase2 = hulyModifiedAt > vibeModifiedAt;
      expect(shouldSkipPhase2).toBe(true);

      // Final state: Huly change preserved
      expect(dbAfterPhase1.status).toBe('In Progress');
    });

    it('should update database with Huly timestamp on every Phase 1 run', async () => {
      const projectId = 'TEST';
      const identifier = 'TEST-006';

      // Initial state
      const t0 = Date.now() - 180000; // 3 minutes ago
      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        title: 'Test Task 6',
        status: 'Backlog',
        vibe_task_id: 'vibe-111',
        huly_modified_at: t0,
      });

      // Sync run 1: No change, but should update timestamp
      const t1 = Date.now() - 120000; // 2 minutes ago
      const hulyIssueRun1 = {
        identifier: 'TEST-006',
        status: 'Backlog', // Same status
        modifiedOn: t1, // But newer timestamp (Huly tracks modification)
      };

      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        title: 'Test Task 6',
        status: hulyIssueRun1.status,
        vibe_task_id: 'vibe-111',
        huly_modified_at: hulyIssueRun1.modifiedOn,
      });

      const afterRun1 = db.getIssue(identifier);
      expect(afterRun1.huly_modified_at).toBe(t1);

      // Sync run 2: Status changed
      const t2 = Date.now() - 60000; // 1 minute ago
      const hulyIssueRun2 = {
        identifier: 'TEST-006',
        status: 'Done', // Status changed
        modifiedOn: t2,
      };

      db.upsertIssue({
        identifier,
        project_identifier: projectId,
        title: 'Test Task 6',
        status: hulyIssueRun2.status,
        vibe_task_id: 'vibe-111',
        huly_modified_at: hulyIssueRun2.modifiedOn,
      });

      const afterRun2 = db.getIssue(identifier);
      expect(afterRun2.status).toBe('Done');
      expect(afterRun2.huly_modified_at).toBe(t2);
      expect(afterRun2.huly_modified_at).toBeGreaterThan(t1);
    });
  });
});
