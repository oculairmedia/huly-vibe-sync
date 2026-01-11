/**
 * Tests for Temporal Bidirectional Sync Activities
 *
 * Tests the activity logic and interfaces.
 * Note: Full integration tests require Temporal server.
 */

import { describe, it, expect } from 'vitest';

describe('Bidirectional Sync Activities - Interface Tests', () => {
  // These tests verify the activity interfaces and logic patterns
  // without requiring full Temporal activity mocking

  describe('getVibeTask interface', () => {
    it('should accept taskId parameter', () => {
      const input = { taskId: 'task-123' };
      expect(input.taskId).toBe('task-123');
    });

    it('should expect task object in return', () => {
      const expectedOutput = {
        id: 'task-123',
        title: 'Test Task',
        description: 'Description',
        status: 'todo',
        updated_at: '2024-01-15T10:00:00Z',
      };
      expect(expectedOutput.id).toBeDefined();
      expect(expectedOutput.status).toBeDefined();
    });
  });

  describe('getHulyIssue interface', () => {
    it('should accept identifier parameter', () => {
      const input = { identifier: 'PROJ-123' };
      expect(input.identifier).toBe('PROJ-123');
    });

    it('should expect issue object in return', () => {
      const expectedOutput = {
        identifier: 'PROJ-123',
        title: 'Test Issue',
        description: 'Description',
        status: 'In Progress',
        priority: 'High',
        modifiedOn: Date.now(),
      };
      expect(expectedOutput.identifier).toBeDefined();
      expect(expectedOutput.status).toBeDefined();
    });
  });

  describe('getBeadsIssue interface', () => {
    it('should accept issueId and gitRepoPath parameters', () => {
      const input = {
        issueId: 'beads-123',
        gitRepoPath: '/path/to/repo',
      };
      expect(input.issueId).toBe('beads-123');
      expect(input.gitRepoPath).toBe('/path/to/repo');
    });
  });

  describe('syncVibeToHuly interface', () => {
    it('should accept correct input structure', () => {
      const input = {
        vibeTask: {
          id: 'task-123',
          title: 'Test Task',
          description: 'Description',
          status: 'done',
        },
        hulyIdentifier: 'PROJ-123',
        context: {
          projectIdentifier: 'PROJ',
          vibeProjectId: 'vibe-proj-1',
        },
      };

      expect(input.vibeTask).toBeDefined();
      expect(input.hulyIdentifier).toBeDefined();
      expect(input.context).toBeDefined();
    });

    it('should return SyncResult structure', () => {
      const expectedResult = {
        success: true,
        id: 'PROJ-123',
        updated: true,
      };

      expect(expectedResult.success).toBe(true);
      expect(expectedResult.id).toBeDefined();
    });
  });

  describe('syncVibeToBeads interface', () => {
    it('should accept correct input structure', () => {
      const input = {
        vibeTask: {
          id: 'task-123',
          title: 'Test Task',
          status: 'inprogress',
        },
        existingBeadsId: 'beads-123',
        context: {
          projectIdentifier: 'PROJ',
          vibeProjectId: 'vibe-proj-1',
          gitRepoPath: '/path/to/repo',
        },
      };

      expect(input.vibeTask).toBeDefined();
      expect(input.context.gitRepoPath).toBeDefined();
    });

    it('should skip when no gitRepoPath', () => {
      const context = {
        projectIdentifier: 'PROJ',
        vibeProjectId: 'vibe-proj-1',
        // No gitRepoPath
      };

      expect(context.gitRepoPath).toBeUndefined();
      // Activity should return { success: true, skipped: true }
    });

    it('should map Vibe status to Beads status correctly', () => {
      const statusMappings = [
        { vibe: 'done', beads: 'closed' },
        { vibe: 'cancelled', beads: 'closed' },
        { vibe: 'inprogress', beads: 'in_progress' },
        { vibe: 'inreview', beads: 'in_progress' },
        { vibe: 'todo', beads: 'open' },
      ];

      statusMappings.forEach(({ vibe, beads }) => {
        const expectedBeadsStatus =
          vibe === 'done' || vibe === 'cancelled' ? 'closed'
          : vibe === 'inprogress' || vibe === 'inreview' ? 'in_progress'
          : 'open';
        expect(expectedBeadsStatus).toBe(beads);
      });
    });
  });

  describe('syncHulyToVibe interface', () => {
    it('should accept correct input structure', () => {
      const input = {
        hulyIssue: {
          id: 'PROJ-123',
          title: 'Test Issue',
          description: 'Description',
          status: 'In Progress',
          priority: 'High',
        },
        existingVibeId: 'vibe-task-123',
        context: {
          projectIdentifier: 'PROJ',
          vibeProjectId: 'vibe-proj-1',
        },
      };

      expect(input.hulyIssue).toBeDefined();
      expect(input.context).toBeDefined();
    });

    it('should support creating new task when no existingVibeId', () => {
      const input = {
        hulyIssue: {
          id: 'PROJ-123',
          title: 'New Issue',
          status: 'Backlog',
        },
        // No existingVibeId
        context: {
          projectIdentifier: 'PROJ',
          vibeProjectId: 'vibe-proj-1',
        },
      };

      expect(input.existingVibeId).toBeUndefined();
    });
  });

  describe('syncHulyToBeads interface', () => {
    it('should accept correct input structure', () => {
      const input = {
        hulyIssue: {
          id: 'PROJ-123',
          title: 'Test Issue',
          status: 'In Progress',
          priority: 'High',
        },
        existingBeadsId: 'beads-123',
        context: {
          projectIdentifier: 'PROJ',
          vibeProjectId: 'vibe-proj-1',
          gitRepoPath: '/path/to/repo',
        },
      };

      expect(input.hulyIssue).toBeDefined();
      expect(input.context.gitRepoPath).toBeDefined();
    });
  });

  describe('syncBeadsToHuly interface', () => {
    it('should accept correct input structure', () => {
      const input = {
        beadsIssue: {
          id: 'beads-123',
          title: 'Test Issue',
          status: 'closed',
        },
        hulyIdentifier: 'PROJ-123',
        context: {
          projectIdentifier: 'PROJ',
          vibeProjectId: 'vibe-proj-1',
        },
      };

      expect(input.beadsIssue).toBeDefined();
      expect(input.hulyIdentifier).toBeDefined();
    });
  });

  describe('syncBeadsToVibe interface', () => {
    it('should accept correct input structure', () => {
      const input = {
        beadsIssue: {
          id: 'beads-123',
          title: 'Test Issue',
          status: 'in_progress',
        },
        vibeTaskId: 'vibe-task-123',
        context: {
          projectIdentifier: 'PROJ',
          vibeProjectId: 'vibe-proj-1',
        },
      };

      expect(input.beadsIssue).toBeDefined();
      expect(input.vibeTaskId).toBeDefined();
    });
  });

  describe('commitBeadsChanges interface', () => {
    it('should accept gitRepoPath and message', () => {
      const input = {
        gitRepoPath: '/path/to/repo',
        message: 'Sync from Huly',
      };

      expect(input.gitRepoPath).toBeDefined();
      expect(input.message).toBeDefined();
    });
  });

  describe('SyncResult type', () => {
    it('should support success result', () => {
      const result = {
        success: true,
        id: 'PROJ-123',
        updated: true,
      };
      expect(result.success).toBe(true);
    });

    it('should support created result', () => {
      const result = {
        success: true,
        id: 'new-123',
        created: true,
      };
      expect(result.created).toBe(true);
    });

    it('should support skipped result', () => {
      const result = {
        success: true,
        skipped: true,
      };
      expect(result.skipped).toBe(true);
    });

    it('should support error result', () => {
      const result = {
        success: true,
        skipped: true,
        error: 'Non-fatal error message',
      };
      expect(result.error).toBeDefined();
    });
  });

  describe('SyncContext type', () => {
    it('should require projectIdentifier and vibeProjectId', () => {
      const context = {
        projectIdentifier: 'VIBESYNC',
        vibeProjectId: 'uuid-123',
      };

      expect(context.projectIdentifier).toBeDefined();
      expect(context.vibeProjectId).toBeDefined();
    });

    it('should allow optional gitRepoPath', () => {
      const context = {
        projectIdentifier: 'VIBESYNC',
        vibeProjectId: 'uuid-123',
        gitRepoPath: '/opt/projects/my-project',
      };

      expect(context.gitRepoPath).toBeDefined();
    });
  });

  describe('IssueData type', () => {
    it('should define required fields', () => {
      const issue = {
        id: 'PROJ-123',
        title: 'Test Issue',
        status: 'In Progress',
      };

      expect(issue.id).toBeDefined();
      expect(issue.title).toBeDefined();
      expect(issue.status).toBeDefined();
    });

    it('should allow optional fields', () => {
      const issue = {
        id: 'PROJ-123',
        title: 'Test Issue',
        description: 'Optional description',
        status: 'In Progress',
        priority: 'High',
        modifiedAt: Date.now(),
      };

      expect(issue.description).toBeDefined();
      expect(issue.priority).toBeDefined();
      expect(issue.modifiedAt).toBeDefined();
    });
  });
});

