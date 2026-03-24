/**
 * Unit Tests for Orchestration Activities
 *
 * Tests the Temporal activities used by FullOrchestrationWorkflow.
 * These tests mock external services and validate activity logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
  // fetchBeadsIssues Tests
  // ============================================================
  describe('fetchBeadsIssues', () => {
    it('should return empty array if not initialized', async () => {
      mockBeadsClient.isInitialized.mockReturnValue(false);

      const result = await fetchBeadsIssues({ gitRepoPath: '/opt/stacks/test' });

      expect(result).toEqual([]);
      expect(mockBeadsClient.listIssues).not.toHaveBeenCalled();
    });

    it('should return issues if initialized', async () => {
      const issues = [
        { id: 'bead-1', title: 'Issue 1', status: 'todo' },
        { id: 'bead-2', title: 'Issue 2', status: 'done' },
      ];
      mockBeadsClient.isInitialized.mockReturnValue(true);
      mockBeadsClient.listIssues.mockResolvedValue(issues);

      const result = await fetchBeadsIssues({ gitRepoPath: '/opt/stacks/test' });

      expect(result).toEqual(issues);
    });

    it('should return empty array on error', async () => {
      mockBeadsClient.isInitialized.mockReturnValue(true);
      mockBeadsClient.listIssues.mockRejectedValue(new Error('Read error'));

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
        hulyProject: { identifier: 'TEST', name: 'Test' },
        hulyIssues: [],
      });

      expect(result.success).toBe(true);
      expect(pooledFetch).not.toHaveBeenCalled();
    });

    it('should update memory when Letta configured', async () => {
      process.env.LETTA_BASE_URL = 'https://letta.test.com';
      process.env.LETTA_PASSWORD = 'test-password';

      (pooledFetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await updateLettaMemory({
        agentId: 'agent-1',
        hulyProject: { identifier: 'TEST', name: 'Test' },
        hulyIssues: [{ identifier: 'T-1', title: 'Issue', status: 'Backlog' }],
      });

      expect(result.success).toBe(true);
      expect(pooledFetch).toHaveBeenCalledWith(
        'https://letta.test.com/v1/agents/agent-1/memory',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-password',
          }),
        })
      );
    });

    it('should return failure on API error', async () => {
      process.env.LETTA_BASE_URL = 'https://letta.test.com';
      process.env.LETTA_PASSWORD = 'test-password';

      (pooledFetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await updateLettaMemory({
        agentId: 'agent-1',
        hulyProject: { identifier: 'TEST', name: 'Test' },
        hulyIssues: [],
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
