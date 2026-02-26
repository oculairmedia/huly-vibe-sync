import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { persistIssueSyncState, resetDb } from '../../../temporal/activities/sync-database';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('persistIssueSyncState activity', () => {
  let tempDbPath: string;
  let originalDbPath: string | undefined;

  beforeEach(() => {
    originalDbPath = process.env.DB_PATH;
    tempDbPath = path.join(
      os.tmpdir(),
      `test-parent-child-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    process.env.DB_PATH = tempDbPath;
  });

  afterEach(async () => {
    await resetDb();
    process.env.DB_PATH = originalDbPath;
    for (const suffix of ['', '-wal', '-shm']) {
      const file = tempDbPath + suffix;
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  it('should persist parentVibeId to database', async () => {
    const { createSyncDatabase } = await import('../../../lib/database.js');
    const setupDb = createSyncDatabase(tempDbPath) as any;
    setupDb.upsertProject({ identifier: 'TEST', name: 'Test Project' });
    setupDb.close();

    await persistIssueSyncState({
      identifier: 'TEST-1',
      projectIdentifier: 'TEST',
      title: 'Test Issue',
      parentVibeId: 'vibe-parent-001',
    });

    const verifyDb = createSyncDatabase(tempDbPath) as any;
    const issue = verifyDb.getIssue('TEST-1');
    verifyDb.close();

    expect(issue.parent_vibe_id).toBe('vibe-parent-001');
  });

  it('should persist parentBeadsId to database', async () => {
    const { createSyncDatabase } = await import('../../../lib/database.js');
    const setupDb = createSyncDatabase(tempDbPath) as any;
    setupDb.upsertProject({ identifier: 'TEST', name: 'Test Project' });
    setupDb.close();

    await persistIssueSyncState({
      identifier: 'TEST-2',
      projectIdentifier: 'TEST',
      title: 'Test Issue 2',
      parentBeadsId: 'beads-parent-002',
    });

    const verifyDb = createSyncDatabase(tempDbPath) as any;
    const issue = verifyDb.getIssue('TEST-2');
    verifyDb.close();

    expect(issue.parent_beads_id).toBe('beads-parent-002');
  });

  it('should persist all parent IDs together', async () => {
    const { createSyncDatabase } = await import('../../../lib/database.js');
    const setupDb = createSyncDatabase(tempDbPath) as any;
    setupDb.upsertProject({ identifier: 'TEST', name: 'Test Project' });
    setupDb.close();

    await persistIssueSyncState({
      identifier: 'TEST-3',
      projectIdentifier: 'TEST',
      title: 'Test Issue 3',
      parentHulyId: 'TEST-0',
      parentVibeId: 'vibe-parent-003',
      parentBeadsId: 'beads-parent-003',
    });

    const verifyDb = createSyncDatabase(tempDbPath) as any;
    const issue = verifyDb.getIssue('TEST-3');
    verifyDb.close();

    expect(issue.parent_huly_id).toBe('TEST-0');
    expect(issue.parent_vibe_id).toBe('vibe-parent-003');
    expect(issue.parent_beads_id).toBe('beads-parent-003');
  });
});

describe('parent-first sort ordering', () => {
  it('should sort parents before children', () => {
    const issues = [
      { identifier: 'PROJ-2', parentIssue: 'PROJ-1', title: 'Child' },
      { identifier: 'PROJ-1', parentIssue: undefined, title: 'Parent' },
      { identifier: 'PROJ-3', parentIssue: 'PROJ-1', title: 'Child 2' },
      { identifier: 'PROJ-4', parentIssue: undefined, title: 'Standalone' },
    ];

    issues.sort((a, b) => {
      const aIsChild = !!a.parentIssue;
      const bIsChild = !!b.parentIssue;
      if (aIsChild === bIsChild) return 0;
      return aIsChild ? 1 : -1;
    });

    expect(issues[0].parentIssue).toBeFalsy();
    expect(issues[1].parentIssue).toBeFalsy();
    expect(issues[2].parentIssue).toBeTruthy();
    expect(issues[3].parentIssue).toBeTruthy();
  });

  it('should preserve relative order among parents and among children', () => {
    const issues = [
      { identifier: 'PROJ-5', parentIssue: 'PROJ-1', title: 'Child A' },
      { identifier: 'PROJ-1', parentIssue: undefined, title: 'Parent A' },
      { identifier: 'PROJ-6', parentIssue: 'PROJ-1', title: 'Child B' },
      { identifier: 'PROJ-2', parentIssue: undefined, title: 'Parent B' },
    ];

    issues.sort((a, b) => {
      const aIsChild = !!a.parentIssue;
      const bIsChild = !!b.parentIssue;
      if (aIsChild === bIsChild) return 0;
      return aIsChild ? 1 : -1;
    });

    expect(issues[0].identifier).toBe('PROJ-1');
    expect(issues[1].identifier).toBe('PROJ-2');
    expect(issues[2].identifier).toBe('PROJ-5');
    expect(issues[3].identifier).toBe('PROJ-6');
  });
});

describe('tasksByHulyId map update for parent resolution', () => {
  it('should resolve parent vibe ID from map after parent is synced', () => {
    const tasksByHulyId = new Map<string, { id: string; status: string }>();

    tasksByHulyId.set('PROJ-1', { id: 'vibe-100', status: 'active' });

    const parentIssueId: string | undefined = 'PROJ-1';
    const parentVibeId = parentIssueId ? tasksByHulyId.get(parentIssueId)?.id || null : null;
    expect(parentVibeId).toBe('vibe-100');
  });

  it('should return null when parent has not been synced yet', () => {
    const tasksByHulyId = new Map<string, { id: string; status: string }>();

    const parentIssueId: string | undefined = 'PROJ-99';
    const parentVibeId = parentIssueId ? tasksByHulyId.get(parentIssueId)?.id || null : null;
    expect(parentVibeId).toBeNull();
  });

  it('should handle issue with no parent', () => {
    const tasksByHulyId = new Map<string, { id: string; status: string }>();
    const parentIssue: string | undefined = undefined;

    const parentVibeId = parentIssue ? tasksByHulyId.get(parentIssue)?.id || null : null;
    expect(parentVibeId).toBeNull();
  });

  it('should support same-batch parent-child resolution', () => {
    const tasksByHulyId = new Map<string, { id: string; status: string }>();

    const sortedIssues = [
      { identifier: 'PROJ-1', parentIssue: undefined as string | undefined },
      { identifier: 'PROJ-2', parentIssue: 'PROJ-1' },
    ];

    const results: Array<{ identifier: string; parentVibeId: string | null }> = [];

    for (const issue of sortedIssues) {
      const vibeTaskId = `vibe-${issue.identifier}`;
      tasksByHulyId.set(issue.identifier, { id: vibeTaskId, status: 'active' });

      const parentVibeId = issue.parentIssue
        ? tasksByHulyId.get(issue.parentIssue)?.id || null
        : null;

      results.push({ identifier: issue.identifier, parentVibeId });
    }

    expect(results[0].parentVibeId).toBeNull();
    expect(results[1].parentVibeId).toBe('vibe-PROJ-1');
  });
});