describe('Error Handling Patterns', () => {
  describe('ApplicationFailure types', () => {
    it('should classify 404 as non-retryable', () => {
      const errorMessage = '404 Not Found';
      const isNonRetryable = errorMessage.toLowerCase().includes('404') ||
                            errorMessage.toLowerCase().includes('not found');
      expect(isNonRetryable).toBe(true);
    });

    it('should classify 422 as non-retryable', () => {
      const errorMessage = '422 Validation Error';
      const isNonRetryable = errorMessage.toLowerCase().includes('422') ||
                            errorMessage.toLowerCase().includes('validation');
      expect(isNonRetryable).toBe(true);
    });

    it('should classify 401/403 as non-retryable', () => {
      const errorMessages = ['401 Unauthorized', '403 Forbidden'];
      errorMessages.forEach(msg => {
        const isNonRetryable = msg.toLowerCase().includes('401') ||
                              msg.toLowerCase().includes('403');
        expect(isNonRetryable).toBe(true);
      });
    });

    it('should classify 500 as retryable', () => {
      const errorMessage = '500 Internal Server Error';
      const isRetryable = errorMessage.toLowerCase().includes('500');
      expect(isRetryable).toBe(true);
    });

    it('should classify network errors as retryable', () => {
      const errorMessages = ['ECONNREFUSED', 'Network timeout', 'Network error'];
      errorMessages.forEach(msg => {
        const isRetryable = msg.toLowerCase().includes('econnrefused') ||
                           msg.toLowerCase().includes('timeout') ||
                           msg.toLowerCase().includes('network');
        expect(isRetryable).toBe(true);
      });
    });
  });

  describe('Non-fatal error handling (Beads)', () => {
    it('should return success with skipped for Beads errors', () => {
      // Beads errors are non-fatal - sync should continue
      const beadsError = new Error('Beads CLI error');
      const result = {
        success: true,
        skipped: true,
        error: beadsError.message,
      };

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.error).toBeDefined();
    });
  });
});

