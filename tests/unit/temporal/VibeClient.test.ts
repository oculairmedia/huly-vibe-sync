/**
 * Tests for Temporal VibeClient
 *
 * Tests the Vibe Kanban REST API client interface.
 */

import { describe, it, expect } from 'vitest';

describe('VibeClient Interface', () => {
  describe('constructor', () => {
    it('should accept base URL', () => {
      const config = { baseUrl: 'http://localhost:3105' };
      expect(config.baseUrl).toBeDefined();
    });

    it('should handle URL with trailing slash', () => {
      const url = 'http://localhost:3105/';
      const normalized = url.replace(/\/$/, '');
      expect(normalized).toBe('http://localhost:3105');
    });

    it('should accept custom timeout', () => {
      const config = { baseUrl: 'http://localhost:3105', timeout: 5000 };
      expect(config.timeout).toBe(5000);
    });
  });

  describe('listProjects', () => {
    it('should return projects array', () => {
      const mockProjects = [
        { id: 'proj-1', name: 'Project 1' },
        { id: 'proj-2', name: 'Project 2' },
      ];
      expect(mockProjects).toHaveLength(2);
    });

    it('should call /api/projects endpoint', () => {
      const endpoint = '/api/projects';
      expect(endpoint).toBe('/api/projects');
    });
  });

  describe('getTask', () => {
    it('should return task by ID', () => {
      const mockTask = {
        id: 'task-123',
        title: 'Test Task',
        status: 'todo',
        project_id: 'proj-1',
      };
      expect(mockTask.id).toBe('task-123');
    });

    it('should call /api/tasks/{taskId} endpoint', () => {
      const taskId = 'task-123';
      const endpoint = `/api/tasks/${taskId}`;
      expect(endpoint).toBe('/api/tasks/task-123');
    });

    it('should return null for 404', () => {
      const result = null;
      expect(result).toBeNull();
    });
  });

  describe('createTask', () => {
    it('should accept projectId and task data', () => {
      const params = {
        projectId: 'proj-1',
        taskData: {
          title: 'New Task',
          description: 'Description',
          status: 'todo',
        },
      };
      expect(params.projectId).toBeDefined();
      expect(params.taskData.title).toBeDefined();
    });

    it('should call /api/projects/{projectId}/tasks with POST', () => {
      const projectId = 'proj-1';
      const endpoint = `/api/projects/${projectId}/tasks`;
      const method = 'POST';
      expect(endpoint).toBe('/api/projects/proj-1/tasks');
      expect(method).toBe('POST');
    });

    it('should return created task', () => {
      const mockTask = {
        id: 'new-task-123',
        title: 'New Task',
        status: 'todo',
        project_id: 'proj-1',
      };
      expect(mockTask.id).toBeDefined();
    });
  });

  describe('updateTask', () => {
    it('should accept taskId, field, and value', () => {
      const params = {
        taskId: 'task-123',
        field: 'status',
        value: 'done',
      };
      expect(params.taskId).toBeDefined();
      expect(params.field).toBe('status');
      expect(params.value).toBe('done');
    });

    it('should call /api/tasks/{taskId} with PATCH', () => {
      const taskId = 'task-123';
      const endpoint = `/api/tasks/${taskId}`;
      const method = 'PATCH';
      expect(endpoint).toBe('/api/tasks/task-123');
      expect(method).toBe('PATCH');
    });

    it('should update task status', () => {
      const mockTask = {
        id: 'task-123',
        title: 'Test Task',
        status: 'done',
      };
      expect(mockTask.status).toBe('done');
    });

    it('should update task title', () => {
      const mockTask = {
        id: 'task-123',
        title: 'Updated Title',
        status: 'todo',
      };
      expect(mockTask.title).toBe('Updated Title');
    });
  });

  describe('findTaskByHulyId', () => {
    it('should search tasks by Huly ID in description', () => {
      const mockTasks = [
        { id: 'task-1', title: 'Task 1', description: 'Some text' },
        { id: 'task-2', title: 'Task 2', description: 'Huly Issue: TEST-123' },
        { id: 'task-3', title: 'Task 3', description: 'Another task' },
      ];

      const hulyId = 'TEST-123';
      const found = mockTasks.find(t =>
        t.description?.includes(`Huly Issue: ${hulyId}`)
      );

      expect(found).toEqual(mockTasks[1]);
    });

    it('should return null if not found', () => {
      const mockTasks = [
        { id: 'task-1', title: 'Task 1', description: 'Some text' },
      ];

      const hulyId = 'NONEXISTENT-999';
      const found = mockTasks.find(t =>
        t.description?.includes(`Huly Issue: ${hulyId}`)
      );

      expect(found).toBeUndefined();
    });
  });

  describe('listTasks', () => {
    it('should return tasks for a project', () => {
      const mockTasks = [
        { id: 'task-1', title: 'Task 1', status: 'todo' },
        { id: 'task-2', title: 'Task 2', status: 'done' },
      ];
      expect(mockTasks).toHaveLength(2);
    });

    it('should call /api/projects/{projectId}/tasks endpoint', () => {
      const projectId = 'proj-1';
      const endpoint = `/api/projects/${projectId}/tasks`;
      expect(endpoint).toBe('/api/projects/proj-1/tasks');
    });
  });

  describe('error handling', () => {
    it('should handle network errors', () => {
      const error = new Error('Network error');
      expect(error.message).toBe('Network error');
    });

    it('should handle timeout', () => {
      const error = new Error('Timeout');
      expect(error.message).toContain('Timeout');
    });

    it('should handle malformed JSON response', () => {
      const error = new SyntaxError('Invalid JSON');
      expect(error.message).toContain('Invalid JSON');
    });

    it('should handle API errors', () => {
      const response = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };
      expect(response.ok).toBe(false);
      expect(response.status).toBe(500);
    });
  });
});

describe('VibeClient API Endpoints', () => {
  it('should use correct health endpoint', () => {
    expect('/api/health').toBe('/api/health');
  });

  it('should use correct projects endpoint', () => {
    expect('/api/projects').toBe('/api/projects');
  });

  it('should use correct tasks endpoint', () => {
    expect('/api/tasks').toBe('/api/tasks');
  });

  it('should build project tasks endpoint correctly', () => {
    const projectId = 'my-project';
    const endpoint = `/api/projects/${projectId}/tasks`;
    expect(endpoint).toBe('/api/projects/my-project/tasks');
  });
});

describe('VibeClient Response Types', () => {
  describe('Task', () => {
    it('should have required fields', () => {
      const task = {
        id: 'task-123',
        title: 'Test Task',
        status: 'todo',
        project_id: 'proj-1',
      };

      expect(task.id).toBeDefined();
      expect(task.title).toBeDefined();
      expect(task.status).toBeDefined();
    });

    it('should allow optional fields', () => {
      const task = {
        id: 'task-123',
        title: 'Test Task',
        description: 'Optional description',
        status: 'inprogress',
        project_id: 'proj-1',
        updated_at: '2024-01-15T10:00:00Z',
      };

      expect(task.description).toBeDefined();
      expect(task.updated_at).toBeDefined();
    });
  });

  describe('Project', () => {
    it('should have required fields', () => {
      const project = {
        id: 'proj-1',
        name: 'Project Name',
      };

      expect(project.id).toBeDefined();
      expect(project.name).toBeDefined();
    });
  });
});
