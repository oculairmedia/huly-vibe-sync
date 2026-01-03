/**
 * Unit Tests for VibeRestClient
 *
 * Tests REST API client for Vibe Kanban platform
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VibeRestClient } from '../../lib/VibeRestClient.js';
import {
  createMockVibeProject,
  createMockVibeTask,
  createMockListProjectsResponse,
  createMockListTasksResponse,
  createMockCreateTaskResponse,
  createMockUpdateTaskResponse,
  createMockDeleteResponse,
  createMockTaskAttempt,
  createMockExecutionProcess,
  createMockApiResponse,
} from '../mocks/vibeMocks.js';

describe('VibeRestClient', () => {
  let client;
  let mockFetch;
  const baseUrl = 'http://localhost:3105';

  beforeEach(() => {
    client = new VibeRestClient(baseUrl);

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client with correct base URL', () => {
      const client = new VibeRestClient('http://localhost:8080/mcp');
      expect(client.baseUrl).toBe('http://localhost:3105/api');
    });

    it('should normalize URL by removing /mcp suffix', () => {
      const client = new VibeRestClient('http://localhost:8080/mcp');
      expect(client.baseUrl).not.toContain('/mcp');
      expect(client.baseUrl).toContain('/api');
    });

    it('should normalize URL by removing /api suffix and re-adding', () => {
      const client = new VibeRestClient('http://localhost:8080/api');
      expect(client.baseUrl).toBe('http://localhost:3105/api');
    });

    it('should set port to 3105', () => {
      const client = new VibeRestClient('http://localhost:8080');
      expect(client.baseUrl).toContain(':3105');
    });

    it('should use custom name if provided', () => {
      const client = new VibeRestClient(baseUrl, { name: 'Custom' });
      expect(client.name).toBe('Custom');
    });

    it('should use default name if not provided', () => {
      const client = new VibeRestClient(baseUrl);
      expect(client.name).toBe('Vibe REST');
    });

    it('should use custom timeout if provided', () => {
      const client = new VibeRestClient(baseUrl, { timeout: 30000 });
      expect(client.timeout).toBe(30000);
    });

    it('should use default timeout if not provided', () => {
      const client = new VibeRestClient(baseUrl);
      expect(client.timeout).toBe(60000);
    });
  });

  describe('initialize', () => {
    it('should test health endpoint on initialize', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => createMockApiResponse({ status: 'healthy' }),
      });

      await client.initialize();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3105/health',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should return true on successful health check', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => createMockApiResponse({ status: 'healthy' }),
      });

      const result = await client.initialize();
      expect(result).toBe(true);
    });

    it('should fallback to list projects if health endpoint fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => createMockApiResponse(createMockListProjectsResponse(2)),
        });

      const result = await client.initialize();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(client.initialize()).rejects.toThrow('Network error');
    });
  });

  describe('healthCheck', () => {
    it('should call health endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse({ status: 'healthy' }),
      });

      await client.healthCheck();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3105/health',
        expect.any(Object),
      );
    });

    it('should return health status on success', async () => {
      const healthData = { status: 'healthy', uptime: 12345 };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(healthData),
      });

      const result = await client.healthCheck();
      expect(result).toEqual(createMockApiResponse(healthData));
    });

    it('should return synthetic status if health endpoint not available', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await client.healthCheck();
      expect(result.status).toBe('unknown');
      expect(result.message).toBeTruthy();
    });
  });

  describe('listProjects', () => {
    it('should call projects endpoint', async () => {
      const projects = createMockListProjectsResponse(2);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(projects),
      });

      await client.listProjects();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3105/api/projects',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should return array of projects', async () => {
      const projects = createMockListProjectsResponse(3);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(projects),
      });

      const result = await client.listProjects();
      expect(result).toEqual(projects);
      expect(result.length).toBe(3);
    });

    it('should handle empty project list', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse([]),
      });

      const result = await client.listProjects();
      expect(result).toEqual([]);
    });

    it('should throw error on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      await expect(client.listProjects()).rejects.toThrow('REST API error (500)');
    });
  });

  describe('getProject', () => {
    it('should call project endpoint with ID', async () => {
      const projectId = 'project-uuid-1';
      const project = createMockVibeProject({ id: projectId });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(project),
      });

      await client.getProject(projectId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/projects/${projectId}`,
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should return project details', async () => {
      const projectId = 'project-uuid-1';
      const project = createMockVibeProject({ id: projectId, name: 'Test Project' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(project),
      });

      const result = await client.getProject(projectId);
      expect(result).toEqual(project);
      expect(result.name).toBe('Test Project');
    });
  });

  describe('createProject', () => {
    it('should call projects endpoint with POST', async () => {
      const projectData = {
        name: 'New Project',
        git_repo_path: '/path/to/repo',
        use_existing_repo: true,
      };
      const createdProject = createMockVibeProject(projectData);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(createdProject),
      });

      await client.createProject(projectData);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3105/api/projects',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(projectData),
        }),
      );
    });

    it('should return created project', async () => {
      const projectData = { name: 'New Project' };
      const createdProject = createMockVibeProject(projectData);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(createdProject),
      });

      const result = await client.createProject(projectData);
      expect(result.name).toBe('New Project');
    });
  });

  describe('updateProject', () => {
    it('should call project endpoint with PUT', async () => {
      const projectId = 'project-uuid-1';
      const updates = { name: 'Updated Name' };
      const updatedProject = createMockVibeProject({ id: projectId, ...updates });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(updatedProject),
      });

      await client.updateProject(projectId, updates);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/projects/${projectId}`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(updates),
        }),
      );
    });

    it('should return updated project', async () => {
      const projectId = 'project-uuid-1';
      const updates = { name: 'Updated Name' };
      const updatedProject = createMockVibeProject({ id: projectId, ...updates });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(updatedProject),
      });

      const result = await client.updateProject(projectId, updates);
      expect(result.name).toBe('Updated Name');
    });
  });

  describe('deleteProject', () => {
    it('should call project endpoint with DELETE', async () => {
      const projectId = 'project-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(createMockDeleteResponse(projectId)),
      });

      await client.deleteProject(projectId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/projects/${projectId}`,
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });

  describe('listTasks', () => {
    it('should call tasks endpoint with project_id', async () => {
      const projectId = 'project-uuid-1';
      const tasks = createMockListTasksResponse(3, projectId);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(tasks),
      });

      await client.listTasks(projectId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/tasks?project_id=${projectId}`),
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should include status filter if provided', async () => {
      const projectId = 'project-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse([]),
      });

      await client.listTasks(projectId, { status: 'done' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=done'),
        expect.any(Object),
      );
    });

    it('should include limit filter if provided', async () => {
      const projectId = 'project-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse([]),
      });

      await client.listTasks(projectId, { limit: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object),
      );
    });

    it('should return array of tasks', async () => {
      const projectId = 'project-uuid-1';
      const tasks = createMockListTasksResponse(5, projectId);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(tasks),
      });

      const result = await client.listTasks(projectId);
      expect(result).toEqual(tasks);
      expect(result.length).toBe(5);
    });
  });

  describe('getTask', () => {
    it('should call task endpoint with ID', async () => {
      const taskId = 'task-uuid-1';
      const task = createMockVibeTask({ id: taskId });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(task),
      });

      await client.getTask(taskId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/tasks/${taskId}`,
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should return task details', async () => {
      const taskId = 'task-uuid-1';
      const task = createMockVibeTask({ id: taskId, title: 'Test Task' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(task),
      });

      const result = await client.getTask(taskId);
      expect(result).toEqual(task);
      expect(result.title).toBe('Test Task');
    });
  });

  describe('createTask', () => {
    it('should call tasks endpoint with POST', async () => {
      const projectId = 'project-uuid-1';
      const taskData = {
        title: 'New Task',
        description: 'Task description',
        status: 'todo',
      };
      const createdTask = createMockCreateTaskResponse({
        project_id: projectId,
        ...taskData,
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(createdTask),
      });

      await client.createTask(projectId, taskData);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3105/api/tasks',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            project_id: projectId,
            ...taskData,
          }),
        }),
      );
    });

    it('should return created task', async () => {
      const projectId = 'project-uuid-1';
      const taskData = { title: 'New Task', status: 'todo' };
      const createdTask = createMockCreateTaskResponse({
        project_id: projectId,
        ...taskData,
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(createdTask),
      });

      const result = await client.createTask(projectId, taskData);
      expect(result.title).toBe('New Task');
      expect(result.project_id).toBe(projectId);
    });
  });

  describe('updateTask', () => {
    it('should call task endpoint with PUT', async () => {
      const taskId = 'task-uuid-1';
      const field = 'status';
      const value = 'done';
      const updatedTask = createMockUpdateTaskResponse(taskId, { status: value });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(updatedTask),
      });

      await client.updateTask(taskId, field, value);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/tasks/${taskId}`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ [field]: value }),
        }),
      );
    });

    it('should return updated task', async () => {
      const taskId = 'task-uuid-1';
      const updatedTask = createMockUpdateTaskResponse(taskId, { status: 'done' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(updatedTask),
      });

      const result = await client.updateTask(taskId, 'status', 'done');
      expect(result.status).toBe('done');
    });
  });

  describe('deleteTask', () => {
    it('should call task endpoint with DELETE', async () => {
      const taskId = 'task-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(createMockDeleteResponse(taskId)),
      });

      await client.deleteTask(taskId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/tasks/${taskId}`,
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });

  describe('bulkUpdateTasks', () => {
    it('should call tasks bulk endpoint with PUT', async () => {
      const updates = [
        { task_id: 'task-1', field: 'status', value: 'done' },
        { task_id: 'task-2', field: 'priority', value: 'high' },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse({ updated: 2 }),
      });

      await client.bulkUpdateTasks(updates);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3105/api/tasks/bulk',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ updates }),
        }),
      );
    });
  });

  describe('startTaskAttempt', () => {
    it('should call attempts start endpoint', async () => {
      const taskId = 'task-uuid-1';
      const executor = 'CLAUDE_CODE';
      const baseBranch = 'main';
      const attempt = createMockTaskAttempt({ task_id: taskId, executor, base_branch: baseBranch });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(attempt),
      });

      await client.startTaskAttempt(taskId, executor, baseBranch);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3105/api/attempts/start',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            task_id: taskId,
            executor,
            base_branch: baseBranch,
          }),
        }),
      );
    });

    it('should return task attempt details', async () => {
      const attempt = createMockTaskAttempt();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(attempt),
      });

      const result = await client.startTaskAttempt('task-1', 'CLAUDE_CODE', 'main');
      expect(result.executor).toBe('CLAUDE_CODE');
      expect(result.base_branch).toBe('main');
    });
  });

  describe('listTaskAttempts', () => {
    it('should call attempts endpoint with task_id', async () => {
      const taskId = 'task-uuid-1';
      const attempts = [createMockTaskAttempt({ task_id: taskId })];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(attempts),
      });

      await client.listTaskAttempts(taskId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/attempts?task_id=${taskId}`,
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });
  });

  describe('getTaskAttempt', () => {
    it('should call attempt endpoint with ID', async () => {
      const attemptId = 'attempt-uuid-1';
      const attempt = createMockTaskAttempt({ id: attemptId });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(attempt),
      });

      await client.getTaskAttempt(attemptId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/attempts/${attemptId}`,
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });
  });

  describe('mergeTaskAttempt', () => {
    it('should call attempt merge endpoint', async () => {
      const attemptId = 'attempt-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse({ merged: true }),
      });

      await client.mergeTaskAttempt(attemptId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/attempts/${attemptId}/merge`,
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  describe('createFollowupAttempt', () => {
    it('should call followup endpoint', async () => {
      const previousAttemptId = 'attempt-uuid-1';
      const options = { feedback: 'Fix the bug' };
      const newAttempt = createMockTaskAttempt({ id: 'attempt-uuid-2' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(newAttempt),
      });

      await client.createFollowupAttempt(previousAttemptId, options);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3105/api/attempts/followup',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            previous_attempt_id: previousAttemptId,
            ...options,
          }),
        }),
      );
    });
  });

  describe('getExecutionProcess', () => {
    it('should call process endpoint with ID', async () => {
      const processId = 'process-uuid-1';
      const process = createMockExecutionProcess({ id: processId });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(process),
      });

      await client.getExecutionProcess(processId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/processes/${processId}`,
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });
  });

  describe('stopExecutionProcess', () => {
    it('should call process stop endpoint', async () => {
      const processId = 'process-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse({ stopped: true }),
      });

      await client.stopExecutionProcess(processId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/processes/${processId}/stop`,
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  describe('getProcessLogs', () => {
    it('should call raw logs endpoint by default', async () => {
      const processId = 'process-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse({ logs: ['log1', 'log2'] }),
      });

      await client.getProcessLogs(processId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/processes/${processId}/logs/raw`,
        expect.any(Object),
      );
    });

    it('should call normalized logs endpoint when requested', async () => {
      const processId = 'process-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse({ logs: [] }),
      });

      await client.getProcessLogs(processId, true);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/processes/${processId}/logs/normalized`,
        expect.any(Object),
      );
    });
  });

  describe('listExecutionProcesses', () => {
    it('should call processes endpoint with task_attempt_id', async () => {
      const taskAttemptId = 'attempt-uuid-1';
      const processes = [createMockExecutionProcess({ task_attempt_id: taskAttemptId })];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(processes),
      });

      await client.listExecutionProcesses(taskAttemptId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`task_attempt_id=${taskAttemptId}`),
        expect.any(Object),
      );
    });

    it('should include show_soft_deleted parameter when true', async () => {
      const taskAttemptId = 'attempt-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse([]),
      });

      await client.listExecutionProcesses(taskAttemptId, true);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('show_soft_deleted=true'),
        expect.any(Object),
      );
    });
  });

  describe('getBranchStatus', () => {
    it('should call branch-status endpoint', async () => {
      const attemptId = 'attempt-uuid-1';
      const status = { ahead: 2, behind: 1, conflicts: false };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(status),
      });

      await client.getBranchStatus(attemptId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/attempts/${attemptId}/branch-status`,
        expect.any(Object),
      );
    });
  });

  describe('getAttemptCommits', () => {
    it('should call commits endpoint', async () => {
      const attemptId = 'attempt-uuid-1';
      const commits = [{ sha: 'abc123', message: 'Fix bug' }];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(commits),
      });

      await client.getAttemptCommits(attemptId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/attempts/${attemptId}/commits`,
        expect.any(Object),
      );
    });
  });

  describe('compareCommitToHead', () => {
    it('should call compare endpoint with commit SHA', async () => {
      const attemptId = 'attempt-uuid-1';
      const commitSha = 'abc123';
      const comparison = { ahead: 0, behind: 2 };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse(comparison),
      });

      await client.compareCommitToHead(attemptId, commitSha);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/attempts/${attemptId}/compare/${commitSha}`,
        expect.any(Object),
      );
    });
  });

  describe('abortConflicts', () => {
    it('should call abort-conflicts endpoint', async () => {
      const attemptId = 'attempt-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse({ aborted: true }),
      });

      await client.abortConflicts(attemptId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/attempts/${attemptId}/abort-conflicts`,
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  describe('startDevServer', () => {
    it('should call dev-server start endpoint', async () => {
      const attemptId = 'attempt-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse({ started: true, port: 3000 }),
      });

      await client.startDevServer(attemptId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/attempts/${attemptId}/dev-server/start`,
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  describe('stopDevServer', () => {
    it('should call dev-server stop endpoint', async () => {
      const attemptId = 'attempt-uuid-1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockApiResponse({ stopped: true }),
      });

      await client.stopDevServer(attemptId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3105/api/attempts/${attemptId}/dev-server/stop`,
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  describe('getStats', () => {
    it('should return client statistics', () => {
      const stats = client.getStats();

      expect(stats).toEqual({
        type: 'rest',
        baseUrl: 'http://localhost:3105/api',
        timeout: 60000,
        name: 'Vibe REST',
      });
    });

    it('should reflect custom options', () => {
      const customClient = new VibeRestClient(baseUrl, {
        name: 'Custom Client',
        timeout: 30000,
      });
      const stats = customClient.getStats();

      expect(stats.name).toBe('Custom Client');
      expect(stats.timeout).toBe(30000);
    });
  });

  describe('error handling', () => {
    it('should throw error when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      await expect(client.listProjects()).rejects.toThrow('REST API error (500)');
    });

    it('should throw error when API returns success=false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, message: 'Operation failed' }),
      });

      await expect(client.listProjects()).rejects.toThrow('API call failed: Operation failed');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network timeout'));

      await expect(client.listProjects()).rejects.toThrow('Network timeout');
    });

    it('should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(client.listProjects()).rejects.toThrow('Invalid JSON');
    });
  });

  describe('performance monitoring', () => {
    it('should log slow API calls', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock a slow response (>5 seconds)
      mockFetch.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 5100));
        return {
          ok: true,
          json: async () => createMockApiResponse([]),
        };
      });

      await client.listProjects();

      // Check that console.log was called with a message containing "Slow API call"
      const slowCallLog = consoleSpy.mock.calls.find(call =>
        call[0]?.includes('Slow API call'),
      );
      expect(slowCallLog).toBeTruthy();
      expect(slowCallLog[0]).toContain('/projects');
      expect(slowCallLog[0]).toMatch(/took \d+ms/);

      consoleSpy.mockRestore();
    });
  });

  describe('factory function', () => {
    it('should create client using factory function', async () => {
      const { createVibeRestClient } = await import('../../lib/VibeRestClient.js');
      const client = createVibeRestClient(baseUrl);

      expect(client).toBeInstanceOf(VibeRestClient);
      expect(client.baseUrl).toBe('http://localhost:3105/api');
    });

    it('should pass options through factory function', async () => {
      const { createVibeRestClient } = await import('../../lib/VibeRestClient.js');
      const client = createVibeRestClient(baseUrl, { name: 'Factory Client' });

      expect(client.name).toBe('Factory Client');
    });
  });
});
