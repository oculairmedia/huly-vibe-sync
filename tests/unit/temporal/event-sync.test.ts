import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import * as path from 'path';

import type {
  BeadsFileChangeInput,
  BeadsFileChangeResult,
} from '../../../temporal/workflows/event-sync';

const createMockActivities = () => ({
  fetchBeadsIssues: vi.fn().mockResolvedValue([]),
  getBeadsIssue: vi.fn().mockResolvedValue(null),
  syncBeadsToHuly: vi.fn().mockResolvedValue({ success: true }),
  hasBeadsIssueChanged: vi.fn().mockResolvedValue(true),
  persistIssueSyncState: vi
    .fn()
    .mockResolvedValue({ success: true, updated: 1, failed: 0, errors: [] }),
  getIssueSyncState: vi.fn().mockResolvedValue({ status: 'Backlog', beadsStatus: 'open' }),
  createBeadsIssueInHuly: vi
    .fn()
    .mockResolvedValue({ success: true, created: true, hulyIdentifier: 'TEST-NEW' }),
  getVibeTask: vi.fn().mockResolvedValue(null),
  resolveGitRepoPath: vi.fn().mockResolvedValue('/opt/stacks/example'),
});

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  testEnv = await TestWorkflowEnvironment.createLocal();
}, 60000);

afterAll(async () => {
  await testEnv?.teardown();
  vi.restoreAllMocks();
});

async function runBeadsFileChangeWorkflow(
  input: BeadsFileChangeInput,
  activities: ReturnType<typeof createMockActivities>
): Promise<BeadsFileChangeResult> {
  const taskQueue = `test-queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue,
    workflowsPath: path.resolve(__dirname, '../../../temporal/dist/workflows/event-sync.js'),
    activities,
  });

  return await worker.runUntil(
    testEnv.client.workflow.execute('BeadsFileChangeWorkflow', {
      taskQueue,
      workflowId: `test-beads-file-change-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      args: [input],
      retry: { maximumAttempts: 1 },
      workflowExecutionTimeout: '10s',
    })
  );
}

describe('BeadsFileChangeWorkflow', () => {
  let activities: ReturnType<typeof createMockActivities>;

  beforeEach(() => {
    activities = createMockActivities();
  });

  it('syncs labeled Beads issues to Huly (auto-sync path)', async () => {
    activities.fetchBeadsIssues.mockResolvedValue([
      { id: 'bd-1', title: 'Task 1', status: 'open', labels: ['huly:TEST-1'] },
    ]);
    activities.syncBeadsToHuly.mockResolvedValue({ success: true });

    const input: BeadsFileChangeInput = {
      projectIdentifier: 'TEST',
      gitRepoPath: '/repo',
      changedFiles: ['.beads/issues.jsonl'],
      timestamp: new Date().toISOString(),
    };

    const result = await runBeadsFileChangeWorkflow(input, activities);

    expect(result.success).toBe(true);
    expect(result.issuesProcessed).toBe(1);
    expect(result.issuesSynced).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(activities.syncBeadsToHuly).toHaveBeenCalledWith(
      expect.objectContaining({
        hulyIdentifier: 'TEST-1',
      })
    );
  }, 30000);

  it('creates Huly issue for Beads issues without huly labels', async () => {
    activities.fetchBeadsIssues.mockResolvedValue([
      { id: 'bd-2', title: 'Unlinked issue', status: 'open', labels: ['bug'] },
    ]);

    const input: BeadsFileChangeInput = {
      projectIdentifier: 'TEST',
      gitRepoPath: '/repo',
      changedFiles: ['.beads/beads.db-wal'],
      timestamp: new Date().toISOString(),
    };

    const result = await runBeadsFileChangeWorkflow(input, activities);

    expect(result.success).toBe(true);
    expect(result.issuesProcessed).toBe(1);
    expect(result.issuesSynced).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(activities.createBeadsIssueInHuly).toHaveBeenCalledTimes(1);
    expect(activities.syncBeadsToHuly).not.toHaveBeenCalled();
  }, 30000);

  it('records per-issue sync errors (E2E-like batch)', async () => {
    activities.fetchBeadsIssues.mockResolvedValue([
      { id: 'bd-10', title: 'Task 10', status: 'open', labels: ['huly:TEST-10'] },
      { id: 'bd-11', title: 'Task 11', status: 'open', labels: ['huly:TEST-11'] },
    ]);
    activities.syncBeadsToHuly
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'Huly API error' });

    const input: BeadsFileChangeInput = {
      projectIdentifier: 'TEST',
      gitRepoPath: '/repo',
      changedFiles: ['.beads/issues.jsonl', '.beads/beads.db'],
      timestamp: new Date().toISOString(),
    };

    const result = await runBeadsFileChangeWorkflow(input, activities);

    expect(result.success).toBe(false);
    expect(result.issuesProcessed).toBe(2);
    expect(result.issuesSynced).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].issueId).toBe('bd-11');
  }, 30000);
});
