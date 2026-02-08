/**
 * Unit Tests for Orchestration Activities
 *
 * Tests the Temporal activities used by FullOrchestrationWorkflow.
 * These tests mock external services and validate activity logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock external dependencies before importing activities
vi.mock('../../temporal/lib', () => ({
  createHulyClient: vi.fn(),
  createVibeClient: vi.fn(),
  createBeadsClient: vi.fn(),
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
  fetchHulyProjects,
  fetchVibeProjects,
  ensureVibeProject,
  fetchProjectData,
  extractGitRepoPath,
  resolveGitRepoPath,
  clearGitRepoPathCache,
  clearProjectCaches,
  initializeBeads,
  fetchBeadsIssues,
  updateLettaMemory,
  recordSyncMetrics,
} from '../../temporal/activities/orchestration';

import { createHulyClient, createVibeClient, createBeadsClient } from '../../temporal/lib';

// ============================================================
// MOCK SETUP
// ============================================================

const mockHulyClient = {
  listProjects: vi.fn(),
  listIssues: vi.fn(),
};

const mockVibeClient = {
  listProjects: vi.fn(),
  listTasks: vi.fn(),
  createProject: vi.fn(),
};

const mockBeadsClient = {
  isInitialized: vi.fn(),
  initialize: vi.fn(),
  listIssues: vi.fn(),
};

describe('Orchestration Activities', () => {
  beforeEach(() => {
    clearGitRepoPathCache();
    clearProjectCaches();
    vi.clearAllMocks();

    // Set up environment variables
    process.env.HULY_API_URL = 'http://localhost:3458';
    process.env.VIBE_API_URL = 'http://localhost:3105/api';

    // Configure mocks
    (createHulyClient as any).mockReturnValue(mockHulyClient);
    (createVibeClient as any).mockReturnValue(mockVibeClient);
    (createBeadsClient as any).mockReturnValue(mockBeadsClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // fetchHulyProjects Tests
  // ============================================================
  describe('fetchHulyProjects', () => {
    it('should return list of Huly projects', async () => {
      const projects = [
        { identifier: 'PROJ1', name: 'Project 1' },
        { identifier: 'PROJ2', name: 'Project 2' },
      ];
      mockHulyClient.listProjects.mockResolvedValue(projects);

      const result = await fetchHulyProjects();

      expect(result).toEqual(projects);
      expect(mockHulyClient.listProjects).toHaveBeenCalled();
    });

    it('should throw retryable error on network failure', async () => {
      mockHulyClient.listProjects.mockRejectedValue(new Error('Network timeout'));

      await expect(fetchHulyProjects()).rejects.toThrow('fetchHulyProjects failed');
    });

    it('should throw non-retryable error on 404', async () => {
      mockHulyClient.listProjects.mockRejectedValue(new Error('404 Not Found'));

      await expect(fetchHulyProjects()).rejects.toThrow('fetchHulyProjects failed');
    });
  });

  // ============================================================
  // fetchVibeProjects Tests
  // ============================================================
  describe('fetchVibeProjects', () => {
    it('should return list of Vibe projects', async () => {
      const projects = [
        { id: 'uuid-1', name: 'Project 1' },
        { id: 'uuid-2', name: 'Project 2' },
      ];
      mockVibeClient.listProjects.mockResolvedValue(projects);

      const result = await fetchVibeProjects();

      expect(result).toEqual(projects);
      expect(mockVibeClient.listProjects).toHaveBeenCalled();
    });

    it('should throw on API error', async () => {
      mockVibeClient.listProjects.mockRejectedValue(new Error('API Error'));

      await expect(fetchVibeProjects()).rejects.toThrow('fetchVibeProjects failed');
    });
  });

  // ============================================================
  // ensureVibeProject Tests
  // ============================================================
  describe('ensureVibeProject', () => {
    it('should return existing project if found', async () => {
      const existing = { id: 'vibe-1', name: 'Test Project' };

      const result = await ensureVibeProject({
        hulyProject: { identifier: 'TEST', name: 'Test Project' },
        existingVibeProjects: [existing],
      });

      expect(result).toEqual(existing);
      expect(mockVibeClient.createProject).not.toHaveBeenCalled();
    });

    it('should match project names case-insensitively', async () => {
      const existing = { id: 'vibe-1', name: 'test project' };

      const result = await ensureVibeProject({
        hulyProject: { identifier: 'TEST', name: 'Test Project' },
        existingVibeProjects: [existing],
      });

      expect(result).toEqual(existing);
    });

    it('should create new project if not found', async () => {
      const created = { id: 'vibe-new', name: 'New Project' };
      mockVibeClient.createProject.mockResolvedValue(created);

      const result = await ensureVibeProject({
        hulyProject: { identifier: 'NEW', name: 'New Project' },
        existingVibeProjects: [],
      });

      expect(result).toEqual(created);
      expect(mockVibeClient.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Project' })
      );
    });

    it('should throw on create failure', async () => {
      mockVibeClient.createProject.mockRejectedValue(new Error('Create failed'));

      await expect(
        ensureVibeProject({
          hulyProject: { identifier: 'FAIL', name: 'Fail Project' },
          existingVibeProjects: [],
        })
      ).rejects.toThrow('ensureVibeProject failed');
    });
  });

  // ============================================================
  // fetchProjectData Tests
  // ============================================================
  describe('fetchProjectData', () => {
    it('should fetch issues and tasks in parallel', async () => {
      const issues = [{ identifier: 'T-1', title: 'Issue', status: 'Backlog' }];
      const tasks = [{ id: 'task-1', title: 'Task', status: 'todo' }];

      mockHulyClient.listIssues.mockResolvedValue(issues);
      mockVibeClient.listTasks.mockResolvedValue(tasks);

      const result = await fetchProjectData({
        hulyProject: { identifier: 'TEST', name: 'Test' },
        vibeProjectId: 'vibe-1',
      });

      expect(result.hulyIssues).toEqual(issues);
      expect(result.vibeTasks).toEqual(tasks);
      expect(mockHulyClient.listIssues).toHaveBeenCalledWith('TEST');
      expect(mockVibeClient.listTasks).toHaveBeenCalledWith('vibe-1');
    });

    it('should throw if issues fetch fails', async () => {
      mockHulyClient.listIssues.mockRejectedValue(new Error('API Error'));
      mockVibeClient.listTasks.mockResolvedValue([]);

      await expect(
        fetchProjectData({
          hulyProject: { identifier: 'TEST', name: 'Test' },
          vibeProjectId: 'vibe-1',
        })
      ).rejects.toThrow('fetchProjectData failed');
    });
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
    it('should return path when project has Filesystem in description', async () => {
      mockHulyClient.listProjects.mockResolvedValue([
        {
          identifier: 'HVSYN',
          name: 'Huly-Vibe Sync',
          description: 'Filesystem: /opt/stacks/huly-vibe-sync',
        },
      ]);

      const result = await resolveGitRepoPath({ projectIdentifier: 'HVSYN' });

      expect(result).toBe('/opt/stacks/huly-vibe-sync');
      expect(mockHulyClient.listProjects).toHaveBeenCalled();
    });

    it('should return null when project not found', async () => {
      mockHulyClient.listProjects.mockResolvedValue([
        {
          identifier: 'OTHER',
          name: 'Other Project',
          description: 'Filesystem: /opt/stacks/other',
        },
      ]);

      const result = await resolveGitRepoPath({ projectIdentifier: 'HVSYN' });

      expect(result).toBeNull();
    });

    it('should return null when description has no filesystem path', async () => {
      mockHulyClient.listProjects.mockResolvedValue([
        { identifier: 'HVSYN', name: 'Huly-Vibe Sync', description: 'Just a regular description' },
      ]);

      const result = await resolveGitRepoPath({ projectIdentifier: 'HVSYN' });

      expect(result).toBeNull();
    });

    it('should return null when description is undefined', async () => {
      mockHulyClient.listProjects.mockResolvedValue([
        { identifier: 'HVSYN', name: 'Huly-Vibe Sync' },
      ]);

      const result = await resolveGitRepoPath({ projectIdentifier: 'HVSYN' });

      expect(result).toBeNull();
    });

    it('should return null (not throw) when API fails', async () => {
      mockHulyClient.listProjects.mockRejectedValue(new Error('Connection refused'));

      const result = await resolveGitRepoPath({ projectIdentifier: 'HVSYN' });

      expect(result).toBeNull();
    });

    it('should support Path, Directory, and Location patterns', async () => {
      for (const [keyword, path] of [
        ['Path: /opt/stacks/path-test', '/opt/stacks/path-test'],
        ['Directory: /opt/stacks/dir-test', '/opt/stacks/dir-test'],
        ['Location: /opt/stacks/loc-test', '/opt/stacks/loc-test'],
      ]) {
        clearGitRepoPathCache();
        mockHulyClient.listProjects.mockResolvedValue([
          { identifier: 'TEST', name: 'Test', description: keyword },
        ]);

        const result = await resolveGitRepoPath({ projectIdentifier: 'TEST' });
        expect(result).toBe(path);
      }
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
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      global.fetch = vi.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should skip if Letta not configured', async () => {
      delete process.env.LETTA_BASE_URL;
      delete process.env.LETTA_API_URL;
      delete process.env.LETTA_PASSWORD;

      const result = await updateLettaMemory({
        agentId: 'agent-1',
        hulyProject: { identifier: 'TEST', name: 'Test' },
        vibeProject: { id: 'vibe-1', name: 'Test' },
        hulyIssues: [],
        vibeTasks: [],
      });

      expect(result.success).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should update memory when Letta configured', async () => {
      process.env.LETTA_BASE_URL = 'https://letta.test.com';
      process.env.LETTA_PASSWORD = 'test-password';

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await updateLettaMemory({
        agentId: 'agent-1',
        hulyProject: { identifier: 'TEST', name: 'Test' },
        vibeProject: { id: 'vibe-1', name: 'Test' },
        hulyIssues: [{ identifier: 'T-1', title: 'Issue', status: 'Backlog' }],
        vibeTasks: [{ id: 'task-1', title: 'Task', status: 'todo' }],
      });

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
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

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await updateLettaMemory({
        agentId: 'agent-1',
        hulyProject: { identifier: 'TEST', name: 'Test' },
        vibeProject: { id: 'vibe-1', name: 'Test' },
        hulyIssues: [],
        vibeTasks: [],
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
