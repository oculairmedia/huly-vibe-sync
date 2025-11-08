/**
 * Unit Tests for VibeService
 *
 * Tests all Vibe Kanban-specific service operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listVibeProjects,
  createVibeProject,
  listVibeTasks,
  createVibeTask,
  updateVibeTaskStatus,
  updateVibeTaskDescription,
} from '../../lib/VibeService.js';
import fs from 'fs';

// Mock the HealthService
vi.mock('../../lib/HealthService.js', () => ({
  recordApiLatency: vi.fn(),
}));

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
  },
}));

describe('VibeService', () => {
  let mockVibeClient;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    // Create a fresh mock client for each test
    mockVibeClient = {
      listProjects: vi.fn(),
      createProject: vi.fn(),
      listTasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
    };

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset fs mock
    fs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listVibeProjects', () => {
    it('should list projects successfully', async () => {
      const mockProjects = [
        { id: 1, name: 'Project 1', git_repo_path: '/path/1' },
        { id: 2, name: 'Project 2', git_repo_path: '/path/2' },
      ];

      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await listVibeProjects(mockVibeClient);

      expect(result).toEqual(mockProjects);
      expect(result).toHaveLength(2);
      expect(mockVibeClient.listProjects).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 2 existing projects')
      );
    });

    it('should return empty array on error', async () => {
      mockVibeClient.listProjects.mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await listVibeProjects(mockVibeClient);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error listing projects'),
        expect.stringContaining('Connection refused')
      );
    });

    it('should handle empty project list', async () => {
      mockVibeClient.listProjects.mockResolvedValue([]);

      const result = await listVibeProjects(mockVibeClient);

      expect(result).toEqual([]);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 0 existing projects')
      );
    });
  });

  describe('createVibeProject', () => {
    const mockHulyProject = {
      identifier: 'TEST',
      name: 'Test Project',
      description: 'Git repo: /opt/stacks/test-project',
    };

    it('should create project successfully', async () => {
      const mockCreatedProject = {
        id: 1,
        name: 'Test Project',
        git_repo_path: '/opt/stacks/test-project',
      };

      mockVibeClient.createProject.mockResolvedValue(mockCreatedProject);

      const result = await createVibeProject(
        mockVibeClient,
        mockHulyProject
      );

      expect(result).toEqual(mockCreatedProject);
      expect(mockVibeClient.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Project',
          git_repo_path: expect.any(String),
          use_existing_repo: false,
        })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Created project')
      );
    });

    it('should skip creation in dry run mode', async () => {
      const result = await createVibeProject(
        mockVibeClient,
        mockHulyProject,
        { sync: { dryRun: true } }
      );

      expect(result).toBeNull();
      expect(mockVibeClient.createProject).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should detect existing git repository', async () => {
      fs.existsSync.mockReturnValue(true);

      mockVibeClient.createProject.mockResolvedValue({
        id: 1,
        name: 'Test Project',
      });

      await createVibeProject(mockVibeClient, mockHulyProject);

      expect(mockVibeClient.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          use_existing_repo: true,
        })
      );
    });

    it('should return null on error', async () => {
      mockVibeClient.createProject.mockRejectedValue(
        new Error('Validation failed')
      );

      const result = await createVibeProject(
        mockVibeClient,
        mockHulyProject
      );

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Error creating project'),
        expect.stringContaining('Validation failed')
      );
    });

    it('should extract git repo path from description', async () => {
      const projectWithPath = {
        ...mockHulyProject,
        description: 'Some text\nGit repo: /custom/path\nMore text',
      };

      mockVibeClient.createProject.mockResolvedValue({ id: 1 });

      await createVibeProject(mockVibeClient, projectWithPath);

      expect(mockVibeClient.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          git_repo_path: expect.stringContaining('/custom/path'),
        })
      );
    });
  });

  describe('listVibeTasks', () => {
    const projectId = 123;

    it('should list tasks for project', async () => {
      const mockTasks = [
        { id: 1, title: 'Task 1', status: 'todo', description: '' },
        { id: 2, title: 'Task 2', status: 'inprogress', description: '' },
      ];

      mockVibeClient.listTasks.mockResolvedValue(mockTasks);

      const result = await listVibeTasks(mockVibeClient, projectId);

      expect(result).toEqual(mockTasks);
      expect(result).toHaveLength(2);
      expect(mockVibeClient.listTasks).toHaveBeenCalledWith(projectId);
    });

    it('should return empty array on error', async () => {
      mockVibeClient.listTasks.mockRejectedValue(new Error('Not found'));

      const result = await listVibeTasks(mockVibeClient, projectId);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Error listing tasks for project ${projectId}`),
        expect.stringContaining('Not found')
      );
    });

    it('should handle null response', async () => {
      mockVibeClient.listTasks.mockResolvedValue(null);

      const result = await listVibeTasks(mockVibeClient, projectId);

      expect(result).toEqual([]);
    });
  });

  describe('createVibeTask', () => {
    const projectId = 123;
    const mockHulyIssue = {
      identifier: 'TEST-1',
      title: 'Test Issue',
      description: 'Issue description',
      status: 'Backlog',
      priority: 'high',
    };

    it('should create task successfully', async () => {
      const mockCreatedTask = {
        id: 1,
        title: 'TEST-1: Test Issue',
        description: expect.any(String),
        status: 'todo',
      };

      mockVibeClient.createTask.mockResolvedValue(mockCreatedTask);

      const result = await createVibeTask(
        mockVibeClient,
        projectId,
        mockHulyIssue
      );

      expect(result).toEqual(mockCreatedTask);
      expect(mockVibeClient.createTask).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          title: 'TEST-1: Test Issue',
          status: 'todo',
        })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Created task')
      );
    });

    it('should skip creation in dry run mode', async () => {
      const result = await createVibeTask(
        mockVibeClient,
        projectId,
        mockHulyIssue,
        { sync: { dryRun: true } }
      );

      expect(result).toBeNull();
      expect(mockVibeClient.createTask).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should map Huly status to Vibe status', async () => {
      mockVibeClient.createTask.mockResolvedValue({ id: 1 });

      await createVibeTask(mockVibeClient, projectId, {
        ...mockHulyIssue,
        status: 'In Progress',
      });

      expect(mockVibeClient.createTask).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          status: 'inprogress',
        })
      );
    });

    it('should include Huly identifier in description footer', async () => {
      mockVibeClient.createTask.mockResolvedValue({ id: 1 });

      await createVibeTask(mockVibeClient, projectId, mockHulyIssue);

      expect(mockVibeClient.createTask).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          description: expect.stringContaining('Huly Issue: TEST-1'),
        })
      );
    });

    it('should return null on error', async () => {
      mockVibeClient.createTask.mockRejectedValue(
        new Error('Duplicate task')
      );

      const result = await createVibeTask(
        mockVibeClient,
        projectId,
        mockHulyIssue
      );

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Error creating task'),
        expect.stringContaining('Duplicate task')
      );
    });
  });

  describe('updateVibeTaskStatus', () => {
    const taskId = 456;
    const newStatus = 'done';

    it('should update task status successfully', async () => {
      mockVibeClient.updateTask.mockResolvedValue({ id: taskId });

      const result = await updateVibeTaskStatus(
        mockVibeClient,
        taskId,
        newStatus
      );

      expect(result).toBe(true);
      expect(mockVibeClient.updateTask).toHaveBeenCalledWith(
        taskId,
        expect.objectContaining({ status: newStatus })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Updated task status')
      );
    });

    it('should skip update in dry run mode', async () => {
      const result = await updateVibeTaskStatus(
        mockVibeClient,
        taskId,
        newStatus,
        { sync: { dryRun: true } }
      );

      expect(result).toBe(true);
      expect(mockVibeClient.updateTask).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should return false on error', async () => {
      mockVibeClient.updateTask.mockRejectedValue(
        new Error('Task not found')
      );

      const result = await updateVibeTaskStatus(
        mockVibeClient,
        taskId,
        newStatus
      );

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Error updating task status'),
        expect.stringContaining('Task not found')
      );
    });
  });

  describe('updateVibeTaskDescription', () => {
    const taskId = 456;
    const newDescription = 'Updated description';

    it('should update task description successfully', async () => {
      mockVibeClient.updateTask.mockResolvedValue({ id: taskId });

      const result = await updateVibeTaskDescription(
        mockVibeClient,
        taskId,
        newDescription
      );

      expect(result).toBe(true);
      expect(mockVibeClient.updateTask).toHaveBeenCalledWith(
        taskId,
        expect.objectContaining({ description: newDescription })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Updated task description')
      );
    });

    it('should skip update in dry run mode', async () => {
      const result = await updateVibeTaskDescription(
        mockVibeClient,
        taskId,
        newDescription,
        { sync: { dryRun: true } }
      );

      expect(result).toBe(true);
      expect(mockVibeClient.updateTask).not.toHaveBeenCalled();
    });

    it('should return false on error', async () => {
      mockVibeClient.updateTask.mockRejectedValue(new Error('Failed'));

      const result = await updateVibeTaskDescription(
        mockVibeClient,
        taskId,
        newDescription
      );

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Error updating task description'),
        expect.stringContaining('Failed')
      );
    });

    it('should handle empty description', async () => {
      mockVibeClient.updateTask.mockResolvedValue({ id: taskId });

      await updateVibeTaskDescription(mockVibeClient, taskId, '');

      expect(mockVibeClient.updateTask).toHaveBeenCalledWith(
        taskId,
        expect.objectContaining({ description: '' })
      );
    });
  });

  describe('edge cases', () => {
    it('should handle very long task titles', async () => {
      const longTitle = 'A'.repeat(500);
      mockVibeClient.createTask.mockResolvedValue({ id: 1 });

      await createVibeTask(mockVibeClient, 1, {
        identifier: 'TEST-1',
        title: longTitle,
        description: '',
        status: 'Backlog',
      });

      expect(mockVibeClient.createTask).toHaveBeenCalled();
    });

    it('should handle special characters in project name', async () => {
      mockVibeClient.createProject.mockResolvedValue({ id: 1 });

      await createVibeProject(mockVibeClient, {
        identifier: 'TEST',
        name: 'Test & "Special" <Characters>',
        description: '',
      });

      expect(mockVibeClient.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test & "Special" <Characters>',
        })
      );
    });
  });
});
