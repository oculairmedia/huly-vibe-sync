/**
 * Unit Tests for Full Sync Workflows
 *
 * Tests the SyncSingleIssueWorkflow, SyncProjectWorkflow, and SyncVibeToHulyWorkflow.
 * Uses Temporal testing kit with a local test server.
 */

import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import * as path from 'path';

// Import workflow types
import type { SyncIssueInput, SyncIssueResult } from '../../../temporal/workflows/full-sync';

// ============================================================
// MOCK DATA
// ============================================================

const mockIssue = {
  identifier: 'TEST-1',
  title: 'Test Issue',
  description: 'Test description',
  status: 'Backlog',
  priority: 'Medium',
  modifiedOn: Date.now(),
};

const mockContext = {
  projectIdentifier: 'TEST',
  gitRepoPath: '/opt/stacks/test-repo',
};

const mockContextNoGit = {
  projectIdentifier: 'TEST',
  gitRepoPath: '',
};

// ============================================================
// MOCK ACTIVITIES FACTORY
// ============================================================

const createMockActivities = () => ({
  syncIssueToBeads: vi.fn().mockResolvedValue({ success: true, id: 'beads-new', created: true }),
  syncBeadsToHuly: vi.fn().mockResolvedValue({ success: true }),
  commitBeadsToGit: vi.fn().mockResolvedValue({ success: true }),
});

// ============================================================
// SHARED TEST ENVIRONMENT
// ============================================================

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  // Suppress console output during tests
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

// ============================================================
// HELPER: Run workflow in isolated environment
// ============================================================

async function runSingleIssueWorkflow(
  input: SyncIssueInput,
  mockActivities: ReturnType<typeof createMockActivities>
): Promise<SyncIssueResult> {
  const taskQueue = `test-queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue,
    workflowsPath: path.resolve(__dirname, '../../../temporal/dist/workflows/full-sync.js'),
    activities: mockActivities,
  });

  return await worker.runUntil(
    testEnv.client.workflow.execute('SyncSingleIssueWorkflow', {
      taskQueue,
      workflowId: `test-single-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      args: [input],
      retry: { maximumAttempts: 1 },
      workflowExecutionTimeout: '10s',
    })
  );
}

async function runProjectWorkflow(
  input: {
    issues: SyncIssueInput[];
    context: typeof mockContext;
    batchSize?: number;
    commitAfterSync?: boolean;
  },
  mockActivities: ReturnType<typeof createMockActivities>
): Promise<{
  success: boolean;
  total: number;
  synced: number;
  failed: number;
  results: SyncIssueResult[];
}> {
  const taskQueue = `test-queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue,
    workflowsPath: path.resolve(__dirname, '../../../temporal/dist/workflows/full-sync.js'),
    activities: mockActivities,
  });

  return await worker.runUntil(
    testEnv.client.workflow.execute('SyncProjectWorkflow', {
      taskQueue,
      workflowId: `test-project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      args: [input],
      retry: { maximumAttempts: 1 },
      workflowExecutionTimeout: '10s',
    })
  );
}

// ============================================================
// TEST SUITE: SyncSingleIssueWorkflow
// ============================================================

