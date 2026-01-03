/**
 * Mock Factories for Beads CLI Responses
 *
 * Provides reusable mock data for Beads issue tracker testing.
 * Beads uses a CLI interface (bd command) that returns JSON output.
 */

/**
 * Create a mock Beads issue
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock issue object matching Beads JSON output
 */
export function createMockBeadsIssue(overrides = {}) {
  const id = overrides.id || 'test-project-abc';
  const number = id.split('-').pop() || 'abc';

  return {
    id,
    title: overrides.title || `Test Issue ${number}`,
    status: overrides.status || 'open',
    priority: overrides.priority ?? 2, // P0-P4, default P2 (medium)
    issue_type: overrides.issue_type || 'task',
    created_at: overrides.created_at || new Date(Date.now() - 86400000).toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
    closed_at: overrides.closed_at || null,
    description: overrides.description || null,
    labels: overrides.labels || [],
    ...overrides,
  };
}

/**
 * Create multiple mock Beads issues
 * @param {number} count - Number of issues to create
 * @param {Object} defaults - Default properties for all issues
 * @returns {Array} Array of mock issues
 */
export function createMockBeadsIssueList(count = 3, defaults = {}) {
  const issues = [];
  const suffixes = ['abc', 'def', 'ghi', 'jkl', 'mno', 'pqr', 'stu', 'vwx', 'yza', 'bcd'];

  for (let i = 0; i < count; i++) {
    const suffix = suffixes[i % suffixes.length];
    issues.push(createMockBeadsIssue({
      id: `test-project-${suffix}`,
      title: `Issue ${i + 1}`,
      priority: i % 5, // Distribute P0-P4
      ...defaults,
    }));
  }

  return issues;
}

/**
 * Create mock CLI output for bd list command
 * @param {Array} issues - Array of issues (uses createMockBeadsIssueList if not provided)
 * @returns {string} JSON string matching bd list --json output
 */
export function createMockListOutput(issues = null) {
  const issueList = issues || createMockBeadsIssueList(3);
  return JSON.stringify(issueList);
}

/**
 * Create mock CLI output for bd show command
 * @param {Object} issue - Issue object (uses createMockBeadsIssue if not provided)
 * @returns {string} JSON string matching bd show --json output (returns array with one item)
 */
export function createMockShowOutput(issue = null) {
  const issueObj = issue || createMockBeadsIssue();
  // bd show --json returns an array with the single issue
  return JSON.stringify([issueObj]);
}

/**
 * Create mock CLI output for bd create command
 * @param {Object} overrides - Properties to override
 * @returns {string} JSON string matching bd create --json output
 */
export function createMockCreateOutput(overrides = {}) {
  const issue = createMockBeadsIssue({
    id: overrides.id || `test-project-${Date.now().toString(36).slice(-3)}`,
    title: overrides.title || 'New Issue',
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  });
  return JSON.stringify(issue);
}

/**
 * Create mock Beads database record (as stored in sync database)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock database record with Beads fields
 */
export function createMockBeadsDbRecord(overrides = {}) {
  return {
    identifier: overrides.identifier || 'TEST-1',
    project_identifier: overrides.project_identifier || 'TEST',
    huly_id: overrides.huly_id || 'huly-issue-1',
    vibe_issue_id: overrides.vibe_issue_id || null,
    beads_issue_id: overrides.beads_issue_id || 'test-project-abc',
    title: overrides.title || 'Test Issue',
    description: overrides.description || 'Description',
    status: overrides.status || 'Backlog',
    priority: overrides.priority || 'Medium',
    beads_status: overrides.beads_status || 'open',
    huly_modified_at: overrides.huly_modified_at || Date.now() - 3600000,
    beads_modified_at: overrides.beads_modified_at || Date.now(),
    vibe_modified_at: overrides.vibe_modified_at || null,
    last_sync_source: overrides.last_sync_source || 'huly',
    sync_count: overrides.sync_count || 1,
    ...overrides,
  };
}

/**
 * Create mock execSync function for testing BeadsService
 *
 * Usage:
 *   const mockExec = createMockExecSync({
 *     'bd list --json --no-daemon': createMockListOutput(),
 *     'bd show issue-123 --json --no-daemon': createMockShowOutput(),
 *   });
 *   vi.spyOn(child_process, 'execSync').mockImplementation(mockExec);
 *
 * @param {Object} commandOutputs - Map of command strings to outputs
 * @param {Object} options - Additional options
 * @param {boolean} options.throwOnUnknown - Throw error for unknown commands (default: true)
 * @returns {Function} Mock function for execSync
 */
export function createMockExecSync(commandOutputs = {}, options = {}) {
  const { throwOnUnknown = true } = options;

  return (command, execOptions = {}) => {
    // Normalize command for matching (remove extra spaces)
    const normalizedCommand = command.replace(/\s+/g, ' ').trim();

    // Check for exact match first
    if (commandOutputs[normalizedCommand] !== undefined) {
      return commandOutputs[normalizedCommand];
    }

    // Check for partial match (command starts with key)
    for (const [key, value] of Object.entries(commandOutputs)) {
      if (normalizedCommand.startsWith(key) || normalizedCommand.includes(key)) {
        return value;
      }
    }

    // Check for pattern match (regex)
    for (const [key, value] of Object.entries(commandOutputs)) {
      if (key.startsWith('/') && key.endsWith('/')) {
        const regex = new RegExp(key.slice(1, -1));
        if (regex.test(normalizedCommand)) {
          return value;
        }
      }
    }

    if (throwOnUnknown) {
      const error = new Error(`Command failed: ${command}`);
      error.status = 1;
      throw error;
    }

    return '';
  };
}

