/**
 * Mock Factories for Huly API Responses
 *
 * Provides reusable mock data for Huly REST API testing
 */

/**
 * Create a mock Huly project
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock project object
 */
export function createMockHulyProject(overrides = {}) {
  const identifier = overrides.identifier || 'TEST';
  const name = overrides.name || 'Test Project';

  return {
    _id: overrides._id || `project-${identifier.toLowerCase()}`,
    identifier,
    name,
    description: overrides.description || `Description for ${name}`,
    private: overrides.private ?? false,
    archived: overrides.archived ?? false,
    owners: overrides.owners || [],
    members: overrides.members || [],
    createdOn: overrides.createdOn || Date.now() - 86400000, // 1 day ago
    modifiedOn: overrides.modifiedOn || Date.now(),
    space: overrides.space || `space-${identifier.toLowerCase()}`,
    ...overrides,
  };
}

/**
 * Create a mock Huly issue
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock issue object
 */
export function createMockHulyIssue(overrides = {}) {
  const projectId = overrides.project || 'project-test';
  const number = overrides.number || 1;
  const identifier = overrides.identifier || `TEST-${number}`;

  return {
    _id: overrides._id || `issue-${identifier.toLowerCase()}`,
    identifier,
    title: overrides.title || `Issue ${number}`,
    description: overrides.description || `Description for issue ${number}`,
    status: overrides.status || 'Backlog',
    priority: overrides.priority || 'Medium',
    assignee: overrides.assignee || null,
    project: projectId,
    space: overrides.space || 'space-test',
    number,
    createdBy: overrides.createdBy || 'user-1',
    modifiedBy: overrides.modifiedBy || 'user-1',
    createdOn: overrides.createdOn || Date.now() - 86400000,
    modifiedOn: overrides.modifiedOn || Date.now(),
    dueDate: overrides.dueDate || null,
    estimation: overrides.estimation || 0,
    component: overrides.component || null,
    milestone: overrides.milestone || null,
    labels: overrides.labels || [],
    ...overrides,
  };
}

/**
 * Create a mock health check response
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock health response
 */
export function createMockHealthResponse(overrides = {}) {
  return {
    status: overrides.status || 'ok',
    connected: overrides.connected ?? true,
    version: overrides.version || '1.0.0',
    timestamp: overrides.timestamp || Date.now(),
    ...overrides,
  };
}

/**
 * Create a mock tool call response
 * @param {string} toolName - Tool name
 * @param {*} content - Tool result content
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock tool response
 */
export function createMockToolResponse(toolName, content, overrides = {}) {
  return {
    success: true,
    data: {
      result: content,
    },
    metadata: {
      executionTime: overrides.executionTime || 100,
      timestamp: overrides.timestamp || Date.now(),
    },
    ...overrides,
  };
}

/**
 * Create a mock projects list response
 * @param {Array} projects - Array of projects or count
 * @returns {Object} Mock list projects response
 */
export function createMockListProjectsResponse(projects = []) {
  const projectList = Array.isArray(projects)
    ? projects
    : Array.from({ length: projects }, (_, i) =>
        createMockHulyProject({
          identifier: `PROJ${i + 1}`,
          name: `Project ${i + 1}`,
        }),
      );

  return {
    projects: projectList,
    total: projectList.length,
    hasMore: false,
  };
}

/**
 * Create a mock issues list response
 * @param {Array|number} issues - Array of issues or count
 * @param {string} projectId - Project identifier
 * @returns {Object} Mock list issues response
 */
export function createMockListIssuesResponse(issues = [], projectId = 'TEST') {
  const issueList = Array.isArray(issues)
    ? issues
    : Array.from({ length: issues }, (_, i) =>
        createMockHulyIssue({
          identifier: `${projectId}-${i + 1}`,
          number: i + 1,
          project: `project-${projectId.toLowerCase()}`,
        }),
      );

  return {
    issues: issueList,
    total: issueList.length,
    hasMore: false,
  };
}

/**
 * Create a mock create issue response
 * @param {Object} issueData - Issue data
 * @returns {Object} Mock create response
 */
export function createMockCreateIssueResponse(issueData = {}) {
  const issue = createMockHulyIssue(issueData);

  return {
    success: true,
    issue,
    identifier: issue.identifier,
  };
}

/**
 * Create a mock update issue response
 * @param {string} issueId - Issue identifier
 * @param {string} field - Field that was updated
 * @param {*} value - New value
 * @returns {Object} Mock update response
 */
export function createMockUpdateIssueResponse(issueId, field, value) {
  return {
    success: true,
    issueId,
    field,
    value,
    timestamp: Date.now(),
  };
}

/**
 * Create a mock error response
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @returns {Object} Mock error response
 */
export function createMockErrorResponse(message, statusCode = 500) {
  return {
    error: true,
    message,
    statusCode,
    timestamp: Date.now(),
  };
}

/**
 * Create a batch of mock projects with issues
 * @param {number} projectCount - Number of projects
 * @param {number} issuesPerProject - Issues per project
 * @returns {Object} Object with projects and issues
 */
export function createMockProjectsWithIssues(projectCount = 3, issuesPerProject = 5) {
  const projects = Array.from({ length: projectCount }, (_, i) => {
    const identifier = `PROJ${i + 1}`;
    return createMockHulyProject({
      identifier,
      name: `Project ${i + 1}`,
    });
  });

  const issuesByProject = {};
  projects.forEach((project, i) => {
    const identifier = project.identifier;
    issuesByProject[identifier] = Array.from({ length: issuesPerProject }, (_, j) =>
      createMockHulyIssue({
        identifier: `${identifier}-${j + 1}`,
        number: j + 1,
        title: `Issue ${j + 1} for ${project.name}`,
        project: project._id,
        status: ['Backlog', 'In Progress', 'In Review', 'Done'][j % 4],
        priority: ['Low', 'Medium', 'High'][j % 3],
      }),
    );
  });

  return {
    projects,
    issuesByProject,
    totalIssues: projectCount * issuesPerProject,
  };
}

/**
 * Create mock Huly API responses for nock
 * @param {string} baseUrl - Base URL for mocking
 * @param {Object} options - Mock configuration
 * @returns {Object} Mock configuration for nock
 */
export function createHulyApiMocks(baseUrl, options = {}) {
  return {
    health: {
      url: baseUrl.replace('/api', '/health'),
      method: 'GET',
      response: createMockHealthResponse(options.health),
    },
    listProjects: {
      url: `${baseUrl}/tools/huly_list_projects`,
      method: 'POST',
      response: createMockToolResponse(
        'huly_list_projects',
        createMockListProjectsResponse(options.projects || []),
      ),
    },
    listIssues: (projectId) => ({
      url: `${baseUrl}/tools/huly_list_issues`,
      method: 'POST',
      response: createMockToolResponse(
        'huly_list_issues',
        createMockListIssuesResponse(options.issues || [], projectId),
      ),
    }),
    createIssue: (issueData) => ({
      url: `${baseUrl}/tools/huly_create_issue`,
      method: 'POST',
      response: createMockToolResponse(
        'huly_create_issue',
        createMockCreateIssueResponse(issueData),
      ),
    }),
    updateIssue: (issueId, field, value) => ({
      url: `${baseUrl}/tools/huly_update_issue`,
      method: 'POST',
      response: createMockToolResponse(
        'huly_update_issue',
        createMockUpdateIssueResponse(issueId, field, value),
      ),
    }),
  };
}