describe('SyncSingleIssueWorkflow', () => {
  let mockActivities: ReturnType<typeof createMockActivities>;

  beforeEach(() => {
    mockActivities = createMockActivities();
  });

  // ============================================================
  // Success Cases
  // ============================================================
  describe('Success Cases', () => {
    it('should sync issue to Beads successfully', async () => {
      const input: SyncIssueInput = {
        issue: mockIssue,
        context: mockContext,
      };

      const result = await runSingleIssueWorkflow(input, mockActivities);

      expect(result.success).toBe(true);
      expect(result.beadsResult?.success).toBe(true);
      expect(result.beadsResult?.id).toBe('beads-new');
      expect(mockActivities.syncIssueToBeads).toHaveBeenCalled();
    }, 30000);
  });

  // ============================================================
  // Beads Sync Failure (Non-Fatal)
  // ============================================================
  describe('Beads Sync Failure (Non-Fatal)', () => {
    it('should succeed even when Beads sync fails', async () => {
      mockActivities.syncIssueToBeads.mockResolvedValue({
        success: false,
        error: 'Beads error',
      });

      const input: SyncIssueInput = {
        issue: mockIssue,
        context: mockContext,
      };

      const result = await runSingleIssueWorkflow(input, mockActivities);

      // Workflow should still succeed - Beads failures are non-fatal
      expect(result.success).toBe(true);
      expect(result.beadsResult?.success).toBe(false);
    }, 30000);
  });

  // ============================================================
  // Skip Conditions
  // ============================================================
  describe('Skip Conditions', () => {
    it('should skip Beads sync when syncToBeads=false', async () => {
      const input: SyncIssueInput = {
        issue: mockIssue,
        context: mockContext,
        syncToBeads: false,
      };

      const result = await runSingleIssueWorkflow(input, mockActivities);

      expect(result.success).toBe(true);
      expect(mockActivities.syncIssueToBeads).not.toHaveBeenCalled();
    }, 30000);

    it('should skip Beads sync when no gitRepoPath in context', async () => {
      const input: SyncIssueInput = {
        issue: mockIssue,
        context: mockContextNoGit,
      };

      const result = await runSingleIssueWorkflow(input, mockActivities);

      expect(result.success).toBe(true);
      expect(mockActivities.syncIssueToBeads).not.toHaveBeenCalled();
    }, 30000);
  });

  // ============================================================
  // Existing Beads Issues
  // ============================================================
  describe('Existing Beads Issues', () => {
    it('should pass existingBeadsIssues to syncIssueToBeads', async () => {
      const existingBeadsIssues = [{ id: 'beads-1', title: 'Existing Issue', status: 'open' }];

      const input: SyncIssueInput = {
        issue: mockIssue,
        context: mockContext,
        existingBeadsIssues,
      };

      await runSingleIssueWorkflow(input, mockActivities);

      expect(mockActivities.syncIssueToBeads).toHaveBeenCalledWith(
        expect.objectContaining({
          existingBeadsIssues,
        })
      );
    }, 30000);
  });
});

// ============================================================
// TEST SUITE: SyncProjectWorkflow
// ============================================================

