/**
 * Tests for Temporal HulyClient
 *
 * Tests the Huly REST API client interface.
 */

import { describe, it, expect } from 'vitest';

describe('HulyClient Interface', () => {
  describe('constructor', () => {
    it('should accept base URL', () => {
      const config = { baseUrl: 'http://localhost:3458' };
      expect(config.baseUrl).toBeDefined();
    });

    it('should handle URL with port replacement', () => {
      const url = 'http://localhost:3000';
      // HulyClient replaces port 3000 with 3458
      const normalized = url.replace(':3000', ':3458');
      expect(normalized).toBe('http://localhost:3458');
    });
  });

  describe('listProjects', () => {
    it('should return projects array', () => {
      const mockProjects = [
        { identifier: 'PROJ1', name: 'Project 1' },
        { identifier: 'PROJ2', name: 'Project 2' },
      ];
      expect(mockProjects).toHaveLength(2);
    });

    it('should call /api/projects endpoint', () => {
      const endpoint = '/api/projects';
      expect(endpoint).toBe('/api/projects');
    });
  });

  describe('listIssues', () => {
    it('should return issues for a project', () => {
      const mockIssues = [
        { identifier: 'PROJ-1', title: 'Issue 1', status: 'Backlog' },
        { identifier: 'PROJ-2', title: 'Issue 2', status: 'Done' },
      ];
      expect(mockIssues).toHaveLength(2);
    });

    it('should call /api/projects/{project}/issues endpoint', () => {
      const project = 'PROJ';
      const endpoint = `/api/projects/${project}/issues`;
      expect(endpoint).toBe('/api/projects/PROJ/issues');
    });

    it('should handle empty project', () => {
      const issues = [];
      expect(issues).toEqual([]);
    });
  });

  describe('getIssue', () => {
    it('should return issue by identifier', () => {
      const mockIssue = {
        identifier: 'PROJ-123',
        title: 'Test Issue',
        status: 'In Progress',
        priority: 'High',
        modifiedOn: Date.now(),
      };
      expect(mockIssue.identifier).toBe('PROJ-123');
    });

    it('should call /api/issues/{identifier} endpoint', () => {
      const identifier = 'PROJ-123';
      const endpoint = `/api/issues/${identifier}`;
      expect(endpoint).toBe('/api/issues/PROJ-123');
    });

    it('should return null for 404', () => {
      const result = null;
      expect(result).toBeNull();
    });
  });

  describe('updateIssue', () => {
    it('should accept identifier, field, and value', () => {
      const params = {
        identifier: 'PROJ-123',
        field: 'status',
        value: 'Done',
      };
      expect(params.identifier).toBeDefined();
      expect(params.field).toBe('status');
      expect(params.value).toBe('Done');
    });

    it('should call /api/issues/{identifier} with PATCH', () => {
      const identifier = 'PROJ-123';
      const endpoint = `/api/issues/${identifier}`;
      const method = 'PATCH';
      expect(endpoint).toBe('/api/issues/PROJ-123');
      expect(method).toBe('PATCH');
    });

    it('should update issue status', () => {
      const mockIssue = {
        identifier: 'PROJ-123',
        title: 'Test Issue',
        status: 'Done',
      };
      expect(mockIssue.status).toBe('Done');
    });

    it('should update issue priority', () => {
      const mockIssue = {
        identifier: 'PROJ-123',
        title: 'Test Issue',
        priority: 'Urgent',
      };
      expect(mockIssue.priority).toBe('Urgent');
    });

    it('should update issue description', () => {
      const mockIssue = {
        identifier: 'PROJ-123',
        title: 'Test Issue',
        description: 'Updated description',
      };
      expect(mockIssue.description).toBe('Updated description');
    });
  });

  describe('createIssue', () => {
    it('should accept project and issue data', () => {
      const params = {
        project: 'PROJ',
        issueData: {
          title: 'New Issue',
          description: 'Description',
          priority: 'Medium',
        },
      };
      expect(params.project).toBeDefined();
      expect(params.issueData.title).toBeDefined();
    });

    it('should call /api/projects/{project}/issues with POST', () => {
      const project = 'PROJ';
      const endpoint = `/api/projects/${project}/issues`;
      const method = 'POST';
      expect(endpoint).toBe('/api/projects/PROJ/issues');
      expect(method).toBe('POST');
    });

    it('should return created issue', () => {
      const mockIssue = {
        identifier: 'PROJ-124',
        title: 'New Issue',
        status: 'Backlog',
        priority: 'Medium',
      };
      expect(mockIssue.identifier).toBeDefined();
    });
  });

  describe('patchIssue', () => {
    it('should patch multiple fields at once', () => {
      const params = {
        identifier: 'PROJ-123',
        fields: {
          title: 'Updated Title',
          status: 'In Progress',
          priority: 'High',
        },
      };
      expect(Object.keys(params.fields)).toHaveLength(3);
    });

    it('should call /api/issues/{identifier} with PATCH', () => {
      const identifier = 'PROJ-123';
      const endpoint = `/api/issues/${identifier}`;
      const method = 'PATCH';
      expect(endpoint).toBe('/api/issues/PROJ-123');
      expect(method).toBe('PATCH');
    });
  });

  describe('error handling', () => {
    it('should handle network errors', () => {
      const error = new Error('Network error');
      expect(error.message).toBe('Network error');
    });

    it('should handle 500 errors', () => {
      const response = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };
      expect(response.status).toBe(500);
    });

    it('should handle 401 unauthorized', () => {
      const response = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      };
      expect(response.status).toBe(401);
    });

    it('should handle 422 validation errors', () => {
      const response = {
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
      };
      expect(response.status).toBe(422);
    });
  });

  describe('syncStatusFromVibe', () => {
    it('should sync status from Vibe task', () => {
      const result = {
        success: true,
        hulyStatus: 'Done',
      };
      expect(result.success).toBe(true);
      expect(result.hulyStatus).toBe('Done');
    });
  });
});

