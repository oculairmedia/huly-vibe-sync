/**
 * Unit Tests for Orchestration Activities
 *
 * Tests the Temporal activities used by FullOrchestrationWorkflow.
 * These tests mock external services and validate activity logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// DoltQueryService mock (injected via setDoltQueryServiceClass)
const mockDoltPool = {
  execute: vi.fn(),
  end: vi.fn(),
};

class MockDoltQueryService {
  pool = mockDoltPool;
  connect = vi.fn().mockResolvedValue(undefined);
  disconnect = vi.fn().mockResolvedValue(undefined);
}

// Mock external dependencies before importing activities
vi.mock('../../temporal/lib', () => ({
  createBeadsClient: vi.fn(),
}));

vi.mock('../../temporal/activities/sync-database', () => ({
  getDb: vi.fn(),
}));

vi.mock('../../temporal/lib/httpPool', () => ({
  pooledFetch: vi.fn(),
}));

vi.mock('../../temporal/lib/memoryBuilders', () => ({
  buildBoardMetrics: vi.fn(async () => ({ total_tasks: 0, by_status: { open: 0, closed: 0 } })),
  buildProjectMeta: vi.fn(async () => ({ name: 'Test', identifier: 'TEST' })),
  buildBoardConfig: vi.fn(async () => ({ workflow: { tool: 'beads' } })),
  buildHotspots: vi.fn(async () => ({ blocked_items: [], summary: {} })),
  buildBacklogSummary: vi.fn(async () => ({ total_backlog: 0, top_items: [] })),
  buildRecentActivity: vi.fn(async () => ({ summary: {} })),
  buildComponentsSummary: vi.fn(async () => ({ types: [], total_types: 0 })),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      if (
        typeof p === 'string' &&
        (p.endsWith('.git') || p.startsWith('/opt/stacks/huly-sync-placeholders'))
      ) {
        return true;
      }
      return actual.existsSync(p);
    }),
    statSync: vi.fn((p: string) => {
      if (typeof p === 'string' && p.startsWith('/opt/stacks/huly-sync-placeholders')) {
        return { isDirectory: () => true };
      }
      return actual.statSync(p);
    }),
  };
});

// Import after mocking
import {
  extractGitRepoPath,
  resolveGitRepoPath,
  clearGitRepoPathCache,
  initializeBeads,
  fetchBeadsIssues,
  setDoltQueryServiceClass,
  updateLettaMemory,
  recordSyncMetrics,
} from '../../temporal/activities/orchestration';

import { createBeadsClient } from '../../temporal/lib';
import { pooledFetch } from '../../temporal/lib/httpPool';
import { getDb } from '../../temporal/activities/sync-database';

// ============================================================
// MOCK SETUP
// ============================================================

const mockBeadsClient = {
  isInitialized: vi.fn(),
  initialize: vi.fn(),
  listIssues: vi.fn(),
};

const mockSyncDb = {
  getProjectFilesystemPath: vi.fn(),
  getProject: vi.fn(),
};

describe('Orchestration Activities', () => {
  beforeEach(() => {
    clearGitRepoPathCache();
    vi.clearAllMocks();

    process.env.VIBE_API_URL = 'http://localhost:3105/api';

    (createBeadsClient as any).mockReturnValue(mockBeadsClient);
    mockSyncDb.getProjectFilesystemPath.mockReturnValue(null);
    mockSyncDb.getProject.mockReturnValue(null);
    (getDb as any).mockResolvedValue(mockSyncDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // extractGitRepoPath Tests
  // ============================================================
  describe('extractGitRepoPath', () => {
    it('should extract filesystem path from description', () => {
      const result = extractGitRepoPath({
        description: 'Some text\nFilesystem: /opt/stacks/myproject\nMore text',
      });
      expect(result).toBe('/opt/stacks/myproject');
    });

    it('should handle various formats', () => {
      expect(extractGitRepoPath({ description: 'Filesystem: /path/to/repo' })).toBe(
        '/path/to/repo'
      );
      expect(extractGitRepoPath({ description: 'filesystem: /path/to/repo' })).toBe(
        '/path/to/repo'
      );
      expect(extractGitRepoPath({ description: 'FILESYSTEM: /path/to/repo' })).toBe(
        '/path/to/repo'
      );
    });

    it('should return null when no path found', () => {
      expect(extractGitRepoPath({ description: 'No path here' })).toBeNull();
      expect(extractGitRepoPath({ description: undefined })).toBeNull();
      expect(extractGitRepoPath({ description: '' })).toBeNull();
    });

    it('should reject relative paths', () => {
      expect(extractGitRepoPath({ description: 'Filesystem: relative/path' })).toBeNull();
      expect(extractGitRepoPath({ description: 'Filesystem: ./relative' })).toBeNull();
    });

    it('should trim whitespace from path', () => {
      const result = extractGitRepoPath({
        description: 'Filesystem:   /opt/stacks/test   ',
      });
      expect(result).toBe('/opt/stacks/test');
    });
  });

  // ============================================================
  // resolveGitRepoPath Tests
  // ============================================================
  describe('resolveGitRepoPath', () => {
    it('should prefer sync DB filesystem_path', async () => {
      mockSyncDb.getProjectFilesystemPath.mockReturnValue('/opt/stacks/huly-vibe-sync');

      const result = await resolveGitRepoPath({ projectIdentifier: 'HVSYN' });

      expect(result).toBe('/opt/stacks/huly-vibe-sync');
    });

    it('should return null when sync DB has no filesystem_path', async () => {
      mockSyncDb.getProjectFilesystemPath.mockReturnValue(null);

      const result = await resolveGitRepoPath({ projectIdentifier: 'HVSYN' });

      expect(result).toBeNull();
    });
  });

  // ============================================================
  // initializeBeads Tests
  // ============================================================
  describe('initializeBeads', () => {
    it('should return true if already initialized', async () => {
      mockBeadsClient.isInitialized.mockReturnValue(true);

      const result = await initializeBeads({
        gitRepoPath: '/opt/stacks/test',
        projectName: 'Test',
        projectIdentifier: 'TEST',
      });

      expect(result).toBe(true);
      expect(mockBeadsClient.initialize).not.toHaveBeenCalled();
    });

    it('should initialize and return true on success', async () => {
      mockBeadsClient.isInitialized.mockReturnValue(false);
      mockBeadsClient.initialize.mockResolvedValue(undefined);

      const result = await initializeBeads({
        gitRepoPath: '/opt/stacks/test',
        projectName: 'Test',
        projectIdentifier: 'TEST',
      });

      expect(result).toBe(true);
      expect(mockBeadsClient.initialize).toHaveBeenCalled();
    });

    it('should return false on initialization failure', async () => {
      mockBeadsClient.isInitialized.mockReturnValue(false);
      mockBeadsClient.initialize.mockRejectedValue(new Error('Init failed'));

      const result = await initializeBeads({
        gitRepoPath: '/opt/stacks/test',
        projectName: 'Test',
        projectIdentifier: 'TEST',
      });

      expect(result).toBe(false);
    });
  });

  // ============================================================
  // fetchBeadsIssues Tests (Dolt SQL)
  // ============================================================
  describe('fetchBeadsIssues', () => {
    beforeEach(() => {
      mockDoltPool.execute.mockReset();
      mockDoltPool.end.mockReset();
      // Inject mock DoltQueryService class
      setDoltQueryServiceClass(MockDoltQueryService);
    });

    afterEach(() => {
      // Reset to default (lazy-loaded) state
      setDoltQueryServiceClass(null);
    });

    it('should return empty array when Dolt connection fails', async () => {
      // Create a class whose connect() rejects
      class FailingDoltQueryService {
        pool = mockDoltPool;
        connect = vi.fn().mockRejectedValue(new Error('Connection refused'));
        disconnect = vi.fn().mockResolvedValue(undefined);
      }
      setDoltQueryServiceClass(FailingDoltQueryService);

      const result = await fetchBeadsIssues({ gitRepoPath: '/opt/stacks/test' });

      expect(result).toEqual([]);
    });

    it('should return issues from Dolt query', async () => {
      const doltRows = [
        { id: 'bead-1', title: 'Issue 1', status: 'todo', priority: 2, description: 'Desc 1', labels: 'bug,feature' },
        { id: 'bead-2', title: 'Issue 2', status: 'done', priority: null, description: null, labels: null },
      ];
      mockDoltPool.execute.mockResolvedValue([doltRows]);

      const result = await fetchBeadsIssues({ gitRepoPath: '/opt/stacks/test' });

      expect(result).toEqual([
        { id: 'bead-1', title: 'Issue 1', status: 'todo', priority: 2, description: 'Desc 1', labels: ['bug', 'feature'] },
        { id: 'bead-2', title: 'Issue 2', status: 'done', priority: undefined, description: undefined, labels: [] },
      ]);
    });

    it('should return empty array on query error', async () => {
      mockDoltPool.execute.mockRejectedValue(new Error('Query failed'));

      const result = await fetchBeadsIssues({ gitRepoPath: '/opt/stacks/test' });

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // updateLettaMemory Tests
  // ============================================================
  describe('updateLettaMemory', () => {
    beforeEach(() => {
      (pooledFetch as any).mockReset();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should skip if Letta not configured', async () => {
      delete process.env.LETTA_BASE_URL;
      delete process.env.LETTA_API_URL;
      delete process.env.LETTA_PASSWORD;

      const result = await updateLettaMemory({
        agentId: 'agent-1',
        project: { identifier: 'TEST', name: 'Test' },
        issues: [],
      });

      expect(result.success).toBe(true);
      expect(pooledFetch).not.toHaveBeenCalled();
    });

    it('should update memory when Letta configured', async () => {
      process.env.LETTA_BASE_URL = 'https://letta.test.com';
      process.env.LETTA_PASSWORD = 'test-password';

      // Mock: first call fetches agent (GET), subsequent calls update blocks (PATCH)
      (pooledFetch as any).mockImplementation((url: string, opts?: any) => {
        if (!opts?.method || opts.method === 'GET') {
          // Agent fetch — return agent with existing blocks
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              memory: {
                blocks: [
                  { id: 'block-1', label: 'board_metrics', value: '{}' },
                  { id: 'block-2', label: 'project', value: '{}' },
                  { id: 'block-3', label: 'board_config', value: '{}' },
                  { id: 'block-4', label: 'hotspots', value: '{}' },
                  { id: 'block-5', label: 'backlog_summary', value: '{}' },
                  { id: 'block-6', label: 'components', value: '{}' },
                ],
              },
            }),
          });
        }
        // Block updates (PATCH)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      const result = await updateLettaMemory({
        agentId: 'agent-1',
        project: { identifier: 'TEST', name: 'Test' },
        issues: [{ id: 'T-1', title: 'Issue', status: 'open', priority: 2 }],
      });

      expect(result.success).toBe(true);
      expect(result.blocksUpdated).toBeGreaterThan(0);
      // First call should be agent fetch
      expect(pooledFetch).toHaveBeenCalledWith(
        'https://letta.test.com/v1/agents/agent-1',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-password',
          }),
        })
      );
    });

    it('should return failure on API error', async () => {
      process.env.LETTA_BASE_URL = 'https://letta.test.com';
      process.env.LETTA_PASSWORD = 'test-password';

      // Agent fetch fails
      (pooledFetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await updateLettaMemory({
        agentId: 'agent-1',
        project: { identifier: 'TEST', name: 'Test' },
        issues: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });
  });

  // ============================================================
  // recordSyncMetrics Tests
  // ============================================================
  describe('recordSyncMetrics', () => {
    it('should log metrics without throwing', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(
        recordSyncMetrics({
          projectsProcessed: 5,
          issuesSynced: 100,
          durationMs: 15000,
          errors: 2,
        })
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sync complete'),
        expect.objectContaining({
          projects: 5,
          issues: 100,
        })
      );

      consoleSpy.mockRestore();
    });
  });
});

// ============================================================
// WORKFLOW LOGIC TESTS (without Temporal runtime)
// ============================================================

describe('Workflow Logic', () => {
  describe('extractGitRepoPath (workflow helper)', () => {
    // Test the workflow-local version of extractGitRepoPath
    function extractGitRepoPath(description?: string): string | null {
      if (!description) return null;
      const match = description.match(/Filesystem:\s*([^\n]+)/i);
      if (match) {
        const path = match[1].trim();
        if (path.startsWith('/')) return path;
      }
      return null;
    }

    it('should extract path from various description formats', () => {
      expect(extractGitRepoPath('Filesystem: /opt/stacks/test')).toBe('/opt/stacks/test');
      expect(extractGitRepoPath('Some text\nFilesystem: /path\nMore')).toBe('/path');
      expect(extractGitRepoPath('filesystem:/home/user/repo')).toBe('/home/user/repo');
    });

    it('should handle edge cases', () => {
      expect(extractGitRepoPath(undefined)).toBeNull();
      expect(extractGitRepoPath('')).toBeNull();
      expect(extractGitRepoPath('No filesystem')).toBeNull();
      expect(extractGitRepoPath('Filesystem: relative/path')).toBeNull();
    });
  });

  describe('Huly identifier extraction', () => {
    function extractHulyIdentifier(description?: string): string | null {
      if (!description) return null;
      const match = description.match(/Huly Issue:\s*([A-Z]+-\d+)/i);
      return match ? match[1] : null;
    }

    it('should extract identifier from Vibe task description', () => {
      expect(extractHulyIdentifier('Synced from Huly Issue: TEST-123')).toBe('TEST-123');
      expect(extractHulyIdentifier('Huly Issue: PROJ-1')).toBe('PROJ-1');
      expect(extractHulyIdentifier('huly issue: abc-999')).toBe('abc-999');
    });

    it('should return null when no identifier', () => {
      expect(extractHulyIdentifier('No Huly link here')).toBeNull();
      expect(extractHulyIdentifier(undefined)).toBeNull();
      expect(extractHulyIdentifier('')).toBeNull();
    });
  });
});
