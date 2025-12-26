/**
 * Unit Tests for VibeService
 * 
 * Tests Vibe Kanban-specific operations including:
 * - Listing and creating projects
 * - Creating and updating tasks
 * - Task status and description management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listVibeProjects,
  createVibeProject,
  listVibeTasks,
  createVibeTask,
  updateVibeTaskStatus,
  updateVibeTaskDescription,
  createVibeService,
} from '../../lib/VibeService.js';

// Mock the HealthService to avoid side effects
vi.mock('../../lib/HealthService.js', () => ({
  recordApiLatency: vi.fn(),
}));

// Mock the textParsers
vi.mock('../../lib/textParsers.js', () => ({
  determineGitRepoPath: vi.fn((project) => `/home/user/projects/${project.name.toLowerCase().replace(/\s+/g, '-')}`),
}));

describe('VibeService', () => {
  let mockVibeClient;
  let consoleSpy;

  beforeEach(() => {
    // Create mock Vibe client
    mockVibeClient = {
      listProjects: vi.fn(),
      createProject: vi.fn(),
      listTasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
    };

    // Suppress console output during tests
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // listVibeProjects Tests
  // ============================================================
  describe('listVibeProjects', () => {
    it('should list projects successfully', async () => {
      const mockProjects = [
        { id: 'proj-1', name: 'Project 1' },
        { id: 'proj-2', name: 'Project 2' },
      ];
      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await listVibeProjects(mockVibeClient);

      expect(mockVibeClient.listProjects).toHaveBeenCalled();
      expect(result).toEqual(mockProjects);
      expect(result).toHaveLength(2);
    });

    it('should return empty array on error', async () => {
      mockVibeClient.listProjects.mockRejectedValue(new Error('Network error'));

      const result = await listVibeProjects(mockVibeClient);

      expect(result).toEqual([]);
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should log project count', async () => {
      mockVibeClient.listProjects.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);

      await listVibeProjects(mockVibeClient);

      expect(consoleSpy.log).toHaveBeenCalledWith('[Vibe] Found 3 existing projects');
    });
  });

  // ============================================================
  // createVibeProject Tests
  // ============================================================
  describe('createVibeProject', () => {
    const hulyProject = {
      name: 'Test Project',
      identifier: 'TEST',
      description: 'A test project',
    };

    it('should create project successfully', async () => {
      const createdProject = { id: 'vibe-proj-1', name: 'Test Project' };
      mockVibeClient.createProject.mockResolvedValue(createdProject);

      const result = await createVibeProject(mockVibeClient, hulyProject);

      expect(mockVibeClient.createProject).toHaveBeenCalledWith({
        name: 'Test Project',
        repositories: [
          {
            display_name: 'test-project',
            git_repo_path: '/home/user/projects/test-project',
          }
        ],
      });
      expect(result).toEqual(createdProject);
    });

    it('should return null and log in dry run mode', async () => {
      const result = await createVibeProject(mockVibeClient, hulyProject, { sync: { dryRun: true } });

      expect(mockVibeClient.createProject).not.toHaveBeenCalled();
      expect(result).toBeNull();
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should return null on error', async () => {
      mockVibeClient.createProject.mockRejectedValue(new Error('API error'));

      const result = await createVibeProject(mockVibeClient, hulyProject);

      expect(result).toBeNull();
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should handle project name with spaces', async () => {
      const projectWithSpaces = { name: 'My Awesome Project' };
      mockVibeClient.createProject.mockResolvedValue({ id: '1' });

      await createVibeProject(mockVibeClient, projectWithSpaces);

      expect(mockVibeClient.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Awesome Project',
          repositories: expect.arrayContaining([
            expect.objectContaining({
              display_name: 'my-awesome-project',
            })
          ]),
        })
      );
    });
  });

  // ============================================================
  // listVibeTasks Tests
  // ============================================================
  describe('listVibeTasks', () => {
    it('should list tasks for a project', async () => {
      const mockTasks = [
        { id: 'task-1', title: 'Task 1' },
        { id: 'task-2', title: 'Task 2' },
      ];
      mockVibeClient.listTasks.mockResolvedValue(mockTasks);

      const result = await listVibeTasks(mockVibeClient, 'proj-1');

      expect(mockVibeClient.listTasks).toHaveBeenCalledWith('proj-1');
      expect(result).toEqual(mockTasks);
    });

    it('should return empty array on error', async () => {
      mockVibeClient.listTasks.mockRejectedValue(new Error('API error'));

      const result = await listVibeTasks(mockVibeClient, 'proj-1');

      expect(result).toEqual([]);
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should return empty array if API returns null', async () => {
      mockVibeClient.listTasks.mockResolvedValue(null);

      const result = await listVibeTasks(mockVibeClient, 'proj-1');

      expect(result).toEqual([]);
    });

    it('should return empty array if API returns undefined', async () => {
      mockVibeClient.listTasks.mockResolvedValue(undefined);

      const result = await listVibeTasks(mockVibeClient, 'proj-1');

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // createVibeTask Tests
  // ============================================================
  describe('createVibeTask', () => {
    const hulyIssue = {
      identifier: 'TEST-1',
      title: 'Test Issue',
      description: 'Issue description',
      status: 'In Progress',
    };

    it('should create task successfully', async () => {
      const createdTask = { id: 'task-1', title: 'Test Issue' };
      mockVibeClient.createTask.mockResolvedValue(createdTask);

      const result = await createVibeTask(mockVibeClient, 'proj-1', hulyIssue);

      expect(mockVibeClient.createTask).toHaveBeenCalledWith('proj-1', {
        title: 'Test Issue',
        description: 'Issue description\n\n---\nHuly Issue: TEST-1',
        status: 'inprogress', // mapHulyStatusToVibe('In Progress')
      });
      expect(result).toEqual(createdTask);
    });

    it('should return null and log in dry run mode', async () => {
      const result = await createVibeTask(
        mockVibeClient,
        'proj-1',
        hulyIssue,
        { sync: { dryRun: true } }
      );

      expect(mockVibeClient.createTask).not.toHaveBeenCalled();
      expect(result).toBeNull();
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should return null on error', async () => {
      mockVibeClient.createTask.mockRejectedValue(new Error('API error'));

      const result = await createVibeTask(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toBeNull();
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should handle issue without description', async () => {
      const issueNoDesc = {
        identifier: 'TEST-2',
        title: 'No Description Issue',
        description: null,
        status: 'Backlog',
      };
      mockVibeClient.createTask.mockResolvedValue({ id: 'task-2' });

      await createVibeTask(mockVibeClient, 'proj-1', issueNoDesc);

      expect(mockVibeClient.createTask).toHaveBeenCalledWith('proj-1', {
        title: 'No Description Issue',
        description: 'Synced from Huly: TEST-2',
        status: 'todo',
      });
    });

    it('should handle issue with empty description', async () => {
      const issueEmptyDesc = {
        identifier: 'TEST-3',
        title: 'Empty Description Issue',
        description: '',
        status: 'Done',
      };
      mockVibeClient.createTask.mockResolvedValue({ id: 'task-3' });

      await createVibeTask(mockVibeClient, 'proj-1', issueEmptyDesc);

      expect(mockVibeClient.createTask).toHaveBeenCalledWith('proj-1', {
        title: 'Empty Description Issue',
        description: 'Synced from Huly: TEST-3',
        status: 'done',
      });
    });

    it('should map various Huly statuses to Vibe statuses', async () => {
      mockVibeClient.createTask.mockResolvedValue({ id: 'task-1' });

      const testCases = [
        { hulyStatus: 'Backlog', expectedVibeStatus: 'todo' },
        { hulyStatus: 'In Progress', expectedVibeStatus: 'inprogress' },
        { hulyStatus: 'In Review', expectedVibeStatus: 'inreview' },
        { hulyStatus: 'Done', expectedVibeStatus: 'done' },
        { hulyStatus: 'Cancelled', expectedVibeStatus: 'cancelled' },
      ];

      for (const { hulyStatus, expectedVibeStatus } of testCases) {
        mockVibeClient.createTask.mockClear();
        
        await createVibeTask(mockVibeClient, 'proj-1', {
          identifier: 'TEST-1',
          title: 'Test',
          description: 'Test',
          status: hulyStatus,
        });

        expect(mockVibeClient.createTask).toHaveBeenCalledWith(
          'proj-1',
          expect.objectContaining({ status: expectedVibeStatus })
        );
      }
    });
  });

  // ============================================================
  // updateVibeTaskStatus Tests
  // ============================================================
  describe('updateVibeTaskStatus', () => {
    it('should update task status successfully', async () => {
      mockVibeClient.updateTask.mockResolvedValue({ success: true });

      await updateVibeTaskStatus(mockVibeClient, 'task-1', 'done');

      expect(mockVibeClient.updateTask).toHaveBeenCalledWith('task-1', 'status', 'done');
      expect(consoleSpy.log).toHaveBeenCalledWith(
        '[Vibe] ✓ Updated task task-1 status to: done'
      );
    });

    it('should skip update in dry run mode', async () => {
      await updateVibeTaskStatus(
        mockVibeClient,
        'task-1',
        'done',
        { sync: { dryRun: true } }
      );

      expect(mockVibeClient.updateTask).not.toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should log error on failure', async () => {
      mockVibeClient.updateTask.mockRejectedValue(new Error('Update failed'));

      await updateVibeTaskStatus(mockVibeClient, 'task-1', 'done');

      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should handle various status values', async () => {
      mockVibeClient.updateTask.mockResolvedValue({ success: true });

      const statuses = ['todo', 'inprogress', 'inreview', 'done', 'cancelled'];
      
      for (const status of statuses) {
        mockVibeClient.updateTask.mockClear();
        
        await updateVibeTaskStatus(mockVibeClient, 'task-1', status);

        expect(mockVibeClient.updateTask).toHaveBeenCalledWith('task-1', 'status', status);
      }
    });
  });

  // ============================================================
  // updateVibeTaskDescription Tests
  // ============================================================
  describe('updateVibeTaskDescription', () => {
    it('should update task description successfully', async () => {
      mockVibeClient.updateTask.mockResolvedValue({ success: true });

      await updateVibeTaskDescription(mockVibeClient, 'task-1', 'New description');

      expect(mockVibeClient.updateTask).toHaveBeenCalledWith(
        'task-1',
        'description',
        'New description'
      );
      expect(consoleSpy.log).toHaveBeenCalledWith('[Vibe] ✓ Updated task task-1 description');
    });

    it('should skip update in dry run mode', async () => {
      await updateVibeTaskDescription(
        mockVibeClient,
        'task-1',
        'New description',
        { sync: { dryRun: true } }
      );

      expect(mockVibeClient.updateTask).not.toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should log error on failure', async () => {
      mockVibeClient.updateTask.mockRejectedValue(new Error('Update failed'));

      await updateVibeTaskDescription(mockVibeClient, 'task-1', 'New description');

      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should handle empty description', async () => {
      mockVibeClient.updateTask.mockResolvedValue({ success: true });

      await updateVibeTaskDescription(mockVibeClient, 'task-1', '');

      expect(mockVibeClient.updateTask).toHaveBeenCalledWith('task-1', 'description', '');
    });

    it('should handle multiline description', async () => {
      mockVibeClient.updateTask.mockResolvedValue({ success: true });
      const multilineDesc = 'Line 1\n\nLine 2\n\n---\nFooter';

      await updateVibeTaskDescription(mockVibeClient, 'task-1', multilineDesc);

      expect(mockVibeClient.updateTask).toHaveBeenCalledWith(
        'task-1',
        'description',
        multilineDesc
      );
    });
  });

  // ============================================================
  // createVibeService Factory Tests
  // ============================================================
  describe('createVibeService', () => {
    it('should create service with all methods', () => {
      const config = { sync: { dryRun: false } };
      const service = createVibeService(config);

      expect(service).toHaveProperty('listProjects');
      expect(service).toHaveProperty('createProject');
      expect(service).toHaveProperty('listTasks');
      expect(service).toHaveProperty('createTask');
      expect(service).toHaveProperty('updateTaskStatus');
      expect(service).toHaveProperty('updateTaskDescription');
    });

    it('should pass config to createProject (dry run)', async () => {
      const config = { sync: { dryRun: true } };
      const service = createVibeService(config);

      const result = await service.createProject(mockVibeClient, { name: 'Test' });

      expect(mockVibeClient.createProject).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should pass config to createTask (dry run)', async () => {
      const config = { sync: { dryRun: true } };
      const service = createVibeService(config);

      const result = await service.createTask(
        mockVibeClient,
        'proj-1',
        { identifier: 'TEST-1', title: 'Test', status: 'Backlog' }
      );

      expect(mockVibeClient.createTask).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should pass config to updateTaskStatus (dry run)', async () => {
      const config = { sync: { dryRun: true } };
      const service = createVibeService(config);

      await service.updateTaskStatus(mockVibeClient, 'task-1', 'done');

      expect(mockVibeClient.updateTask).not.toHaveBeenCalled();
    });

    it('should pass config to updateTaskDescription (dry run)', async () => {
      const config = { sync: { dryRun: true } };
      const service = createVibeService(config);

      await service.updateTaskDescription(mockVibeClient, 'task-1', 'New desc');

      expect(mockVibeClient.updateTask).not.toHaveBeenCalled();
    });

    it('should call listProjects without config dependency', async () => {
      const service = createVibeService({});
      mockVibeClient.listProjects.mockResolvedValue([]);

      await service.listProjects(mockVibeClient);

      expect(mockVibeClient.listProjects).toHaveBeenCalled();
    });

    it('should call listTasks without config dependency', async () => {
      const service = createVibeService({});
      mockVibeClient.listTasks.mockResolvedValue([]);

      await service.listTasks(mockVibeClient, 'proj-1');

      expect(mockVibeClient.listTasks).toHaveBeenCalledWith('proj-1');
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================
  describe('Edge Cases', () => {
    it('should handle undefined config', async () => {
      mockVibeClient.createProject.mockResolvedValue({ id: '1' });

      const result = await createVibeProject(mockVibeClient, { name: 'Test' });

      expect(result).toEqual({ id: '1' });
    });

    it('should handle config without sync property', async () => {
      mockVibeClient.createTask.mockResolvedValue({ id: '1' });

      const result = await createVibeTask(
        mockVibeClient,
        'proj-1',
        { identifier: 'TEST-1', title: 'Test', status: 'Backlog' },
        {}
      );

      expect(result).toEqual({ id: '1' });
    });

    it('should handle project with very long name', async () => {
      const longName = 'A'.repeat(200);
      mockVibeClient.createProject.mockResolvedValue({ id: '1' });

      await createVibeProject(mockVibeClient, { name: longName });

      expect(mockVibeClient.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: longName })
      );
    });

    it('should handle special characters in issue title', async () => {
      mockVibeClient.createTask.mockResolvedValue({ id: '1' });

      await createVibeTask(mockVibeClient, 'proj-1', {
        identifier: 'TEST-1',
        title: 'Fix: "bug" in <component> & more',
        description: 'Test',
        status: 'Backlog',
      });

      expect(mockVibeClient.createTask).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({
          title: 'Fix: "bug" in <component> & more',
        })
      );
    });
  });
});