/**
 * Create a mock function that tracks calls and returns configured responses
 * Useful for testing that BeadsService makes correct CLI calls
 *
 * @param {Object} responses - Map of command patterns to responses
 * @returns {Object} Object with mock function and call history
 */
export function createMockExecTracker(responses = {}) {
  const calls = [];

  const mockFn = (command, options = {}) => {
    calls.push({ command, options, timestamp: Date.now() });

    // Find matching response
    for (const [pattern, response] of Object.entries(responses)) {
      if (command.includes(pattern)) {
        if (response instanceof Error) {
          throw response;
        }
        return response;
      }
    }

    // Default: return empty string
    return '';
  };

  return {
    mock: mockFn,
    calls,
    getCallCount: () => calls.length,
    getLastCall: () => calls[calls.length - 1],
    getCallsMatching: (pattern) => calls.filter(c => c.command.includes(pattern)),
    reset: () => { calls.length = 0; },
  };
}

/**
 * Standard Beads CLI error messages for testing error handling
 */
export const BEADS_ERRORS = {
  NOT_INITIALIZED: 'Error: Not a beads repository (or any parent up to /)\nRun \'bd init\' to initialize',
  ISSUE_NOT_FOUND: (id) => `Error: Issue not found: ${id}`,
  INVALID_PRIORITY: (p) => `Error: Invalid priority: ${p}. Must be 0-4 or P0-P4`,
  INVALID_STATUS: (s) => `Error: Invalid status: ${s}. Must be open or closed`,
  DATABASE_LOCKED: 'Error: database is locked',
  PERMISSION_DENIED: 'Error: permission denied',
};

/**
 * Create an error that simulates Beads CLI failure
 * @param {string} message - Error message
 * @param {number} exitCode - Exit code (default: 1)
 * @returns {Error} Error object matching execSync error format
 */
export function createBeadsCliError(message, exitCode = 1) {
  const error = new Error(`Command failed: bd ...\n${message}`);
  error.status = exitCode;
  error.stderr = message;
  return error;
}

/**
 * Mock configuration for BeadsService testing
 */
export const MOCK_CONFIG = {
  default: {
    sync: {
      dryRun: false,
      beads: { enabled: true },
    },
  },
  dryRun: {
    sync: {
      dryRun: true,
      beads: { enabled: true },
    },
  },
  disabled: {
    sync: {
      dryRun: false,
      beads: { enabled: false },
    },
  },
};

/**
 * Sample issue data for testing various scenarios
 */
export const SAMPLE_ISSUES = {
  openTask: createMockBeadsIssue({
    id: 'project-open1',
    title: 'Open Task',
    status: 'open',
    priority: 2,
    issue_type: 'task',
  }),

  closedBug: createMockBeadsIssue({
    id: 'project-closed1',
    title: 'Fixed Bug',
    status: 'closed',
    priority: 1,
    issue_type: 'bug',
    closed_at: new Date().toISOString(),
  }),

  urgentFeature: createMockBeadsIssue({
    id: 'project-urgent1',
    title: 'Urgent Feature',
    status: 'open',
    priority: 0, // P0 - Urgent
    issue_type: 'feature',
  }),

  lowPriorityChore: createMockBeadsIssue({
    id: 'project-chore1',
    title: 'Cleanup Chore',
    status: 'open',
    priority: 4, // P4 - No priority
    issue_type: 'chore',
  }),

  epicWithDescription: createMockBeadsIssue({
    id: 'project-epic1',
    title: 'Big Epic',
    status: 'open',
    priority: 1, // P1 - High
    issue_type: 'epic',
    description: 'This is a big epic with lots of work',
  }),
};

/**
 * Create paired Huly + Beads issue data for sync testing
 * @param {Object} overrides - Properties to override
 * @returns {Object} Object with hulyIssue and beadsIssue properties
 */
export function createSyncPair(overrides = {}) {
  const identifier = overrides.identifier || 'TEST-1';
  const title = overrides.title || 'Synced Issue';

  return {
    hulyIssue: {
      identifier,
      title,
      status: overrides.hulyStatus || 'Backlog',
      priority: overrides.hulyPriority || 'Medium',
      type: overrides.hulyType || 'Task',
      description: overrides.description || 'Issue description',
      modifiedOn: overrides.hulyModifiedOn || Date.now(),
      project: overrides.project || 'TEST',
    },
    beadsIssue: createMockBeadsIssue({
      id: overrides.beadsId || 'test-project-abc',
      title,
      status: overrides.beadsStatus || 'open',
      priority: overrides.beadsPriority ?? 2,
      issue_type: overrides.beadsType || 'task',
      updated_at: overrides.beadsModifiedOn
        ? new Date(overrides.beadsModifiedOn).toISOString()
        : new Date().toISOString(),
    }),
    dbRecord: createMockBeadsDbRecord({
      identifier,
      beads_issue_id: overrides.beadsId || 'test-project-abc',
      title,
      status: overrides.hulyStatus || 'Backlog',
      priority: overrides.hulyPriority || 'Medium',
      beads_status: overrides.beadsStatus || 'open',
      huly_modified_at: overrides.hulyModifiedOn || Date.now() - 3600000,
      beads_modified_at: overrides.beadsModifiedOn || Date.now(),
    }),
  };
}
