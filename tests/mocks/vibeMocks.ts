/**
 * Mock Factories for Vibe Kanban API Responses
 *
 * Provides reusable mock data for Vibe Kanban API testing
 */

interface VibeProject {
  id: number;
  name: string;
  identifier: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface VibeTask {
  id: number;
  project_id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

interface TaskAttempt {
  id: string;
  task_id: string;
  executor: string;
  base_branch: string;
  attempt_branch: string;
  status: string;
  created_at: string;
  completed_at: string | null;
}

interface ExecutionProcess {
  id: string;
  task_attempt_id: string;
  executor: string;
  status: string;
  exit_code: number | null;
  started_at: string;
  completed_at: string | null;
  runtime_ms: number | null;
}

/**
 * Create a mock Vibe project
 * @param overrides - Properties to override
 * @returns Mock project object
 */
export function createMockVibeProject(overrides: Partial<VibeProject> = {}): VibeProject {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? 'Test Project',
    identifier: overrides.identifier ?? 'TEST',
    description: overrides.description ?? 'Test project description',
    created_at: overrides.created_at ?? new Date(Date.now() - 86400000).toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
  };
}

/**
 * Create a mock Vibe task
 * @param overrides - Properties to override
 * @returns Mock task object
 */
export function createMockVibeTask(overrides: Partial<VibeTask> = {}): VibeTask {
  return {
    id: overrides.id ?? 1,
    project_id: overrides.project_id ?? 1,
    title: overrides.title ?? 'Test Task',
    description: overrides.description ?? 'Test task description',
    status: overrides.status ?? 'todo',
    priority: overrides.priority ?? 'medium',
    created_at: overrides.created_at ?? new Date(Date.now() - 86400000).toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
  };
}

/**
 * Create a mock list projects response
 * @param projects - Array of projects or count
 * @returns Mock projects array
 */
export function createMockListProjectsResponse(projects: VibeProject[] | number = []): VibeProject[] {
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
 * @param tasks - Array of tasks or count
 * @param projectId - Project ID
 * @returns Mock tasks array
 */
export function createMockListTasksResponse(tasks: VibeTask[] | number = [], projectId = 1): VibeTask[] {
  if (Array.isArray(tasks)) {
    return tasks;
  }

  return Array.from({ length: tasks }, (_, i) =>
    createMockVibeTask({
      id: i + 1,
      project_id: projectId,
      title: `Task ${i + 1}`,
      status: ['todo', 'inprogress', 'inreview', 'done'][i % 4] ?? 'todo',
    }),
  );
}

/**
 * Create a mock create task response
 * @param taskData - Task data
 * @returns Mock created task
 */
export function createMockCreateTaskResponse(taskData: Partial<VibeTask> = {}): VibeTask {
  return createMockVibeTask({
    id: taskData.id ?? Math.floor(Math.random() * 10000),
    ...taskData,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

/**
 * Create a mock update task response
 * @param taskId - Task ID
 * @param updates - Updated fields
 * @returns Mock updated task
 */
export function createMockUpdateTaskResponse(taskId: number, updates: Partial<VibeTask> = {}): VibeTask {
  return createMockVibeTask({
    id: taskId,
    ...updates,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Create a mock delete response
 * @param id - Resource ID
 * @returns Mock delete response
 */
export function createMockDeleteResponse(id: number): Record<string, unknown> {
  return {
    success: true,
    id,
    deleted_at: new Date().toISOString(),
  };
}

/**
 * Create a mock error response
 * @param message - Error message
 * @param status - HTTP status code
 * @returns Mock error response
 */
export function createMockVibeErrorResponse(message: string, status = 500): Record<string, unknown> {
  return {
    error: message,
    status,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a batch of Vibe projects with tasks
 * @param projectCount - Number of projects
 * @param tasksPerProject - Tasks per project
 * @returns Object with projects and tasks
 */
export function createMockVibeProjectsWithTasks(projectCount = 3, tasksPerProject = 5): {
  projects: VibeProject[];
  tasksByProject: Record<number, VibeTask[]>;
  totalTasks: number;
} {
  const projects = Array.from({ length: projectCount }, (_, i) =>
    createMockVibeProject({
      id: i + 1,
      name: `Project ${i + 1}`,
      identifier: `PROJ${i + 1}`,
    }),
  );

  const tasksByProject: Record<number, VibeTask[]> = {};
  projects.forEach((project) => {
    tasksByProject[project.id] = Array.from({ length: tasksPerProject }, (_, j) =>
      createMockVibeTask({
        id: project.id * 100 + j + 1,
        project_id: project.id,
        title: `Task ${j + 1} for ${project.name}`,
        status: ['todo', 'inprogress', 'inreview', 'done'][j % 4] ?? 'todo',
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
 * @param overrides - Properties to override
 * @returns Mock task attempt
 */
export function createMockTaskAttempt(overrides: Partial<TaskAttempt> = {}): TaskAttempt {
  return {
    id: overrides.id ?? 'attempt-uuid-1',
    task_id: overrides.task_id ?? 'task-uuid-1',
    executor: overrides.executor ?? 'CLAUDE_CODE',
    base_branch: overrides.base_branch ?? 'main',
    attempt_branch: overrides.attempt_branch ?? 'task/test-attempt',
    status: overrides.status ?? 'in_progress',
    created_at: overrides.created_at ?? new Date().toISOString(),
    completed_at: overrides.completed_at ?? null,
  };
}

/**
 * Create a mock execution process
 * @param overrides - Properties to override
 * @returns Mock execution process
 */
export function createMockExecutionProcess(overrides: Partial<ExecutionProcess> = {}): ExecutionProcess {
  return {
    id: overrides.id ?? 'process-uuid-1',
    task_attempt_id: overrides.task_attempt_id ?? 'attempt-uuid-1',
    executor: overrides.executor ?? 'CLAUDE_CODE',
    status: overrides.status ?? 'running',
    exit_code: overrides.exit_code ?? null,
    started_at: overrides.started_at ?? new Date().toISOString(),
    completed_at: overrides.completed_at ?? null,
    runtime_ms: overrides.runtime_ms ?? null,
  };
}

/**
 * Create a mock API response wrapper
 * @param data - Response data
 * @param success - Success status
 * @param message - Optional message
 * @returns Mock API response
 */
export function createMockApiResponse<T>(data: T, success = true, message: string | null = null): {
  success: boolean;
  data: T;
  message?: string;
} {
  return {
    success,
    data,
    ...(message && { message }),
  };
}

interface VibeApiMockOptions {
  projects?: VibeProject[];
  project?: Partial<VibeProject>;
  tasks?: VibeTask[];
}

/**
 * Create mock Vibe API responses for nock
 * @param baseUrl - Base URL for mocking
 * @param options - Mock configuration
 * @returns Mock configuration for nock
 */
export function createVibeApiMocks(baseUrl: string, options: VibeApiMockOptions = {}): {
  listProjects: { url: string; method: string; response: VibeProject[] };
  getProject: (projectId: number) => { url: string; method: string; response: VibeProject };
  listTasks: (projectId: number) => { url: string; method: string; response: VibeTask[] };
  createTask: (taskData: Partial<VibeTask>) => { url: string; method: string; response: VibeTask };
  updateTask: (taskId: number, updates: Partial<VibeTask>) => { url: string; method: string; response: VibeTask };
  deleteTask: (taskId: number) => { url: string; method: string; response: Record<string, unknown> };
} {
  return {
    listProjects: {
      url: `${baseUrl}/projects`,
      method: 'GET',
      response: createMockListProjectsResponse(options.projects ?? []),
    },
    getProject: (projectId: number) => ({
      url: `${baseUrl}/projects/${projectId}`,
      method: 'GET',
      response: createMockVibeProject({ id: projectId, ...options.project }),
    }),
    listTasks: (projectId: number) => ({
      url: `${baseUrl}/tasks?project_id=${projectId}`,
      method: 'GET',
      response: createMockListTasksResponse(options.tasks ?? [], projectId),
    }),
    createTask: (taskData: Partial<VibeTask>) => ({
      url: `${baseUrl}/tasks`,
      method: 'POST',
      response: createMockCreateTaskResponse(taskData),
    }),
    updateTask: (taskId: number, updates: Partial<VibeTask>) => ({
      url: `${baseUrl}/tasks/${taskId}`,
      method: 'PUT',
      response: createMockUpdateTaskResponse(taskId, updates),
    }),
    deleteTask: (taskId: number) => ({
      url: `${baseUrl}/tasks/${taskId}`,
      method: 'DELETE',
      response: createMockDeleteResponse(taskId),
    }),
  };
}
