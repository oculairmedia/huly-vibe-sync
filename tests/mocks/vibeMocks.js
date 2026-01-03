/**
 * Mock Factories for Vibe Kanban API Responses
 *
 * Provides reusable mock data for Vibe Kanban API testing
 */

/**
 * Create a mock Vibe project
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock project object
 */
export function createMockVibeProject(overrides = {}) {
  return {
    id: overrides.id || 1,
    name: overrides.name || 'Test Project',
    identifier: overrides.identifier || 'TEST',
    description: overrides.description || 'Test project description',
    created_at: overrides.created_at || new Date(Date.now() - 86400000).toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock Vibe task
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock task object
 */
export function createMockVibeTask(overrides = {}) {
  return {
    id: overrides.id || 1,
    project_id: overrides.project_id || 1,
    title: overrides.title || 'Test Task',
    description: overrides.description || 'Test task description',
    status: overrides.status || 'todo',
    priority: overrides.priority || 'medium',
    created_at: overrides.created_at || new Date(Date.now() - 86400000).toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock list projects response
 * @param {Array|number} projects - Array of projects or count
 * @returns {Array} Mock projects array
 */
export function createMockListProjectsResponse(projects = []) {
  if (Array.isArray(projects)) {
    return projects;
  }

  return Array.from({ length: projects }, (_, i) =>
    createMockVibeProject({
      id: i + 1,
      name: `Project ${i + 1}`,
      identifier: `PROJ${i + 1}`,
    }),
  );
}

/**
 * Create a mock list tasks response
 * @param {Array|number} tasks - Array of tasks or count
 * @param {number} projectId - Project ID
 * @returns {Array} Mock tasks array
 */
export function createMockListTasksResponse(tasks = [], projectId = 1) {
  if (Array.isArray(tasks)) {
    return tasks;
  }

  return Array.from({ length: tasks }, (_, i) =>
    createMockVibeTask({
      id: i + 1,
      project_id: projectId,
      title: `Task ${i + 1}`,
      status: ['todo', 'inprogress', 'inreview', 'done'][i % 4],
    }),
  );
}

/**
 * Create a mock create task response
 * @param {Object} taskData - Task data
 * @returns {Object} Mock created task
 */
export function createMockCreateTaskResponse(taskData = {}) {
  return createMockVibeTask({
    id: taskData.id || Math.floor(Math.random() * 10000),
    ...taskData,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

/**
 * Create a mock update task response
 * @param {number} taskId - Task ID
 * @param {Object} updates - Updated fields
 * @returns {Object} Mock updated task
 */
export function createMockUpdateTaskResponse(taskId, updates = {}) {
  return createMockVibeTask({
    id: taskId,
    ...updates,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Create a mock delete response
 * @param {number} id - Resource ID
 * @returns {Object} Mock delete response
 */
export function createMockDeleteResponse(id) {
  return {
    success: true,
    id,
    deleted_at: new Date().toISOString(),
  };
}

/**
 * Create a mock error response
 * @param {string} message - Error message
 * @param {number} status - HTTP status code
 * @returns {Object} Mock error response
 */
export function createMockVibeErrorResponse(message, status = 500) {
  return {
    error: message,
    status,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a batch of Vibe projects with tasks
 * @param {number} projectCount - Number of projects
 * @param {number} tasksPerProject - Tasks per project
 * @returns {Object} Object with projects and tasks
 */
export function createMockVibeProjectsWithTasks(projectCount = 3, tasksPerProject = 5) {
  const projects = Array.from({ length: projectCount }, (_, i) =>
    createMockVibeProject({
      id: i + 1,
      name: `Project ${i + 1}`,
      identifier: `PROJ${i + 1}`,
    }),
  );

  const tasksByProject = {};
  projects.forEach((project) => {
    tasksByProject[project.id] = Array.from({ length: tasksPerProject }, (_, j) =>
      createMockVibeTask({
        id: project.id * 100 + j + 1,
        project_id: project.id,
        title: `Task ${j + 1} for ${project.name}`,
        status: ['todo', 'inprogress', 'inreview', 'done'][j % 4],
      }),
    );
  });

  return {
    projects,
    tasksByProject,
    totalTasks: projectCount * tasksPerProject,
  };
}

/**
 * Create a mock task attempt
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock task attempt
 */
export function createMockTaskAttempt(overrides = {}) {
  return {
    id: overrides.id || 'attempt-uuid-1',
    task_id: overrides.task_id || 'task-uuid-1',
    executor: overrides.executor || 'CLAUDE_CODE',
    base_branch: overrides.base_branch || 'main',
    attempt_branch: overrides.attempt_branch || 'task/test-attempt',
    status: overrides.status || 'in_progress',
    created_at: overrides.created_at || new Date().toISOString(),
    completed_at: overrides.completed_at || null,
    ...overrides,
  };
}

/**
 * Create a mock execution process
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock execution process
 */
export function createMockExecutionProcess(overrides = {}) {
  return {
    id: overrides.id || 'process-uuid-1',
    task_attempt_id: overrides.task_attempt_id || 'attempt-uuid-1',
    executor: overrides.executor || 'CLAUDE_CODE',
    status: overrides.status || 'running',
    exit_code: overrides.exit_code || null,
    started_at: overrides.started_at || new Date().toISOString(),
    completed_at: overrides.completed_at || null,
    runtime_ms: overrides.runtime_ms || null,
    ...overrides,
  };
}

/**
 * Create a mock API response wrapper
 * @param {any} data - Response data
 * @param {boolean} success - Success status
 * @param {string} message - Optional message
 * @returns {Object} Mock API response
 */
export function createMockApiResponse(data, success = true, message = null) {
  return {
    success,
    data,
    ...(message && { message }),
  };
}

/**
 * Create mock Vibe API responses for nock
 * @param {string} baseUrl - Base URL for mocking
 * @param {Object} options - Mock configuration
 * @returns {Object} Mock configuration for nock
 */
export function createVibeApiMocks(baseUrl, options = {}) {
  return {
    listProjects: {
      url: `${baseUrl}/projects`,
      method: 'GET',
      response: createMockListProjectsResponse(options.projects || []),
    },
    getProject: (projectId) => ({
      url: `${baseUrl}/projects/${projectId}`,
      method: 'GET',
      response: createMockVibeProject({ id: projectId, ...options.project }),
    }),
    listTasks: (projectId) => ({
      url: `${baseUrl}/tasks?project_id=${projectId}`,
      method: 'GET',
      response: createMockListTasksResponse(options.tasks || [], projectId),
    }),
    createTask: (taskData) => ({
      url: `${baseUrl}/tasks`,
      method: 'POST',
      response: createMockCreateTaskResponse(taskData),
    }),
    updateTask: (taskId, updates) => ({
      url: `${baseUrl}/tasks/${taskId}`,
      method: 'PUT',
      response: createMockUpdateTaskResponse(taskId, updates),
    }),
    deleteTask: (taskId) => ({
      url: `${baseUrl}/tasks/${taskId}`,
      method: 'DELETE',
      response: createMockDeleteResponse(taskId),
    }),
  };
}
