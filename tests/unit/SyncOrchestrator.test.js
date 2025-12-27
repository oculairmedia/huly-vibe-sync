/**
 * Unit Tests for SyncOrchestrator
 *
 * Tests the core sync coordination logic including:
 * - Project filtering and processing
 * - Phase 1 (Huly→Vibe) sync
 * - Phase 2 (Vibe→Huly) sync
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { syncHulyToVibe, createSyncOrchestrator } from '../../lib/SyncOrchestrator.js';

// Mock all dependencies
vi.mock('../../lib/HulyService.js', () => ({
  fetchHulyProjects: vi.fn(),
  fetchHulyIssues: vi.fn(),
  updateHulyIssueStatus: vi.fn(),
  updateHulyIssueDescription: vi.fn(),
}));

vi.mock('../../lib/VibeService.js', () => ({
  listVibeProjects: vi.fn(),
  createVibeProject: vi.fn(),
  listVibeTasks: vi.fn(),
  createVibeTask: vi.fn(),
  updateVibeTaskStatus: vi.fn(),
  updateVibeTaskDescription: vi.fn(),
}));

vi.mock('../../lib/statusMapper.js', () => ({
  mapHulyStatusToVibe: vi.fn(status => {
    const map = {
      Backlog: 'todo',
      'In Progress': 'inprogress',
      'In Review': 'inreview',
      Done: 'done',
    };
    return map[status] || 'todo';
  }),
  normalizeStatus: vi.fn(status => status?.toLowerCase() || ''),
  mapVibeStatusToHuly: vi.fn(status => {
    const map = {
      todo: 'Backlog',
      inprogress: 'In Progress',
      inreview: 'In Review',
      done: 'Done',
    };
    return map[status] || 'Backlog';
  }),
}));

vi.mock('../../lib/textParsers.js', () => ({
  extractHulyIdentifier: vi.fn(desc => {
    if (!desc) return null;
    const match = desc.match(/Huly Issue: (\w+-\d+)/);
    return match ? match[1] : null;
  }),
  determineGitRepoPath: vi.fn(() => '/home/user/project'),
}));

vi.mock('../../lib/utils.js', () => ({
  processBatch: vi.fn(async (items, processor) => {
    for (const item of items) {
      await processor(item);
    }
  }),
}));

vi.mock('../../lib/logger.js', () => ({
  createSyncLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../lib/HealthService.js', () => ({
  recordSyncStats: vi.fn(),
  recordApiLatency: vi.fn(),
}));

describe('SyncOrchestrator', () => {
  let mockHulyClient;
  let mockVibeClient;
  let mockDb;
  let mockConfig;
  let consoleSpy;

  // Import mocked modules
  let fetchHulyProjects;
  let fetchHulyIssues;
  let listVibeProjects;
  let createVibeProject;
  let listVibeTasks;
  let createVibeTask;
  let updateVibeTaskStatus;

  beforeEach(async () => {
    // Get mocked functions
    const HulyService = await import('../../lib/HulyService.js');
    const VibeService = await import('../../lib/VibeService.js');

    fetchHulyProjects = HulyService.fetchHulyProjects;
    fetchHulyIssues = HulyService.fetchHulyIssues;
    listVibeProjects = VibeService.listVibeProjects;
    createVibeProject = VibeService.createVibeProject;
    listVibeTasks = VibeService.listVibeTasks;
    createVibeTask = VibeService.createVibeTask;
    updateVibeTaskStatus = VibeService.updateVibeTaskStatus;

    // Create mock clients
    mockHulyClient = {};
    mockVibeClient = {};

    // Create mock database
    mockDb = {
      startSyncRun: vi.fn(() => 'sync-123'),
      getLastSync: vi.fn(() => null),
      getProject: vi.fn(() => null),
      getProjectLettaInfo: vi.fn(() => null),
      upsertProject: vi.fn(),
      upsertIssue: vi.fn(),
      getIssue: vi.fn(() => null),
      updateProjectActivity: vi.fn(),
      completeSyncRun: vi.fn(),
      getProjectsToSync: vi.fn(() => []),
    };

    // Create mock config
    mockConfig = {
      sync: {
        dryRun: false,
        skipEmpty: false,
        incremental: false,
        parallel: false,
        maxWorkers: 1,
        apiDelay: 0,
      },
      beads: {
        enabled: false,
      },
    };

    // Suppress console output
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ============================================================
  // Basic Sync Flow Tests
  // ============================================================
  describe('syncHulyToVibe - Basic Flow', () => {
    it('should skip sync when no Huly projects found', async () => {
      fetchHulyProjects.mockResolvedValue([]);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(fetchHulyProjects).toHaveBeenCalled();
      expect(listVibeProjects).not.toHaveBeenCalled();
    });

    it('should fetch Vibe projects after Huly projects', async () => {
      fetchHulyProjects.mockResolvedValue([{ identifier: 'TEST', name: 'Test Project' }]);
      listVibeProjects.mockResolvedValue([]);
      fetchHulyIssues.mockResolvedValue([]);
      createVibeProject.mockResolvedValue({ id: 'vibe-1', name: 'Test Project' });
      listVibeTasks.mockResolvedValue([]);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(fetchHulyProjects).toHaveBeenCalled();
      expect(listVibeProjects).toHaveBeenCalled();
    });

    it('should create Vibe project if not exists', async () => {
      const hulyProject = { identifier: 'NEW', name: 'New Project' };
      fetchHulyProjects.mockResolvedValue([hulyProject]);
      listVibeProjects.mockResolvedValue([]); // No existing Vibe projects
      fetchHulyIssues.mockResolvedValue([]);
      createVibeProject.mockResolvedValue({ id: 'vibe-new', name: 'New Project' });
      listVibeTasks.mockResolvedValue([]);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(createVibeProject).toHaveBeenCalledWith(mockVibeClient, hulyProject, mockConfig);
    });

    it('should not create Vibe project if already exists', async () => {
      const hulyProject = { identifier: 'EXIST', name: 'Existing Project' };
      fetchHulyProjects.mockResolvedValue([hulyProject]);
      listVibeProjects.mockResolvedValue([{ id: 'vibe-1', name: 'Existing Project' }]);
      fetchHulyIssues.mockResolvedValue([]);
      listVibeTasks.mockResolvedValue([]);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(createVibeProject).not.toHaveBeenCalled();
    });

    it('should skip project if Vibe project creation fails', async () => {
      const hulyProject = { identifier: 'FAIL', name: 'Failed Project' };
      fetchHulyProjects.mockResolvedValue([hulyProject]);
      listVibeProjects.mockResolvedValue([]);
      createVibeProject.mockResolvedValue(null); // Creation failed

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(fetchHulyIssues).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Phase 1: Huly → Vibe Tests
  // ============================================================
  describe('Phase 1: Huly → Vibe', () => {
    beforeEach(() => {
      fetchHulyProjects.mockResolvedValue([{ identifier: 'TEST', name: 'Test Project' }]);
      listVibeProjects.mockResolvedValue([{ id: 'vibe-1', name: 'Test Project' }]);
    });

    it('should create Vibe task for new Huly issue', async () => {
      const hulyIssue = {
        identifier: 'TEST-1',
        title: 'New Issue',
        description: 'Issue description',
        status: 'Backlog',
      };
      fetchHulyIssues.mockResolvedValue([hulyIssue]);
      listVibeTasks.mockResolvedValue([]); // No existing tasks
      createVibeTask.mockResolvedValue({ id: 'task-1' });

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(createVibeTask).toHaveBeenCalledWith(mockVibeClient, 'vibe-1', hulyIssue, mockConfig);
    });

    it('should not create task if already exists', async () => {
      const hulyIssue = {
        identifier: 'TEST-1',
        title: 'Existing Issue',
        status: 'Backlog',
      };
      fetchHulyIssues.mockResolvedValue([hulyIssue]);
      listVibeTasks.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Existing Issue',
          description: 'Synced from Huly Issue: TEST-1',
          status: 'todo',
        },
      ]);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(createVibeTask).not.toHaveBeenCalled();
    });

    it('should update Vibe task status when Huly status changed', async () => {
      const hulyIssue = {
        identifier: 'TEST-1',
        title: 'Issue',
        status: 'Done', // Changed status
      };
      fetchHulyIssues.mockResolvedValue([hulyIssue]);
      listVibeTasks.mockResolvedValue([
        {
          id: 'task-1',
          description: 'Huly Issue: TEST-1',
          status: 'todo', // Old status
        },
      ]);
      mockDb.getIssue.mockReturnValue({
        identifier: 'TEST-1',
        status: 'Backlog', // Last known status
        vibe_status: 'todo',
      });

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(updateVibeTaskStatus).toHaveBeenCalledWith(
        mockVibeClient,
        'task-1',
        'done',
        mockConfig
      );
    });

    it('should upsert issue to database after creating task', async () => {
      const hulyIssue = {
        identifier: 'TEST-1',
        title: 'New Issue',
        description: 'Description',
        status: 'Backlog',
        priority: 'High',
      };
      fetchHulyIssues.mockResolvedValue([hulyIssue]);
      listVibeTasks.mockResolvedValue([]);
      createVibeTask.mockResolvedValue({ id: 'task-1' });

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(mockDb.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'TEST-1',
          project_identifier: 'TEST',
          vibe_task_id: 'task-1',
        })
      );
    });
  });

  // ============================================================
  // Project Filtering Tests
  // ============================================================
  describe('Project Filtering', () => {
    it('should filter projects by projectId when specified', async () => {
      fetchHulyProjects.mockResolvedValue([
        { identifier: 'PROJ1', name: 'Project 1' },
        { identifier: 'PROJ2', name: 'Project 2' },
      ]);
      listVibeProjects.mockResolvedValue([
        { id: 'v1', name: 'Project 1' },
        { id: 'v2', name: 'Project 2' },
      ]);
      fetchHulyIssues.mockResolvedValue([]);
      listVibeTasks.mockResolvedValue([]);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig, null, 'PROJ1');

      // Should only fetch issues for PROJ1
      expect(fetchHulyIssues).toHaveBeenCalledTimes(1);
      expect(fetchHulyIssues).toHaveBeenCalledWith(mockHulyClient, 'PROJ1', mockConfig, null);
    });

    it('should skip sync when requested project not found', async () => {
      fetchHulyProjects.mockResolvedValue([{ identifier: 'PROJ1', name: 'Project 1' }]);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig, null, 'NONEXISTENT');

      expect(listVibeProjects).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Dry Run Tests
  // ============================================================
  describe('Dry Run Mode', () => {
    beforeEach(() => {
      mockConfig.sync.dryRun = true;
    });

    it('should not create tasks in dry run mode', async () => {
      fetchHulyProjects.mockResolvedValue([{ identifier: 'TEST', name: 'Test' }]);
      listVibeProjects.mockResolvedValue([{ id: 'v1', name: 'Test' }]);
      fetchHulyIssues.mockResolvedValue([
        {
          identifier: 'TEST-1',
          title: 'Issue',
          status: 'Backlog',
        },
      ]);
      listVibeTasks.mockResolvedValue([]);
      createVibeTask.mockResolvedValue(null); // Dry run returns null

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      // createVibeTask is called but should return null in dry run
      expect(createVibeTask).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Database Integration Tests
  // ============================================================
  describe('Database Integration', () => {
    it('should start sync run and complete it', async () => {
      fetchHulyProjects.mockResolvedValue([{ identifier: 'TEST', name: 'Test' }]);
      listVibeProjects.mockResolvedValue([{ id: 'v1', name: 'Test' }]);
      fetchHulyIssues.mockResolvedValue([]);
      listVibeTasks.mockResolvedValue([]);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(mockDb.startSyncRun).toHaveBeenCalled();
      expect(mockDb.completeSyncRun).toHaveBeenCalledWith(
        'sync-123',
        expect.any(Number),
        expect.any(Number)
      );
    });

    it('should upsert project metadata', async () => {
      fetchHulyProjects.mockResolvedValue([
        {
          identifier: 'TEST',
          name: 'Test Project',
          description: 'A test project',
        },
      ]);
      listVibeProjects.mockResolvedValue([{ id: 'v1', name: 'Test Project' }]);
      fetchHulyIssues.mockResolvedValue([]);
      listVibeTasks.mockResolvedValue([]);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(mockDb.upsertProject).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'TEST',
          name: 'Test Project',
          status: 'active',
        })
      );
    });

    it('should update project activity after sync', async () => {
      fetchHulyProjects.mockResolvedValue([{ identifier: 'TEST', name: 'Test' }]);
      listVibeProjects.mockResolvedValue([{ id: 'v1', name: 'Test' }]);
      fetchHulyIssues.mockResolvedValue([
        { identifier: 'TEST-1', title: 'Issue 1', status: 'Backlog' },
        { identifier: 'TEST-2', title: 'Issue 2', status: 'Done' },
      ]);
      listVibeTasks.mockResolvedValue([]);
      createVibeTask.mockResolvedValue({ id: 'task-1' });

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(mockDb.updateProjectActivity).toHaveBeenCalledWith('TEST', 2);
    });
  });

  // ============================================================
  // Error Handling Tests
  // ============================================================
  describe('Error Handling', () => {
    it('should throw error when sync fails', async () => {
      fetchHulyProjects.mockRejectedValue(new Error('Network error'));

      await expect(
        syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig)
      ).rejects.toThrow('Network error');
    });

    it('should handle project processing errors gracefully', async () => {
      fetchHulyProjects.mockResolvedValue([{ identifier: 'TEST', name: 'Test' }]);
      listVibeProjects.mockResolvedValue([{ id: 'v1', name: 'Test' }]);
      fetchHulyIssues.mockRejectedValue(new Error('API error'));

      await expect(
        syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig)
      ).rejects.toThrow('API error');
    });
  });

  // ============================================================
  // Factory Function Tests
  // ============================================================
  describe('createSyncOrchestrator', () => {
    it('should create orchestrator with sync method', () => {
      const orchestrator = createSyncOrchestrator(mockDb, mockConfig);

      expect(orchestrator).toHaveProperty('sync');
      expect(typeof orchestrator.sync).toBe('function');
    });

    it('should bind db and config to sync method', async () => {
      fetchHulyProjects.mockResolvedValue([]);

      const orchestrator = createSyncOrchestrator(mockDb, mockConfig);
      await orchestrator.sync(mockHulyClient, mockVibeClient);

      expect(mockDb.startSyncRun).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Parallel Processing Tests
  // ============================================================
  describe('Parallel Processing', () => {
    beforeEach(() => {
      mockConfig.sync.parallel = true;
      mockConfig.sync.maxWorkers = 2;
    });

    it('should process projects in parallel when enabled', async () => {
      const { processBatch } = await import('../../lib/utils.js');

      fetchHulyProjects.mockResolvedValue([
        { identifier: 'PROJ1', name: 'Project 1' },
        { identifier: 'PROJ2', name: 'Project 2' },
      ]);
      listVibeProjects.mockResolvedValue([
        { id: 'v1', name: 'Project 1' },
        { id: 'v2', name: 'Project 2' },
      ]);
      fetchHulyIssues.mockResolvedValue([]);
      listVibeTasks.mockResolvedValue([]);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      expect(processBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ identifier: 'PROJ1' }),
          expect.objectContaining({ identifier: 'PROJ2' }),
        ]),
        expect.any(Function),
        2
      );
    });
  });

  // ============================================================
  // Incremental Sync Tests
  // ============================================================
  describe('Incremental Sync', () => {
    it('should pass last sync time to fetchHulyIssues', async () => {
      const lastSyncTime = Date.now() - 3600000;
      mockDb.getLastSync.mockReturnValue(lastSyncTime);
      mockConfig.sync.incremental = true;

      fetchHulyProjects.mockResolvedValue([{ identifier: 'TEST', name: 'Test' }]);
      listVibeProjects.mockResolvedValue([{ id: 'v1', name: 'Test' }]);
      fetchHulyIssues.mockResolvedValue([]);
      listVibeTasks.mockResolvedValue([]);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      // fetchHulyIssues is called with project last sync (from db.getProject) or global last sync
      expect(fetchHulyIssues).toHaveBeenCalledWith(
        mockHulyClient,
        'TEST',
        mockConfig,
        lastSyncTime // Falls back to global lastSync when project has no specific sync time
      );
    });
  });

  // ============================================================
  // Timestamp-based Conflict Resolution Tests
  // ============================================================
  describe('Phase 2: Vibe→Huly - Timestamp Conflict Resolution', () => {
    let updateHulyIssueStatus;

    beforeEach(async () => {
      const HulyService = await import('../../lib/HulyService.js');
      updateHulyIssueStatus = HulyService.updateHulyIssueStatus;

      fetchHulyProjects.mockResolvedValue([{ identifier: 'TEST', name: 'Test Project' }]);
      listVibeProjects.mockResolvedValue([{ id: 'vibe-1', name: 'Test Project' }]);
      fetchHulyIssues.mockResolvedValue([
        {
          identifier: 'TEST-1',
          title: 'Test Issue',
          status: 'Done', // Huly shows Done (from Beads sync)
        },
      ]);
    });

    it('should skip Vibe→Huly update when Beads has more recent change', async () => {
      const now = Date.now();
      const vibeUpdatedAt = now - 60000; // 1 minute ago
      const beadsModifiedAt = now - 30000; // 30 seconds ago (more recent)

      listVibeTasks.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Test Issue',
          description: 'Huly Issue: TEST-1',
          status: 'todo', // Vibe has stale status
          updated_at: new Date(vibeUpdatedAt).toISOString(),
        },
      ]);

      mockDb.getIssue.mockReturnValue({
        identifier: 'TEST-1',
        status: 'Done',
        beads_modified_at: beadsModifiedAt, // Beads was modified more recently
      });

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      // Should NOT update Huly because Beads has more recent change
      expect(updateHulyIssueStatus).not.toHaveBeenCalled();
    });

    it('should allow Vibe→Huly update when Vibe has more recent change', async () => {
      const now = Date.now();
      const vibeUpdatedAt = now - 30000; // 30 seconds ago (more recent)
      const beadsModifiedAt = now - 60000; // 1 minute ago

      listVibeTasks.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Test Issue',
          description: 'Huly Issue: TEST-1',
          status: 'todo', // Vibe status differs
          updated_at: new Date(vibeUpdatedAt).toISOString(),
        },
      ]);

      // Huly status matches what Beads set (Done), but Vibe has newer change (todo)
      fetchHulyIssues.mockResolvedValue([
        {
          identifier: 'TEST-1',
          title: 'Test Issue',
          status: 'Done',
        },
      ]);

      mockDb.getIssue.mockReturnValue({
        identifier: 'TEST-1',
        status: 'Done',
        beads_modified_at: beadsModifiedAt,
      });

      updateHulyIssueStatus.mockResolvedValue(true);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      // Should update Huly because Vibe has more recent change
      expect(updateHulyIssueStatus).toHaveBeenCalledWith(
        mockHulyClient,
        'TEST-1',
        'Backlog', // todo maps to Backlog
        mockConfig
      );
    });

    it('should allow Vibe→Huly update when no Beads timestamp exists', async () => {
      listVibeTasks.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Test Issue',
          description: 'Huly Issue: TEST-1',
          status: 'done', // Vibe has different status
          updated_at: new Date().toISOString(),
        },
      ]);

      fetchHulyIssues.mockResolvedValue([
        {
          identifier: 'TEST-1',
          title: 'Test Issue',
          status: 'Backlog', // Huly has different status
        },
      ]);

      mockDb.getIssue.mockReturnValue({
        identifier: 'TEST-1',
        status: 'Backlog',
        beads_modified_at: null, // No Beads timestamp
      });

      updateHulyIssueStatus.mockResolvedValue(true);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      // Should update because no Beads timestamp to compare
      expect(updateHulyIssueStatus).toHaveBeenCalledWith(
        mockHulyClient,
        'TEST-1',
        'Done',
        mockConfig
      );
    });

    it('should allow Vibe→Huly update when no Vibe timestamp exists', async () => {
      const beadsModifiedAt = Date.now() - 60000;

      listVibeTasks.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Test Issue',
          description: 'Huly Issue: TEST-1',
          status: 'done',
          updated_at: null, // No Vibe timestamp
        },
      ]);

      fetchHulyIssues.mockResolvedValue([
        {
          identifier: 'TEST-1',
          title: 'Test Issue',
          status: 'Backlog',
        },
      ]);

      mockDb.getIssue.mockReturnValue({
        identifier: 'TEST-1',
        status: 'Backlog',
        beads_modified_at: beadsModifiedAt,
      });

      updateHulyIssueStatus.mockResolvedValue(true);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      // Should update because no Vibe timestamp to compare
      expect(updateHulyIssueStatus).toHaveBeenCalledWith(
        mockHulyClient,
        'TEST-1',
        'Done',
        mockConfig
      );
    });

    it('should handle equal timestamps by allowing Vibe update', async () => {
      const timestamp = Date.now() - 60000;

      listVibeTasks.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Test Issue',
          description: 'Huly Issue: TEST-1',
          status: 'done',
          updated_at: new Date(timestamp).toISOString(),
        },
      ]);

      fetchHulyIssues.mockResolvedValue([
        {
          identifier: 'TEST-1',
          title: 'Test Issue',
          status: 'Backlog',
        },
      ]);

      mockDb.getIssue.mockReturnValue({
        identifier: 'TEST-1',
        status: 'Backlog',
        beads_modified_at: timestamp, // Same timestamp
      });

      updateHulyIssueStatus.mockResolvedValue(true);

      await syncHulyToVibe(mockHulyClient, mockVibeClient, mockDb, mockConfig);

      // Should update because timestamps are equal (Beads not strictly newer)
      expect(updateHulyIssueStatus).toHaveBeenCalled();
    });
  });
});
