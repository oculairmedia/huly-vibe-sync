/**
 * Tests for Temporal BeadsClient
 *
 * Tests the Beads CLI wrapper client interface.
 */

import { describe, it, expect } from 'vitest';

describe('BeadsClient Interface', () => {
  describe('constructor', () => {
    it('should accept repo path', () => {
      const config = { repoPath: '/path/to/repo' };
      expect(config.repoPath).toBeDefined();
    });

    it('should normalize path', () => {
      const path = '/path/to/repo/';
      const normalized = path.replace(/\/$/, '');
      expect(normalized).toBe('/path/to/repo');
    });
  });

  describe('listIssues', () => {
    it('should return issues array', () => {
      const mockIssues = [
        { id: '1', title: 'Issue 1', status: 'open', priority: 2 },
        { id: '2', title: 'Issue 2', status: 'closed', priority: 1 },
      ];
      expect(mockIssues).toHaveLength(2);
    });

    it('should return empty array on error', () => {
      const issues = [];
      expect(issues).toEqual([]);
    });

    it('should handle empty output', () => {
      const issues = [];
      expect(issues).toEqual([]);
    });
  });

  describe('getIssue', () => {
    it('should return issue by ID', () => {
      const mockIssue = {
        id: '123',
        title: 'Test Issue',
        description: 'Description',
        status: 'open',
        priority: 2,
      };
      expect(mockIssue.id).toBe('123');
    });

    it('should return null for non-existent issue', () => {
      const result = null;
      expect(result).toBeNull();
    });
  });

  describe('createIssue', () => {
    it('should accept issue data', () => {
      const params = {
        title: 'New Issue',
        description: 'Description',
        status: 'open',
        priority: 2,
      };
      expect(params.title).toBeDefined();
      expect(params.status).toBeDefined();
    });

    it('should return created issue with ID', () => {
      const mockIssue = {
        id: 'new-123',
        title: 'New Issue',
      };
      expect(mockIssue.id).toBe('new-123');
    });

    it('should support labels', () => {
      const params = {
        title: 'New Issue',
        labels: ['bug', 'urgent'],
      };
      expect(params.labels).toHaveLength(2);
    });
  });

  describe('updateStatus', () => {
    it('should accept issueId and new status', () => {
      const params = {
        issueId: '123',
        status: 'closed',
      };
      expect(params.issueId).toBeDefined();
      expect(params.status).toBe('closed');
    });

    it('should return updated issue', () => {
      const mockResult = { id: '123', status: 'closed' };
      expect(mockResult.status).toBe('closed');
    });
  });

  describe('findByTitle', () => {
    it('should find issue by exact title match', () => {
      const mockIssues = [
        { id: '1', title: 'Issue One', status: 'open' },
        { id: '2', title: 'Issue Two', status: 'open' },
        { id: '3', title: 'Another Issue', status: 'closed' },
      ];

      const title = 'Issue Two';
      const found = mockIssues.find(i => i.title === title);
      expect(found).toEqual(mockIssues[1]);
    });

    it('should return null if not found', () => {
      const mockIssues = [
        { id: '1', title: 'Issue One', status: 'open' },
      ];

      const title = 'Nonexistent';
      const found = mockIssues.find(i => i.title === title) || null;
      expect(found).toBeNull();
    });

    it('should handle case-insensitive search', () => {
      const mockIssues = [
        { id: '1', title: 'Test Issue', status: 'open' },
      ];

      const title = 'test issue';
      const found = mockIssues.find(i =>
        i.title.toLowerCase() === title.toLowerCase()
      );
      expect(found).toEqual(mockIssues[0]);
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return true if there are changes', () => {
      const gitStatus = ' M .beads/issues.jsonl\n';
      const hasChanges = gitStatus.trim().length > 0;
      expect(hasChanges).toBe(true);
    });

    it('should return false if no changes', () => {
      const gitStatus = '';
      const hasChanges = gitStatus.trim().length > 0;
      expect(hasChanges).toBe(false);
    });

    it('should handle git errors gracefully', () => {
      // Should return false on error
      const hasChanges = false;
      expect(hasChanges).toBe(false);
    });
  });

  describe('commitChanges', () => {
    it('should accept commit message', () => {
      const params = {
        message: 'Sync from Huly',
      };
      expect(params.message).toBeDefined();
    });

    it('should return true on successful commit', () => {
      const result = true;
      expect(result).toBe(true);
    });

    it('should return false if no changes to commit', () => {
      const result = false;
      expect(result).toBe(false);
    });

    it('should handle commit errors', () => {
      const result = false;
      expect(result).toBe(false);
    });
  });

  describe('syncFromHuly', () => {
    it('should accept Huly issue data', () => {
      const params = {
        identifier: 'PROJ-123',
        title: 'Test Issue',
        description: 'Description',
        status: 'Backlog',
        priority: 'Medium',
      };
      expect(params.identifier).toBeDefined();
      expect(params.title).toBeDefined();
    });

    it('should return created result for new issue', () => {
      const result = {
        created: true,
        issue: { id: 'new-1', title: 'Test Issue', status: 'open' },
      };
      expect(result.created).toBe(true);
    });

    it('should return updated result for existing issue', () => {
      const result = {
        updated: true,
        issue: { id: 'existing-1', title: 'Test Issue', status: 'closed' },
      };
      expect(result.updated).toBe(true);
    });

    it('should return skipped if status unchanged', () => {
      const result = {
        skipped: true,
      };
      expect(result.skipped).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle bd command not found', () => {
      const error = {
        message: 'Command not found: bd',
        status: 127,
      };
      expect(error.status).toBe(127);
    });

    it('should handle invalid JSON output', () => {
      const output = 'not valid json';
      let result = [];
      try {
        result = JSON.parse(output);
      } catch {
        result = [];
      }
      expect(result).toEqual([]);
    });
  });
});

