import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsAdapter } from '../../lib/beads/BeadsAdapter.js';

describe('BeadsAdapter integration tests', () => {
  let adapter;
  let mockRunCommand;

  beforeEach(() => {
    mockRunCommand = vi.fn();
    adapter = new BeadsAdapter({
      cacheTtlMs: 10_000,
      cacheMaxEntries: 10,
      runCommand: mockRunCommand,
    });
  });

  describe('Query operations (fully idempotent)', () => {
    it('getReadyWork returns unblocked issues', async () => {
      const mockIssues = [
        {
          id: 'PROJ-1',
          title: 'Ready task',
          status: 'todo',
          priority: 'P1',
          blockedBy: [],
        },
      ];
      mockRunCommand.mockResolvedValueOnce(mockIssues);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.getReadyWork(project);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('PROJ-1');
      expect(mockRunCommand).toHaveBeenCalledWith('ready', expect.any(Array));
    });

    it('getIssue returns normalized issue detail', async () => {
      const mockIssue = {
        id: 'PROJ-1',
        title: 'Test issue',
        status: 'todo',
        priority: 'P2',
        description: 'Test description',
        assignee: null,
        labels: ['bug'],
        blocked_by: [],
        blocks: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      };
      mockRunCommand.mockResolvedValueOnce(mockIssue);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.getIssue('PROJ-1', project);

      expect(result.id).toBe('PROJ-1');
      expect(result.title).toBe('Test issue');
      expect(result.labels).toContain('bug');
    });

    it('listIssues applies filters', async () => {
      const mockIssues = [
        { id: 'PROJ-1', status: 'todo', priority: 'P1' },
        { id: 'PROJ-2', status: 'in_progress', priority: 'P2' },
      ];
      mockRunCommand.mockResolvedValueOnce(mockIssues);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.listIssues(project, { status: 'todo' });

      expect(result.items).toHaveLength(2);
      expect(mockRunCommand).toHaveBeenCalledWith(
        'list',
        expect.arrayContaining(['--status=todo'])
      );
    });

    it('listIssues includes closed issues when no status filter is supplied', async () => {
      mockRunCommand.mockResolvedValueOnce([
        { id: 'PROJ-1', status: 'open', priority: 'P1' },
        { id: 'PROJ-2', status: 'closed', priority: 'P2' },
      ]);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.listIssues(project);

      expect(result.items).toHaveLength(2);
      expect(mockRunCommand).toHaveBeenCalledWith(
        'list',
        expect.arrayContaining(['--all']),
      );
    });

    it('getDependencies returns issue blockers', async () => {
      const mockDeps = [
        { id: 'PROJ-2', type: 'blocks' },
        { id: 'PROJ-3', type: 'blocks' },
      ];
      mockRunCommand.mockResolvedValueOnce(mockDeps);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.getDependencies('PROJ-1', project);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('PROJ-2');
    });

    it('checkCycles detects circular dependencies', async () => {
      const mockCycles = [
        { cycle: ['PROJ-1', 'PROJ-2', 'PROJ-1'] },
      ];
      mockRunCommand.mockResolvedValueOnce(mockCycles);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.checkCycles(project);

      expect(result).toHaveLength(1);
      expect(result[0].cycle).toContain('PROJ-1');
    });

    it('getGraph returns dependency visualization', async () => {
      const mockGraph = {
        nodes: [
          { id: 'PROJ-1', label: 'Task 1' },
          { id: 'PROJ-2', label: 'Task 2' },
        ],
        edges: [{ from: 'PROJ-1', to: 'PROJ-2', type: 'blocks' }],
      };
      mockRunCommand.mockResolvedValueOnce(mockGraph);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.getGraph('PROJ-1', project);

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
    });
  });

  describe('Mutation operations (with idempotency guards)', () => {
    it('createIssue with checkDuplicate prevents duplicates', async () => {
      const existingIssues = [
        { id: 'PROJ-1', title: 'Existing task' },
      ];
      mockRunCommand
        .mockResolvedValueOnce(existingIssues) // listIssues check
        .mockResolvedValueOnce({ id: 'PROJ-2', title: 'New task' }); // create

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };

      // Should throw because title exists
      await expect(
        adapter.createIssue(project, 'Existing task', { checkDuplicate: true })
      ).rejects.toThrow('already exists');
    });

    it('createIssue succeeds with new title', async () => {
      const existingIssues = [
        { id: 'PROJ-1', title: 'Existing task' },
      ];
      const newIssue = { id: 'PROJ-2', title: 'New task', status: 'todo' };
      mockRunCommand
        .mockResolvedValueOnce(existingIssues) // listIssues check
        .mockResolvedValueOnce(newIssue); // create

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.createIssue(project, 'New task', {
        checkDuplicate: true,
      });

      expect(result.id).toBe('PROJ-2');
      expect(result.title).toBe('New task');
    });

    it('updateIssue with setter fields is idempotent', async () => {
      const updatedIssue = {
        id: 'PROJ-1',
        status: 'in_progress',
        priority: 'P1',
      };
      mockRunCommand.mockResolvedValueOnce(updatedIssue);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.updateIssue('PROJ-1', project, {
        status: 'in_progress',
        priority: 'P1',
      });

      expect(result.status).toBe('in_progress');
      expect(result.priority).toBe('P1');
    });

    it('claimIssue is atomic and fails if already claimed', async () => {
      mockRunCommand.mockRejectedValueOnce(
        new Error('already claimed by another user')
      );

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };

      await expect(
        adapter.claimIssue('PROJ-1', project, 'user-a')
      ).rejects.toThrow('already claimed by another user');
    });

    it('closeIssue is idempotent', async () => {
      const closedIssue = {
        id: 'PROJ-1',
        status: 'closed',
        closed_at: '2026-01-03T00:00:00Z',
      };
      mockRunCommand.mockResolvedValueOnce(closedIssue);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.closeIssue('PROJ-1', project);

      expect(result.status).toBe('closed');
    });

    it('reopenIssue is idempotent', async () => {
      const reopenedIssue = {
        id: 'PROJ-1',
        status: 'todo',
        closed_at: null,
      };
      mockRunCommand.mockResolvedValueOnce(reopenedIssue);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.reopenIssue('PROJ-1', project);

      expect(result.status).toBe('todo');
    });

    it('addNote with checkDuplicate prevents duplicate notes', async () => {
      const issueWithNote = {
        id: 'PROJ-1',
        notes: [{ text: 'Existing note' }],
      };
      mockRunCommand.mockResolvedValueOnce(issueWithNote);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };

      await expect(
        adapter.addNote('PROJ-1', project, 'Existing note', {
          checkDuplicate: true,
        })
      ).rejects.toThrow('already exists');
    });

    it('addComment with checkDuplicate prevents duplicate comments', async () => {
      const issueWithComment = {
        id: 'PROJ-1',
        comments: [{ text: 'Existing comment' }],
      };
      mockRunCommand.mockResolvedValueOnce(issueWithComment);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };

      await expect(
        adapter.addComment('PROJ-1', project, 'Existing comment', {
          checkDuplicate: true,
        })
      ).rejects.toThrow('already exists');
    });

    it('addDependency is idempotent', async () => {
      const result = { success: true };
      mockRunCommand.mockResolvedValueOnce(result);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const depResult = await adapter.addDependency('PROJ-1', 'PROJ-2', project);

      expect(depResult.success).toBe(true);
    });

    it('removeDependency is idempotent', async () => {
      const result = { success: true };
      mockRunCommand.mockResolvedValueOnce(result);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const depResult = await adapter.removeDependency('PROJ-1', 'PROJ-2', project);

      expect(depResult.success).toBe(true);
    });
  });

  describe('Readonly mode', () => {
    beforeEach(() => {
      adapter = new BeadsAdapter({
        cacheTtlMs: 10_000,
        cacheMaxEntries: 10,
        runCommand: mockRunCommand,
        readonly: true,
      });
    });

    it('prevents createIssue in readonly mode', async () => {
      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };

      await expect(
        adapter.createIssue(project, 'New task')
      ).rejects.toThrow('readonly mode');
    });

    it('prevents updateIssue in readonly mode', async () => {
      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };

      await expect(
        adapter.updateIssue('PROJ-1', project, { status: 'done' })
      ).rejects.toThrow('readonly mode');
    });

    it('prevents claimIssue in readonly mode', async () => {
      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };

      await expect(
        adapter.claimIssue('PROJ-1', project)
      ).rejects.toThrow('readonly mode');
    });

    it('allows query operations in readonly mode', async () => {
      mockRunCommand.mockResolvedValueOnce([
        { id: 'PROJ-1', status: 'todo' },
      ]);

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };
      const result = await adapter.getReadyWork(project);

      expect(result.items).toHaveLength(1);
    });
  });

  describe('Cache invalidation', () => {
    it('invalidates related caches after mutation', async () => {
      mockRunCommand.mockResolvedValueOnce({ id: 'PROJ-1', status: 'done' });

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };

      // Populate cache
      adapter.setCache('PROJ:ready-work', { items: [] });
      adapter.setCache('PROJ:issue:PROJ-1', { id: 'PROJ-1' });

      // Mutation should invalidate
      await adapter.closeIssue('PROJ-1', project);

      expect(adapter.getCache('PROJ:ready-work')).toBeNull();
      expect(adapter.getCache('PROJ:issue:PROJ-1')).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('throws on command execution failure', async () => {
      mockRunCommand.mockRejectedValueOnce(
        new Error('Beads command failed: bd ready --json')
      );

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };

      await expect(adapter.getReadyWork(project)).rejects.toThrow(
        'Beads command failed'
      );
    });

    it('handles malformed JSON response', async () => {
      mockRunCommand.mockRejectedValueOnce(
        new Error('Unexpected token < in JSON at position 0')
      );

      const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };

      await expect(adapter.getReadyWork(project)).rejects.toThrow();
    });
  });
});
