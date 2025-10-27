# Vibe Kanban HTTP API Reference

Base URL: `http://192.168.50.90:3106/api`

All responses follow this format:
```json
{
  "success": true|false,
  "data": <response_data>,
  "message": "optional error message"
}
```

## Projects API

### List All Projects
```
GET /api/projects
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Project Name",
      "git_repo_path": "/path/to/repo",
      "setup_script": "optional setup script",
      "dev_script": "optional dev script",
      "cleanup_script": "optional cleanup script",
      "copy_files": "optional file copy config",
      "created_at": "2025-01-26T...",
      "updated_at": "2025-01-26T..."
    }
  ]
}
```

### Get Single Project
```
GET /api/projects/{project_id}
```

### Create Project
```
POST /api/projects
```

**Request Body:**
```json
{
  "name": "Project Name",
  "git_repo_path": "/path/to/repo",
  "use_existing_repo": false,
  "setup_script": "optional",
  "dev_script": "optional",
  "cleanup_script": "optional",
  "copy_files": "optional"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Project Name",
    ...
  }
}
```

**Notes:**
- If `use_existing_repo` is `true`, the path must exist and be a valid git repository
- If `use_existing_repo` is `false`, Vibe will create the directory and initialize git
- The backend runs as `mcp-user`, so ensure proper permissions on the repo path

### Update Project
```
PUT /api/projects/{project_id}
```

**Request Body:** (all fields optional)
```json
{
  "name": "Updated Name",
  "git_repo_path": "/new/path",
  "setup_script": "new script or null to clear",
  "dev_script": "new script or null to clear",
  "cleanup_script": "new script or null to clear",
  "copy_files": "new config or null to clear"
}
```

### Delete Project
```
DELETE /api/projects/{project_id}
```

**Response:**
```json
{
  "success": true,
  "data": null
}
```

### Get Project Branches
```
GET /api/projects/{project_id}/branches
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "main",
      "is_head": true
    },
    {
      "name": "feature-branch",
      "is_head": false
    }
  ]
}
```

### Search Project Files
```
GET /api/projects/{project_id}/search?q=search_term&mode=task_form|settings
```

**Query Parameters:**
- `q` (required): Search query
- `mode` (optional): `task_form` (respects .gitignore) or `settings` (includes ignored files)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "path": "relative/path/to/file.js",
      "is_file": true,
      "match_type": "FileName|DirectoryName|FullPath"
    }
  ]
}
```

**Notes:**
- Results are ranked using git history (commit frequency, recency)
- Limited to top 10 results

### Open Project in Editor
```
POST /api/projects/{project_id}/open-editor
```

**Request Body:** (optional)
```json
{
  "editor_type": "vscode|cursor|other"
}
```

## Tasks API

### List Tasks for Project
```
GET /api/tasks?project_id={project_id}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "title": "Task Title",
      "description": "optional description",
      "status": "todo|inprogress|inreview|done|cancelled",
      "parent_task_attempt": "optional uuid",
      "created_at": "2025-01-26T...",
      "updated_at": "2025-01-26T...",
      "has_in_progress_attempt": false,
      "has_merged_attempt": false,
      "last_attempt_failed": false,
      "executor": "executor_name"
    }
  ]
}
```

### Get Single Task
```
GET /api/tasks/{task_id}
```

### Create Task
```
POST /api/tasks
```

**Request Body:**
```json
{
  "project_id": "uuid",
  "title": "Task Title",
  "description": "optional description",
  "parent_task_attempt": "optional uuid",
  "image_ids": ["optional", "array", "of", "uuids"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "project_id": "uuid",
    "title": "Task Title",
    "description": "description",
    "status": "todo",
    "parent_task_attempt": null,
    "created_at": "2025-01-26T...",
    "updated_at": "2025-01-26T..."
  }
}
```

### Update Task
```
PUT /api/tasks/{task_id}
```

**Request Body:** (all fields optional)
```json
{
  "title": "Updated Title",
  "description": "Updated description (empty string to clear)",
  "status": "todo|inprogress|inreview|done|cancelled",
  "parent_task_attempt": "uuid",
  "image_ids": ["array", "of", "uuids"]
}
```

**Notes:**
- If a field is omitted, the existing value is preserved
- To clear description, send an empty string `""`
- `image_ids` replaces all existing images if provided

### Delete Task
```
DELETE /api/tasks/{task_id}
```

**Response:**
- Returns `202 Accepted` if deletion is scheduled
- Deletion fails if task has running execution processes
- Background cleanup of git worktrees is performed asynchronously

### Create and Start Task
```
POST /api/tasks/create-and-start
```

**Request Body:**
```json
{
  "task": {
    "project_id": "uuid",
    "title": "Task Title",
    "description": "optional description"
  },
  "executor_profile_id": {
    "executor": "claude_code|codex|gemini|cursor|opencode",
    "variant": "optional_variant"
  },
  "base_branch": "main"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "task": { ... },
    "has_in_progress_attempt": true,
    "has_merged_attempt": false,
    "last_attempt_failed": false,
    "executor": "claude_code"
  }
}
```

**Notes:**
- Creates a task and immediately starts an execution attempt
- Git branch is automatically created from task title
- Execution process starts in the background

### Stream Tasks (WebSocket)
```
GET /api/tasks/stream/ws?project_id={project_id}
```

**Protocol:** WebSocket
**Purpose:** Real-time updates for task changes in a project

## Tags API

### List All Tags
```
GET /api/tags?search=optional_search_term
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "tag_name": "bug",
      "created_at": "2025-01-26T...",
      "updated_at": "2025-01-26T..."
    }
  ]
}
```

### Get Single Tag
```
GET /api/tags/{tag_id}
```

### Create Tag
```
POST /api/tags
```

**Request Body:**
```json
{
  "tag_name": "feature"
}
```

### Update Tag
```
PUT /api/tags/{tag_id}
```

**Request Body:**
```json
{
  "tag_name": "updated-name"
}
```

### Delete Tag
```
DELETE /api/tags/{tag_id}
```

## Task Status Values

All task status fields accept these values:

- `todo` - Task not started
- `inprogress` - Task is being worked on
- `inreview` - Task is under review
- `done` - Task completed
- `cancelled` - Task cancelled

## Common Patterns

### Case-Insensitive Project Matching
When syncing from external systems like Huly, use case-insensitive matching:

```javascript
// Fetch all projects
const response = await fetch(`${API_BASE}/projects`);
const projects = await response.json();

