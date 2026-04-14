import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

import {
  extractGitRepoPath,
  resolveGitRepoPath,
  clearGitRepoPathCache,
  initializeBeads,
  fetchBeadsIssues,
  updateLettaMemory,
  recordSyncMetrics,
} from '../../temporal/activities/orchestration';

import { pooledFetch } from '../../temporal/lib/httpPool';
import { getDb } from '../../temporal/activities/sync-database';

const mockSyncDb = {
  getProjectFilesystemPath: vi.fn(),
  getProject: vi.fn(),
};

describe('Orchestration Activities', () => {
  beforeEach(() => {
    clearGitRepoPathCache();
    vi.clearAllMocks();
    process.env.VIBE_API_URL = 'http://localhost:3105/api';
    (getDb as any).mockResolvedValue(mockSyncDb);
    mockSyncDb.getProjectFilesystemPath.mockReturnValue(null);
    mockSyncDb.getProject.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractGitRepoPath', () => {
    it('extracts filesystem paths from descriptions', () => {
      expect(
        extractGitRepoPath({
          description: 'Some text\nFilesystem: /opt/stacks/myproject\nMore text',
        })
      ).toBe('/opt/stacks/myproject');
      expect(extractGitRepoPath({ description: 'filesystem: /path/to/repo' })).toBe(
        '/path/to/repo'
      );
      expect(extractGitRepoPath({ description: 'No path here' })).toBeNull();
      expect(extractGitRepoPath({ description: 'Filesystem: relative/path' })).toBeNull();
    });
  });

  describe('resolveGitRepoPath', () => {
    it('prefers sync DB filesystem_path', async () => {
      mockSyncDb.getProjectFilesystemPath.mockReturnValue('/opt/stacks/huly-vibe-sync');
      await expect(resolveGitRepoPath({ projectIdentifier: 'HVSYN' })).resolves.toBe(
        '/opt/stacks/huly-vibe-sync'
      );
    });

    it('returns null when sync DB has no filesystem_path', async () => {
      await expect(resolveGitRepoPath({ projectIdentifier: 'HVSYN' })).resolves.toBeNull();
    });
  });

  describe('initializeBeads', () => {
    it('returns false and skips legacy tracker initialization', async () => {
      await expect(
        initializeBeads({
          gitRepoPath: '/opt/stacks/test',
          projectName: 'Test',
          projectIdentifier: 'TEST',
        })
      ).resolves.toBe(false);
    });
  });

  describe('fetchBeadsIssues', () => {
    it('returns empty array as a legacy no-op', async () => {
      await expect(fetchBeadsIssues({ gitRepoPath: '/opt/stacks/test' })).resolves.toEqual([]);
    });
  });

  describe('updateLettaMemory', () => {
    beforeEach(() => {
      (pooledFetch as any).mockReset();
    });

    it('skips if Letta is not configured', async () => {
      delete process.env.LETTA_BASE_URL;
      delete process.env.LETTA_API_URL;
      delete process.env.LETTA_PASSWORD;

      await expect(
        updateLettaMemory({
          agentId: 'agent-1',
          project: { identifier: 'TEST', name: 'Test' },
          issues: [],
        })
      ).resolves.toEqual({ success: true });
      expect(pooledFetch).not.toHaveBeenCalled();
    });

    it('updates memory when Letta is configured', async () => {
      process.env.LETTA_BASE_URL = 'https://letta.test.com';
      process.env.LETTA_PASSWORD = 'test-password';

      (pooledFetch as any).mockImplementation((url: string, opts?: any) => {
        if (!opts?.method || opts.method === 'GET') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      const result = await updateLettaMemory({
        agentId: 'agent-1',
        project: { identifier: 'TEST', name: 'Test' },
        gitRepoPath: '/opt/stacks/test',
        issues: [{ id: 'T-1', title: 'Issue', status: 'open', priority: 2 }],
      });

      expect(result.success).toBe(true);
      expect(result.blocksUpdated).toBeGreaterThan(0);
      expect(pooledFetch).toHaveBeenCalledWith(
        'https://letta.test.com/v1/agents/agent-1',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-password' }),
        })
      );
    });

    it('returns failure on API error', async () => {
      process.env.LETTA_BASE_URL = 'https://letta.test.com';
      process.env.LETTA_PASSWORD = 'test-password';
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

  describe('recordSyncMetrics', () => {
    it('logs metrics without throwing', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await expect(
        recordSyncMetrics({ projectsProcessed: 5, issuesSynced: 100, durationMs: 15000, errors: 2 })
      ).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sync complete'),
        expect.objectContaining({ projects: 5, issues: 100 })
      );
      consoleSpy.mockRestore();
    });
  });
});

describe('Workflow Logic', () => {
  describe('extractGitRepoPath helper', () => {
    function localExtractGitRepoPath(description?: string): string | null {
      if (!description) return null;
      const match = description.match(/Filesystem:\s*([^\n]+)/i);
      if (!match) return null;
      const value = match[1].trim();
      return value.startsWith('/') ? value : null;
    }

    it('extracts absolute paths and rejects relative ones', () => {
      expect(localExtractGitRepoPath('Filesystem: /opt/stacks/test')).toBe('/opt/stacks/test');
      expect(localExtractGitRepoPath('Some text\nFilesystem: /path\nMore')).toBe('/path');
      expect(localExtractGitRepoPath('Filesystem: relative/path')).toBeNull();
      expect(localExtractGitRepoPath(undefined)).toBeNull();
    });
  });

  describe('Huly identifier extraction', () => {
    function extractHulyIdentifier(description?: string): string | null {
      if (!description) return null;
      const match = description.match(/Huly Issue:\s*([A-Z]+-\d+)/i);
      return match ? match[1] : null;
    }

    it('extracts identifiers from descriptions', () => {
      expect(extractHulyIdentifier('Synced from Huly Issue: TEST-123')).toBe('TEST-123');
      expect(extractHulyIdentifier('Huly Issue: PROJ-1')).toBe('PROJ-1');
      expect(extractHulyIdentifier('No Huly link here')).toBeNull();
    });
  });
});