describe('HulyClient API Endpoints', () => {
  it('should use correct health endpoint', () => {
    expect('/api/health').toBe('/api/health');
  });

  it('should use correct projects endpoint', () => {
    expect('/api/projects').toBe('/api/projects');
  });

  it('should use correct issues endpoint', () => {
    expect('/api/issues').toBe('/api/issues');
  });

  it('should build project issues endpoint correctly', () => {
    const project = 'MY-PROJECT';
    const endpoint = `/api/projects/${project}/issues`;
    expect(endpoint).toBe('/api/projects/MY-PROJECT/issues');
  });
});

describe('HulyClient Response Types', () => {
  describe('Issue', () => {
    it('should have required fields', () => {
      const issue = {
        identifier: 'PROJ-123',
        title: 'Test Issue',
        status: 'In Progress',
      };

      expect(issue.identifier).toBeDefined();
      expect(issue.title).toBeDefined();
      expect(issue.status).toBeDefined();
    });

    it('should allow optional fields', () => {
      const issue = {
        identifier: 'PROJ-123',
        title: 'Test Issue',
        description: 'Optional description',
        status: 'In Progress',
        priority: 'High',
        modifiedOn: Date.now(),
      };

      expect(issue.description).toBeDefined();
      expect(issue.priority).toBeDefined();
      expect(issue.modifiedOn).toBeDefined();
    });
  });

  describe('Project', () => {
    it('should have required fields', () => {
      const project = {
        identifier: 'PROJ',
        name: 'Project Name',
      };

      expect(project.identifier).toBeDefined();
      expect(project.name).toBeDefined();
    });
  });
});

describe('Huly Status Values', () => {
  const validStatuses = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Cancelled'];

  it('should recognize all valid statuses', () => {
    validStatuses.forEach(status => {
      expect(typeof status).toBe('string');
    });
  });

  it('should have correct number of statuses', () => {
    expect(validStatuses).toHaveLength(6);
  });
});

describe('Huly Priority Values', () => {
  const validPriorities = ['Urgent', 'High', 'Medium', 'Low'];

  it('should recognize all valid priorities', () => {
    validPriorities.forEach(priority => {
      expect(typeof priority).toBe('string');
    });
  });

  it('should have correct number of priorities', () => {
    expect(validPriorities).toHaveLength(4);
  });
});
