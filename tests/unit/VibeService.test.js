/**
 * Unit Tests for VibeService
 *
 * Tests Vibe Kanban-specific operations including:
 * - Listing and creating projects
 * - Creating and updating tasks
 * - Task status and description management
 * - Deduplication logic for projects and tasks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listVibeProjects,
  findVibeProjectByName,
  createVibeProject,
  listVibeTasks,
  findVibeTaskByHulyIssue,
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
  determineGitRepoPath: vi.fn(project => {
    if (project.description) {
      const patterns = [/(?:Path|Filesystem|Directory|Location):\s*([^\n\r]+)/i];
      for (const pattern of patterns) {
        const match = project.description.match(pattern);
        if (match) {
          return match[1].trim();
        }
      }
    }
    return `/home/user/projects/${project.name.toLowerCase().replace(/\s+/g, '-')}`;
  }),
  validateGitRepoPath: vi.fn(() => ({ valid: true })),
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
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
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
  // findVibeProjectByName Tests (DEDUPLICATION LOGIC)
  // ============================================================
  describe('findVibeProjectByName', () => {
    it('should find project by exact name match', async () => {
      const mockProjects = [
        { id: 'proj-1', name: 'Test Project' },
        { id: 'proj-2', name: 'Another Project' },
      ];
      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await findVibeProjectByName(mockVibeClient, 'Test Project');

      expect(result).toEqual({ id: 'proj-1', name: 'Test Project' });
    });

    it('should find project with case-insensitive match', async () => {
      const mockProjects = [
        { id: 'proj-1', name: 'Test Project' },
        { id: 'proj-2', name: 'Another Project' },
      ];
      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await findVibeProjectByName(mockVibeClient, 'test project');

      expect(result).toEqual({ id: 'proj-1', name: 'Test Project' });
    });

    it('should find project with uppercase search', async () => {
      const mockProjects = [{ id: 'proj-1', name: 'Test Project' }];
      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await findVibeProjectByName(mockVibeClient, 'TEST PROJECT');

      expect(result).toEqual({ id: 'proj-1', name: 'Test Project' });
    });

    it('should find project with mixed case', async () => {
      const mockProjects = [{ id: 'proj-1', name: 'MyAwesomeProject' }];
      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await findVibeProjectByName(mockVibeClient, 'myawesomeproject');

      expect(result).toEqual({ id: 'proj-1', name: 'MyAwesomeProject' });
    });

    it('should normalize whitespace in search', async () => {
      const mockProjects = [{ id: 'proj-1', name: 'Test Project' }];
      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await findVibeProjectByName(mockVibeClient, '  Test Project  ');

      expect(result).toEqual({ id: 'proj-1', name: 'Test Project' });
    });

    it('should normalize whitespace in project names', async () => {
      const mockProjects = [{ id: 'proj-1', name: '  Test Project  ' }];
      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await findVibeProjectByName(mockVibeClient, 'Test Project');

      expect(result).toEqual({ id: 'proj-1', name: '  Test Project  ' });
    });

    it('should return null when project not found', async () => {
      const mockProjects = [{ id: 'proj-1', name: 'Test Project' }];
      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await findVibeProjectByName(mockVibeClient, 'Nonexistent Project');

      expect(result).toBeNull();
    });

    it('should return null when project list is empty', async () => {
      mockVibeClient.listProjects.mockResolvedValue([]);

      const result = await findVibeProjectByName(mockVibeClient, 'Test Project');

      expect(result).toBeNull();
    });

    it('should return null on API error', async () => {
      mockVibeClient.listProjects.mockRejectedValue(new Error('API error'));

      const result = await findVibeProjectByName(mockVibeClient, 'Test Project');

      expect(result).toBeNull();
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should handle empty string search', async () => {
      const mockProjects = [{ id: 'proj-1', name: 'Test Project' }];
      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await findVibeProjectByName(mockVibeClient, '');

      expect(result).toBeNull();
    });

    it('should handle null search', async () => {
      const mockProjects = [{ id: 'proj-1', name: 'Test Project' }];
      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await findVibeProjectByName(mockVibeClient, null);

      expect(result).toBeNull();
    });

    it('should return first match when multiple projects have same normalized name', async () => {
      const mockProjects = [
        { id: 'proj-1', name: 'Test Project' },
        { id: 'proj-2', name: 'test project' },
        { id: 'proj-3', name: 'TEST PROJECT' },
      ];
      mockVibeClient.listProjects.mockResolvedValue(mockProjects);

      const result = await findVibeProjectByName(mockVibeClient, 'Test Project');

      expect(result).toEqual({ id: 'proj-1', name: 'Test Project' });
    });
  });

  // ============================================================
  // createVibeProject Tests (GIT PATH EXTRACTION)
  // ============================================================
  describe('createVibeProject', () => {
    const hulyProject = {
      name: 'Test Project',
      identifier: 'TEST',
      description: 'A test project',
    };

    it('should create project successfully', async () => {
      const createdProject = { id: 'vibe-proj-1', name: 'Test Project' };
      mockVibeClient.listProjects.mockResolvedValue([]);
      mockVibeClient.createProject.mockResolvedValue(createdProject);

      const result = await createVibeProject(mockVibeClient, hulyProject);

      expect(mockVibeClient.createProject).toHaveBeenCalledWith({
        name: 'Test Project',
        repositories: [
          {
            display_name: 'test-project',
            git_repo_path: '/home/user/projects/test-project',
          },
        ],
      });
      expect(result).toEqual(createdProject);
    });

    it('should extract git path from Huly description (Filesystem field)', async () => {
      const projectWithPath = {
        name: 'My Project',
        identifier: 'MYPROJ',
        description: 'Project description\n\nFilesystem: /opt/stacks/my-project',
      };
      mockVibeClient.listProjects.mockResolvedValue([]);
      mockVibeClient.createProject.mockResolvedValue({ id: 'proj-1' });

      await createVibeProject(mockVibeClient, projectWithPath);

      expect(mockVibeClient.createProject).toHaveBeenCalledWith({
        name: 'My Project',
        repositories: [
          {
            display_name: 'my-project',
            git_repo_path: '/opt/stacks/my-project',
          },
        ],
      });
    });

    it('should extract git path with Path: prefix', async () => {
      const projectWithPath = {
        name: 'Another Project',
        identifier: 'ANOTHER',
        description: 'Path: /home/user/repos/another-project',
      };
      mockVibeClient.listProjects.mockResolvedValue([]);
      mockVibeClient.createProject.mockResolvedValue({ id: 'proj-1' });

      await createVibeProject(mockVibeClient, projectWithPath);

      expect(mockVibeClient.createProject).toHaveBeenCalledWith({
        name: 'Another Project',
        repositories: [
          {
            display_name: 'another-project',
            git_repo_path: '/home/user/repos/another-project',
          },
        ],
      });
    });

    it('should use display name from last path component', async () => {
      const projectWithPath = {
        name: 'Complex Project',
        identifier: 'COMPLEX',
        description: 'Filesystem: /opt/stacks/deeply/nested/project-name',
      };
      mockVibeClient.listProjects.mockResolvedValue([]);
      mockVibeClient.createProject.mockResolvedValue({ id: 'proj-1' });

      await createVibeProject(mockVibeClient, projectWithPath);

      expect(mockVibeClient.createProject).toHaveBeenCalledWith({
        name: 'Complex Project',
        repositories: [
          {
            display_name: 'project-name',
            git_repo_path: '/opt/stacks/deeply/nested/project-name',
          },
        ],
      });
    });

    it('should skip creation if project already exists (deduplication)', async () => {
      const existingProject = { id: 'existing-1', name: 'Test Project' };
      mockVibeClient.listProjects.mockResolvedValue([existingProject]);

      const result = await createVibeProject(mockVibeClient, hulyProject);

      expect(mockVibeClient.createProject).not.toHaveBeenCalled();
      expect(result).toEqual(existingProject);
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Found existing project')
      );
    });

    it('should skip creation if project exists with different case', async () => {
      const existingProject = { id: 'existing-1', name: 'test project' };
      mockVibeClient.listProjects.mockResolvedValue([existingProject]);

      const result = await createVibeProject(mockVibeClient, hulyProject);

      expect(mockVibeClient.createProject).not.toHaveBeenCalled();
      expect(result).toEqual(existingProject);
    });

    it('should return null and log in dry run mode', async () => {
      const result = await createVibeProject(mockVibeClient, hulyProject, {
        sync: { dryRun: true },
      });

      expect(mockVibeClient.createProject).not.toHaveBeenCalled();
      expect(mockVibeClient.listProjects).not.toHaveBeenCalled();
      expect(result).toBeNull();
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN]'));
    });

    it('should return null on error', async () => {
      mockVibeClient.listProjects.mockResolvedValue([]);
      mockVibeClient.createProject.mockRejectedValue(new Error('API error'));

      const result = await createVibeProject(mockVibeClient, hulyProject);

      expect(result).toBeNull();
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should handle project name with spaces', async () => {
      const projectWithSpaces = { name: 'My Awesome Project', identifier: 'MAP' };
      mockVibeClient.listProjects.mockResolvedValue([]);
      mockVibeClient.createProject.mockResolvedValue({ id: '1' });

      await createVibeProject(mockVibeClient, projectWithSpaces);

      expect(mockVibeClient.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Awesome Project',
          repositories: expect.arrayContaining([
            expect.objectContaining({
              display_name: 'my-awesome-project',
            }),
          ]),
        })
      );
    });

    it('should skip project creation when repo path validation fails', async () => {
      const { validateGitRepoPath } = await import('../../lib/textParsers.js');
      validateGitRepoPath.mockReturnValueOnce({
        valid: false,
        reason: 'path does not exist on disk: /bad/path',
      });
      mockVibeClient.listProjects.mockResolvedValue([]);

      const result = await createVibeProject(mockVibeClient, hulyProject);

      expect(result).toBeNull();
      expect(mockVibeClient.createProject).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping project Test Project')
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
  // findVibeTaskByHulyIssue Tests (DEDUPLICATION LOGIC)
  // ============================================================
  describe('findVibeTaskByHulyIssue', () => {
    it('should find task by Huly identifier in description', async () => {
      const mockTasks = [
        { id: 'task-1', title: 'Task 1', description: 'Some description\n\nHuly Issue: TEST-123' },
        { id: 'task-2', title: 'Task 2', description: 'Another task' },
      ];
      mockVibeClient.listTasks.mockResolvedValue(mockTasks);

      const hulyIssue = { identifier: 'TEST-123', title: 'Task 1' };
      const result = await findVibeTaskByHulyIssue(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toEqual(mockTasks[0]);
    });

    it('should find task by "Synced from Huly" identifier', async () => {
      const mockTasks = [
        { id: 'task-1', title: 'Task 1', description: 'Synced from Huly: TEST-456' },
      ];
      mockVibeClient.listTasks.mockResolvedValue(mockTasks);

      const hulyIssue = { identifier: 'TEST-456', title: 'Task 1' };
      const result = await findVibeTaskByHulyIssue(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toEqual(mockTasks[0]);
    });

    it('should find task by normalized title when identifier not found', async () => {
      const mockTasks = [
        { id: 'task-1', title: 'Fix Bug in Component', description: 'No Huly ID' },
      ];
      mockVibeClient.listTasks.mockResolvedValue(mockTasks);

      const hulyIssue = { identifier: 'TEST-789', title: 'Fix Bug in Component' };
      const result = await findVibeTaskByHulyIssue(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toEqual(mockTasks[0]);
    });

    it('should find task with case-insensitive title match', async () => {
      const mockTasks = [{ id: 'task-1', title: 'Fix Bug in Component', description: 'No ID' }];
      mockVibeClient.listTasks.mockResolvedValue(mockTasks);

      const hulyIssue = { identifier: 'TEST-999', title: 'fix bug in component' };
      const result = await findVibeTaskByHulyIssue(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toEqual(mockTasks[0]);
    });

    it('should find task ignoring priority prefixes', async () => {
      const mockTasks = [{ id: 'task-1', title: '[P1] Fix Critical Bug', description: 'No ID' }];
      mockVibeClient.listTasks.mockResolvedValue(mockTasks);

      const hulyIssue = { identifier: 'TEST-111', title: 'Fix Critical Bug' };
      const result = await findVibeTaskByHulyIssue(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toEqual(mockTasks[0]);
    });

    it('should find task ignoring [BUG] prefix', async () => {
      const mockTasks = [
        { id: 'task-1', title: '[BUG] Authentication Issue', description: 'No ID' },
      ];
      mockVibeClient.listTasks.mockResolvedValue(mockTasks);

      const hulyIssue = { identifier: 'TEST-222', title: 'Authentication Issue' };
      const result = await findVibeTaskByHulyIssue(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toEqual(mockTasks[0]);
    });

    it('should find task with partial title match for long titles', async () => {
      const mockTasks = [
        {
          id: 'task-1',
          title: 'Implement comprehensive authentication system with OAuth2',
          description: 'No ID',
        },
      ];
      mockVibeClient.listTasks.mockResolvedValue(mockTasks);

      const hulyIssue = { identifier: 'TEST-333', title: 'Implement comprehensive authentication' };
      const result = await findVibeTaskByHulyIssue(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toEqual(mockTasks[0]);
    });

    it('should return null when no match found', async () => {
      const mockTasks = [
        { id: 'task-1', title: 'Different Task', description: 'Huly Issue: OTHER-123' },
      ];
      mockVibeClient.listTasks.mockResolvedValue(mockTasks);

      const hulyIssue = { identifier: 'TEST-999', title: 'Nonexistent Task' };
      const result = await findVibeTaskByHulyIssue(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toBeNull();
    });

    it('should return null on API error', async () => {
      mockVibeClient.listTasks.mockRejectedValue(new Error('API error'));

      const hulyIssue = { identifier: 'TEST-123', title: 'Task' };
      const result = await findVibeTaskByHulyIssue(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toBeNull();
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should prioritize identifier match over title match', async () => {
      const mockTasks = [
        { id: 'task-1', title: 'Same Title', description: 'Huly Issue: TEST-111' },
        { id: 'task-2', title: 'Same Title', description: 'Huly Issue: TEST-222' },
      ];
      mockVibeClient.listTasks.mockResolvedValue(mockTasks);

      const hulyIssue = { identifier: 'TEST-222', title: 'Same Title' };
      const result = await findVibeTaskByHulyIssue(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toEqual(mockTasks[1]);
    });
  });

  // ============================================================
  // createVibeTask Tests (DESCRIPTION ENRICHMENT)
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
      mockVibeClient.listTasks.mockResolvedValue([]);
      mockVibeClient.createTask.mockResolvedValue(createdTask);

      const result = await createVibeTask(mockVibeClient, 'proj-1', hulyIssue);

      expect(mockVibeClient.createTask).toHaveBeenCalledWith('proj-1', {
        title: 'Test Issue',
        description: 'Issue description\n\n---\nHuly Issue: TEST-1\nHuly Parent: none',
        status: 'inprogress', // mapHulyStatusToVibe('In Progress')
      });
      expect(result).toEqual(createdTask);
    });

    it('should append Huly identifier to description', async () => {
      mockVibeClient.listTasks.mockResolvedValue([]);
      mockVibeClient.createTask.mockResolvedValue({ id: 'task-1' });

      await createVibeTask(mockVibeClient, 'proj-1', {
        identifier: 'PROJ-42',
        title: 'Test',
        description: 'Original description',
        status: 'Backlog',
      });

      expect(mockVibeClient.createTask).toHaveBeenCalledWith('proj-1', {
        title: 'Test',
        description: 'Original description\n\n---\nHuly Issue: PROJ-42\nHuly Parent: none',
        status: 'todo',
      });
    });

    it('should create description with Huly ID when original is empty', async () => {
      mockVibeClient.listTasks.mockResolvedValue([]);
      mockVibeClient.createTask.mockResolvedValue({ id: 'task-1' });

      await createVibeTask(mockVibeClient, 'proj-1', {
        identifier: 'TEST-2',
        title: 'No Description Issue',
        description: null,
        status: 'Backlog',
      });

      expect(mockVibeClient.createTask).toHaveBeenCalledWith('proj-1', {
        title: 'No Description Issue',
        description: 'Synced from Huly: TEST-2\n\n---\nHuly Issue: TEST-2\nHuly Parent: none',
        status: 'todo',
      });
    });

    it('should create description with Huly ID when description is empty string', async () => {
      mockVibeClient.listTasks.mockResolvedValue([]);
      mockVibeClient.createTask.mockResolvedValue({ id: 'task-1' });

      await createVibeTask(mockVibeClient, 'proj-1', {
        identifier: 'TEST-3',
        title: 'Empty Description Issue',
        description: '',
        status: 'Done',
      });

      expect(mockVibeClient.createTask).toHaveBeenCalledWith('proj-1', {
        title: 'Empty Description Issue',
        description: 'Synced from Huly: TEST-3\n\n---\nHuly Issue: TEST-3\nHuly Parent: none',
        status: 'done',
      });
    });

    it('should preserve multiline descriptions and append Huly ID', async () => {
      mockVibeClient.listTasks.mockResolvedValue([]);
      mockVibeClient.createTask.mockResolvedValue({ id: 'task-1' });

      await createVibeTask(mockVibeClient, 'proj-1', {
        identifier: 'TEST-4',
        title: 'Multiline Issue',
        description: 'Line 1\n\nLine 2\n\n## Section\nContent',
        status: 'In Progress',
      });

      expect(mockVibeClient.createTask).toHaveBeenCalledWith('proj-1', {
        title: 'Multiline Issue',
        description: 'Line 1\n\nLine 2\n\n## Section\nContent\n\n---\nHuly Issue: TEST-4\nHuly Parent: none',
        status: 'inprogress',
      });
    });

    it('should include parent metadata when Huly issue has a parent', async () => {
      mockVibeClient.listTasks.mockResolvedValue([]);
      mockVibeClient.createTask.mockResolvedValue({ id: 'task-1' });

      await createVibeTask(mockVibeClient, 'proj-1', {
        identifier: 'TEST-5',
        title: 'Child Issue',
        description: 'Child description',
        status: 'Backlog',
        parentIssue: { identifier: 'TEST-1' },
      });

      expect(mockVibeClient.createTask).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({
          description: 'Child description\n\n---\nHuly Issue: TEST-5\nHuly Parent: TEST-1',
        })
      );
    });

    it('should skip creation if task already exists (deduplication)', async () => {
      const existingTask = {
        id: 'existing-1',
        title: 'Test Issue',
        description: 'Huly Issue: TEST-1',
      };
      mockVibeClient.listTasks.mockResolvedValue([existingTask]);

      const result = await createVibeTask(mockVibeClient, 'proj-1', hulyIssue);

      expect(mockVibeClient.createTask).not.toHaveBeenCalled();
      expect(result).toEqual(existingTask);
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Found existing task'));
    });

    it('should return null and log in dry run mode', async () => {
      const result = await createVibeTask(mockVibeClient, 'proj-1', hulyIssue, {
        sync: { dryRun: true },
      });

      expect(mockVibeClient.createTask).not.toHaveBeenCalled();
      expect(mockVibeClient.listTasks).not.toHaveBeenCalled();
      expect(result).toBeNull();
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN]'));
    });

    it('should return null on error', async () => {
      mockVibeClient.listTasks.mockResolvedValue([]);
      mockVibeClient.createTask.mockRejectedValue(new Error('API error'));

      const result = await createVibeTask(mockVibeClient, 'proj-1', hulyIssue);

      expect(result).toBeNull();
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should map various Huly statuses to Vibe statuses', async () => {
      mockVibeClient.listTasks.mockResolvedValue([]);
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
      expect(consoleSpy.log).toHaveBeenCalledWith('[Vibe] ✓ Updated task task-1 status to: done');
    });

    it('should skip update in dry run mode', async () => {
      await updateVibeTaskStatus(mockVibeClient, 'task-1', 'done', { sync: { dryRun: true } });

      expect(mockVibeClient.updateTask).not.toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN]'));
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
      await updateVibeTaskDescription(mockVibeClient, 'task-1', 'New description', {
        sync: { dryRun: true },
      });

      expect(mockVibeClient.updateTask).not.toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN]'));
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
      expect(service).toHaveProperty('findProjectByName');
      expect(service).toHaveProperty('createProject');
      expect(service).toHaveProperty('listTasks');
      expect(service).toHaveProperty('findTaskByHulyIssue');
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

      const result = await service.createTask(mockVibeClient, 'proj-1', {
        identifier: 'TEST-1',
        title: 'Test',
        status: 'Backlog',
      });

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

    it('should call findProjectByName', async () => {
      const service = createVibeService({});
      mockVibeClient.listProjects.mockResolvedValue([{ id: '1', name: 'Test' }]);

      const result = await service.findProjectByName(mockVibeClient, 'Test');

      expect(result).toEqual({ id: '1', name: 'Test' });
    });

    it('should call findTaskByHulyIssue', async () => {
      const service = createVibeService({});
      mockVibeClient.listTasks.mockResolvedValue([
        { id: 'task-1', title: 'Test', description: 'Huly Issue: TEST-1' },
      ]);

      const result = await service.findTaskByHulyIssue(mockVibeClient, 'proj-1', {
        identifier: 'TEST-1',
        title: 'Test',
      });

      expect(result).toEqual({ id: 'task-1', title: 'Test', description: 'Huly Issue: TEST-1' });
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================
  describe('Edge Cases', () => {
    it('should handle undefined config', async () => {
      mockVibeClient.listProjects.mockResolvedValue([]);
      mockVibeClient.createProject.mockResolvedValue({ id: '1' });

      const result = await createVibeProject(mockVibeClient, { name: 'Test' });

      expect(result).toEqual({ id: '1' });
    });

    it('should handle config without sync property', async () => {
      mockVibeClient.listTasks.mockResolvedValue([]);
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
      mockVibeClient.listProjects.mockResolvedValue([]);
      mockVibeClient.createProject.mockResolvedValue({ id: '1' });

      await createVibeProject(mockVibeClient, { name: longName });

      expect(mockVibeClient.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: longName })
      );
    });

    it('should handle special characters in issue title', async () => {
      mockVibeClient.listTasks.mockResolvedValue([]);
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

    it('should handle special characters in description', async () => {
      mockVibeClient.listTasks.mockResolvedValue([]);
      mockVibeClient.createTask.mockResolvedValue({ id: '1' });

      await createVibeTask(mockVibeClient, 'proj-1', {
        identifier: 'TEST-1',
        title: 'Test',
        description: 'Description with <html> & "quotes" and \'apostrophes\'',
        status: 'Backlog',
      });

      expect(mockVibeClient.createTask).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({
          description:
            'Description with <html> & "quotes" and \'apostrophes\'\n\n---\nHuly Issue: TEST-1\nHuly Parent: none',
        })
      );
    });
  });
});