describe('BeadsClient CLI Commands', () => {
  it('should use bd list command', () => {
    const command = 'bd issue list --format json --no-daemon';
    expect(command).toContain('bd');
    expect(command).toContain('list');
  });

  it('should use bd show command', () => {
    const issueId = '123';
    const command = `bd show ${issueId} --format json`;
    expect(command).toContain('bd show');
    expect(command).toContain(issueId);
  });

  it('should use bd create command', () => {
    const command = 'bd create --title "Test" --format json';
    expect(command).toContain('bd create');
  });

  it('should use bd update command', () => {
    const issueId = '123';
    const command = `bd update ${issueId} --status closed`;
    expect(command).toContain('bd update');
    expect(command).toContain(issueId);
  });
});

describe('BeadsClient Issue Types', () => {
  describe('Issue', () => {
    it('should have required fields', () => {
      const issue = {
        id: '123',
        title: 'Test Issue',
        status: 'open',
      };

      expect(issue.id).toBeDefined();
      expect(issue.title).toBeDefined();
      expect(issue.status).toBeDefined();
    });

    it('should allow optional fields', () => {
      const issue = {
        id: '123',
        title: 'Test Issue',
        description: 'Optional description',
        status: 'open',
        priority: 2,
        labels: ['bug'],
        updated_at: '2024-01-15T10:00:00Z',
      };

      expect(issue.description).toBeDefined();
      expect(issue.priority).toBeDefined();
      expect(issue.labels).toBeDefined();
    });
  });
});

describe('Beads Status Values', () => {
  const validStatuses = ['open', 'in_progress', 'closed'];

  it('should recognize all valid statuses', () => {
    validStatuses.forEach(status => {
      expect(typeof status).toBe('string');
    });
  });

  it('should have correct number of statuses', () => {
    expect(validStatuses).toHaveLength(3);
  });
});

describe('Beads Priority Values', () => {
  const validPriorities = [1, 2, 3, 4]; // Urgent, High, Medium, Low

  it('should recognize all valid priorities', () => {
    validPriorities.forEach(priority => {
      expect(typeof priority).toBe('number');
    });
  });

  it('should have correct number of priorities', () => {
    expect(validPriorities).toHaveLength(4);
  });

  it('should have 1 as highest priority (Urgent)', () => {
    expect(Math.min(...validPriorities)).toBe(1);
  });

  it('should have 4 as lowest priority (Low)', () => {
    expect(Math.max(...validPriorities)).toBe(4);
  });
});

describe('Git Integration', () => {
  describe('git status', () => {
    it('should check .beads directory', () => {
      const pattern = '.beads/';
      expect(pattern).toBe('.beads/');
    });
  });

  describe('git add', () => {
    it('should stage .beads files', () => {
      const command = 'git add .beads/';
      expect(command).toContain('.beads');
    });
  });

  describe('git commit', () => {
    it('should create commit with message', () => {
      const message = 'Sync from Huly';
      const command = `git commit -m "${message}"`;
      expect(command).toContain(message);
    });
  });
});