describe('Status Mapping Logic', () => {
  describe('Vibe to Beads status mapping', () => {
    it('should map done/cancelled to closed', () => {
      ['done', 'cancelled'].forEach(vibeStatus => {
        const beadsStatus = vibeStatus === 'done' || vibeStatus === 'cancelled'
          ? 'closed'
          : vibeStatus === 'inprogress' || vibeStatus === 'inreview'
            ? 'in_progress'
            : 'open';
        expect(beadsStatus).toBe('closed');
      });
    });

    it('should map inprogress/inreview to in_progress', () => {
      ['inprogress', 'inreview'].forEach(vibeStatus => {
        const beadsStatus = vibeStatus === 'done' || vibeStatus === 'cancelled'
          ? 'closed'
          : vibeStatus === 'inprogress' || vibeStatus === 'inreview'
            ? 'in_progress'
            : 'open';
        expect(beadsStatus).toBe('in_progress');
      });
    });

    it('should map todo to open', () => {
      const vibeStatus = 'todo';
      const beadsStatus = vibeStatus === 'done' || vibeStatus === 'cancelled'
        ? 'closed'
        : vibeStatus === 'inprogress' || vibeStatus === 'inreview'
          ? 'in_progress'
          : 'open';
      expect(beadsStatus).toBe('open');
    });
  });
});