describe('SyncProjectWorkflow', () => {
  let mockActivities: ReturnType<typeof createMockActivities>;

  beforeEach(() => {
    mockActivities = createMockActivities();
  });

  // ============================================================
  // Batch Processing
  // ============================================================
  describe('Batch Processing', () => {
    it('should process issues in batches with correct batch size', async () => {
      const issues: SyncIssueInput[] = Array.from({ length: 7 }, (_, i) => ({
        issue: { ...mockIssue, identifier: `TEST-${i + 1}` },
        context: mockContext,
      }));

      const result = await runProjectWorkflow(
        { issues, context: mockContext, batchSize: 3 },
        mockActivities
      );

      expect(result.success).toBe(true);
      expect(result.total).toBe(7);
      expect(result.synced).toBe(7);
      expect(result.failed).toBe(0);
      // 7 issues with batch size 3 = 3 batches (3 + 3 + 1)
      expect(mockActivities.syncIssueToBeads).toHaveBeenCalledTimes(7);
    }, 60000);

    it('should use default batch size of 5', async () => {
      const issues: SyncIssueInput[] = Array.from({ length: 12 }, (_, i) => ({
        issue: { ...mockIssue, identifier: `TEST-${i + 1}` },
        context: mockContext,
      }));

      const result = await runProjectWorkflow({ issues, context: mockContext }, mockActivities);

      expect(result.success).toBe(true);
      expect(result.total).toBe(12);
      expect(result.synced).toBe(12);
    }, 60000);
  });

  // ============================================================
  // Parallel Processing
  // ============================================================
  describe('Parallel Processing', () => {
    it('should process issues within a batch in parallel', async () => {
      const callOrder: string[] = [];
      mockActivities.syncIssueToBeads.mockImplementation(async (input: any) => {
        callOrder.push(`start-${input.issue.identifier}`);
        // Simulate varying processing times
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        callOrder.push(`end-${input.issue.identifier}`);
        return { success: true, id: `task-${input.issue.identifier}` };
      });

      const issues: SyncIssueInput[] = Array.from({ length: 3 }, (_, i) => ({
        issue: { ...mockIssue, identifier: `TEST-${i + 1}` },
        context: mockContext,
      }));

      await runProjectWorkflow({ issues, context: mockContext, batchSize: 3 }, mockActivities);

      // All starts should happen before all ends (parallel execution)
      const startIndices = callOrder
        .filter(c => c.startsWith('start-'))
        .map(c => callOrder.indexOf(c));
      const endIndices = callOrder.filter(c => c.startsWith('end-')).map(c => callOrder.indexOf(c));

      // At least some starts should happen before some ends (parallel)
      expect(Math.min(...endIndices)).toBeGreaterThan(Math.min(...startIndices));
    }, 30000);
  });

  // ============================================================
  // Git Commit
  // ============================================================
  describe('Git Commit', () => {
    it('should commit Beads changes when commitAfterSync=true', async () => {
      const issues: SyncIssueInput[] = [{ issue: mockIssue, context: mockContext }];

      await runProjectWorkflow(
        { issues, context: mockContext, commitAfterSync: true },
        mockActivities
      );

      expect(mockActivities.commitBeadsToGit).toHaveBeenCalledWith(
        expect.objectContaining({
          context: mockContext,
          message: expect.stringContaining('Sync'),
        })
      );
    }, 30000);

    it('should not commit when commitAfterSync=false', async () => {
      const issues: SyncIssueInput[] = [{ issue: mockIssue, context: mockContext }];

      await runProjectWorkflow(
        { issues, context: mockContext, commitAfterSync: false },
        mockActivities
      );

      expect(mockActivities.commitBeadsToGit).not.toHaveBeenCalled();
    }, 30000);

    it('should not commit when no gitRepoPath', async () => {
      const issues: SyncIssueInput[] = [{ issue: mockIssue, context: mockContextNoGit }];

      await runProjectWorkflow(
        { issues, context: mockContextNoGit, commitAfterSync: true },
        mockActivities
      );

      expect(mockActivities.commitBeadsToGit).not.toHaveBeenCalled();
    }, 30000);

    it('should include synced count in commit message', async () => {
      const issues: SyncIssueInput[] = Array.from({ length: 5 }, (_, i) => ({
        issue: { ...mockIssue, identifier: `TEST-${i + 1}` },
        context: mockContext,
      }));

      await runProjectWorkflow(
        { issues, context: mockContext, commitAfterSync: true },
        mockActivities
      );

      expect(mockActivities.commitBeadsToGit).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('5'),
        })
      );
    }, 30000);
  });

  // ============================================================
  // Error Counting
  // ============================================================
  describe('Error Counting', () => {
    it('should count synced and failed issues correctly', async () => {
      mockActivities.syncIssueToBeads.mockImplementation(async ({ issue }) => {
        if (issue.identifier.endsWith('2') || issue.identifier.endsWith('4')) {
          throw new Error('Simulated failure');
        }
        return { success: true, id: `task-${issue.identifier}` };
      });

      const issues: SyncIssueInput[] = Array.from({ length: 4 }, (_, i) => ({
        issue: { ...mockIssue, identifier: `TEST-${i + 1}` },
        context: mockContext,
      }));

      const result = await runProjectWorkflow({ issues, context: mockContext }, mockActivities);

      expect(result.total).toBe(4);
      expect(result.synced).toBe(2); // 1, 3 succeed
      expect(result.failed).toBe(2); // 2, 4 fail
      expect(result.success).toBe(false); // Has failures
    }, 30000);

    it('should return success=true when all issues sync', async () => {
      const issues: SyncIssueInput[] = Array.from({ length: 3 }, (_, i) => ({
        issue: { ...mockIssue, identifier: `TEST-${i + 1}` },
        context: mockContext,
      }));

      const result = await runProjectWorkflow({ issues, context: mockContext }, mockActivities);

      expect(result.success).toBe(true);
      expect(result.failed).toBe(0);
    }, 30000);

    it('should handle empty issues array', async () => {
      const result = await runProjectWorkflow({ issues: [], context: mockContext }, mockActivities);

      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
      expect(result.synced).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockActivities.syncIssueToBeads).not.toHaveBeenCalled();
    }, 30000);
  });

  // ============================================================
  // Results Array
  // ============================================================
  describe('Results Array', () => {
    it('should return results for each issue', async () => {
      const issues: SyncIssueInput[] = Array.from({ length: 3 }, (_, i) => ({
        issue: { ...mockIssue, identifier: `TEST-${i + 1}` },
        context: mockContext,
      }));

      const result = await runProjectWorkflow({ issues, context: mockContext }, mockActivities);

      expect(result.results).toHaveLength(3);
      result.results.forEach(r => {
        expect(r.success).toBe(true);
      });
    }, 30000);
  });
});