// Create case-insensitive lookup map
const projectsByName = new Map(
  projects.data.map(p => [p.name.toLowerCase(), p])
);

// Check if project exists
const project = projectsByName.get(externalProject.name.toLowerCase());
```

### Creating Projects with Proper Paths
```javascript
async function createVibeProject(name, existingPath = null) {
  const gitRepoPath = existingPath || `/home/mcp-user/workspace/projects/${name}`;

  const response = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name,
      git_repo_path: gitRepoPath,
      use_existing_repo: existingPath ? fs.existsSync(existingPath) : false
    })
  });

  return await response.json();
}
```

### Syncing Tasks from External System
```javascript
async function syncTask(hulyTask, vibeProject) {
  // Check if task exists
  const tasksResponse = await fetch(
    `${API_BASE}/tasks?project_id=${vibeProject.id}`
  );
  const existingTasks = await tasksResponse.json();

  const existingTask = existingTasks.data.find(
    t => t.title === hulyTask.title
  );

  if (existingTask) {
    // Update existing task
    await fetch(`${API_BASE}/tasks/${existingTask.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: hulyTask.description,
        status: mapStatus(hulyTask.status)
      })
    });
  } else {
    // Create new task
    await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: vibeProject.id,
        title: hulyTask.title,
        description: hulyTask.description,
        status: 'todo'
      })
    });
  }
}
```

## Error Handling

All endpoints return errors in this format:

```json
{
  "success": false,
  "message": "Error description"
}
```

Common HTTP status codes:
- `200 OK` - Success
- `202 Accepted` - Request accepted, processing asynchronously
- `400 Bad Request` - Invalid request data
- `404 Not Found` - Resource not found
- `409 Conflict` - Constraint violation (e.g., duplicate git_repo_path)
- `500 Internal Server Error` - Server error

## Additional Endpoints

While not fully documented here, the Vibe Kanban API also includes:

- `/api/task-attempts/*` - Manage task execution attempts
- `/api/execution-processes/*` - Monitor execution processes
- `/api/events/*` - Server-sent events for real-time updates
- `/api/drafts/*` - Manage task drafts
- `/api/approvals/*` - Approval workflows
- `/api/config/*` - Configuration management
- `/api/health` - Health check endpoint
- `/api/images/*` - Image management
- `/api/filesystem/*` - Filesystem operations
- `/api/containers/*` - Container management
- `/api/auth/*` - Authentication

## MCP Server Alternative

Vibe Kanban also provides an MCP (Model Context Protocol) server for AI agent integration:

**MCP URL:** `http://192.168.50.90:9717/mcp`

**Available MCP Tools:**
- `list_projects` - List all projects
- `list_tasks` - List tasks for a project
- `get_task` - Get single task details
- `create_task` - Create new task
- `update_task` - Update task
- `delete_task` - Delete task
- `start_task_attempt` - Start AI execution attempt

**Note:** The MCP server does NOT support project creation - use the HTTP API for that.