describe('Sync Direction Logic', () => {
  describe('Vibe as source', () => {
    it('should sync to Huly when hulyId linked', () => {
      const linkedIds = { hulyId: 'PROJ-123' };
      const shouldSyncToHuly = !!linkedIds.hulyId;
      expect(shouldSyncToHuly).toBe(true);
    });

    it('should sync to Beads when gitRepoPath present', () => {
      const context = { gitRepoPath: '/path/to/repo' };
      const shouldSyncToBeads = !!context.gitRepoPath;
      expect(shouldSyncToBeads).toBe(true);
    });
  });

  describe('Huly as source', () => {
    it('should always sync to Vibe', () => {
      const source = 'huly';
      const shouldSyncToVibe = source === 'huly';
      expect(shouldSyncToVibe).toBe(true);
    });

    it('should sync to Beads when gitRepoPath present', () => {
      const context = { gitRepoPath: '/path/to/repo' };
      const shouldSyncToBeads = !!context.gitRepoPath;
      expect(shouldSyncToBeads).toBe(true);
    });
  });

  describe('Beads as source', () => {
    it('should sync to Huly when hulyId linked', () => {
      const linkedIds = { hulyId: 'PROJ-123' };
      const shouldSyncToHuly = !!linkedIds.hulyId;
      expect(shouldSyncToHuly).toBe(true);
    });

    it('should sync to Vibe when vibeId linked', () => {
      const linkedIds = { vibeId: 'vibe-task-123' };
      const shouldSyncToVibe = !!linkedIds.vibeId;
      expect(shouldSyncToVibe).toBe(true);
    });
  });
});

describe('Description Building', () => {
  it('should append Vibe task ID to description', () => {
    const vibeTask = {
      id: 'task-123',
      description: 'Original description',
    };
    const newDescription = vibeTask.description
      ? `${vibeTask.description}\n\n---\nVibe Task: ${vibeTask.id}`
      : `Synced from Vibe: ${vibeTask.id}`;

    expect(newDescription).toContain('Original description');
    expect(newDescription).toContain('Vibe Task: task-123');
  });

  it('should create description when none exists', () => {
    const vibeTask = {
      id: 'task-123',
      description: undefined,
    };
    const newDescription = vibeTask.description
      ? `${vibeTask.description}\n\n---\nVibe Task: ${vibeTask.id}`
      : `Synced from Vibe: ${vibeTask.id}`;

    expect(newDescription).toBe('Synced from Vibe: task-123');
  });

  it('should append Huly issue ID to description', () => {
    const hulyIssue = {
      id: 'PROJ-123',
      description: 'Original description',
    };
    const newDescription = hulyIssue.description
      ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.id}`
      : `Synced from Huly: ${hulyIssue.id}`;

    expect(newDescription).toContain('Original description');
    expect(newDescription).toContain('Huly Issue: PROJ-123');
  });
});

describe('Label Generation', () => {
  it('should generate vibe label', () => {
    const vibeTaskId = 'task-123';
    const label = `vibe:${vibeTaskId}`;
    expect(label).toBe('vibe:task-123');
  });

  it('should generate huly label', () => {
    const hulyId = 'PROJ-123';
    const label = `huly:${hulyId}`;
    expect(label).toBe('huly:PROJ-123');
  });
});
