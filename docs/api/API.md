# Huly REST API Documentation

## Overview

The Huly REST API provides high-performance HTTP endpoints for interacting with the Huly platform, bypassing the MCP protocol for better performance in bulk operations and batch issue fetching.

**Base URL:** `http://192.168.50.90:3458`

**Version:** 1.0.0

**Authentication:** Currently using workspace-level authentication (configured via environment variables)

---

## Table of Contents

- [Getting Started](#getting-started)
- [Health Check](#health-check)
- [Projects](#projects)
- [Issues](#issues)
- [Status Mapping](#status-mapping)
- [Priority Mapping](#priority-mapping)
- [Error Handling](#error-handling)
- [Examples](#examples)

---

## Getting Started

### Configuration

The API requires the following environment variables:

```bash
PORT=3458                                    # API server port
HULY_URL=https://pm.oculair.ca              # Huly platform URL
HULY_EMAIL=your-email@example.com           # Authentication email
HULY_PASSWORD=your-password                 # Authentication password
HULY_WORKSPACE=your-workspace               # Target workspace name
```

### Running the API

```bash
# Using Docker Compose (recommended)
docker-compose up -d huly-rest-api

# Using Node.js directly
cd huly-rest-api
npm install
node server.js
```

---

## Health Check

### GET /health

Check if the API server is running and connected to Huly.

**Response:**
```json
{
  "status": "ok",
  "connected": true,
  "timestamp": "2025-10-27T22:47:10.123Z"
}
```

**Example:**
```bash
curl http://192.168.50.90:3458/health
```

---

## Projects

### GET /api/projects

List all projects in the workspace.

**Query Parameters:** None

**Response:**
```json
{
  "projects": [
    {
      "identifier": "HULLY",
      "name": "Huly MCP Server",
      "description": "Model Context Protocol server for Huly integration",
      "issueCount": 27,
      "private": false,
      "archived": false
    },
    {
      "identifier": "LMS",
      "name": "Letta MCP Server",
      "description": "MCP tools for Letta agent management",
      "issueCount": 46,
      "private": false,
      "archived": false
    }
  ],
  "count": 2
}
```

**Example:**
```bash
curl http://192.168.50.90:3458/api/projects
```

---

## Issues

### GET /api/projects/:identifier/issues

List all issues in a specific project with optional timestamp filtering for incremental sync.

**Path Parameters:**
- `identifier` (string, required) - Project identifier (e.g., "HULLY", "LMS")

**Query Parameters:**
- `modifiedAfter` (string, optional) - ISO 8601 timestamp to fetch only issues modified after this time
- `limit` (number, optional) - Maximum number of issues to return (default: 1000)

**Response:**
```json
{
  "project": "HULLY",
  "issues": [
    {
      "identifier": "HULLY-27",
      "title": "Add bidirectional sync support",
      "description": "Implement status sync from Vibe Kanban back to Huly",
      "status": "In Progress",
      "priority": "High",
      "component": "Sync Engine",
      "milestone": "v1.0",
      "assignee": "user@example.com",
      "createdOn": 1698765432000,
      "modifiedOn": 1698852432000,
      "number": 27,
      "project": "HULLY"
    }
  ],
  "count": 1,
  "filtered": true
}
```

**Examples:**

```bash
# Get all issues in a project
curl http://192.168.50.90:3458/api/projects/HULLY/issues

# Get only issues modified after a specific timestamp (incremental sync)
curl "http://192.168.50.90:3458/api/projects/HULLY/issues?modifiedAfter=2025-10-27T18:00:00.000Z"

# Limit the number of results
curl "http://192.168.50.90:3458/api/projects/HULLY/issues?limit=50"
```

---

### GET /api/issues/:identifier

Get detailed information about a single issue.

**Path Parameters:**
- `identifier` (string, required) - Issue identifier (e.g., "HULLY-27")

**Response:**
```json
{
  "identifier": "HULLY-27",
  "title": "Add bidirectional sync support",
  "description": "Implement status sync from Vibe Kanban back to Huly",
  "status": "In Progress",
  "priority": "High",
  "component": "Sync Engine",
  "milestone": "v1.0",
  "assignee": "user@example.com",
  "createdOn": 1698765432000,
  "modifiedOn": 1698852432000,
  "number": 27,
  "project": "HULLY"
}
```

**Example:**
```bash
curl http://192.168.50.90:3458/api/issues/HULLY-27
```

---

### POST /api/issues

Create a new issue in a project.

**Request Body:**
```json
{
  "project_identifier": "HULLY",
  "title": "Fix authentication bug",
  "description": "Users are unable to log in with SSO credentials",
  "priority": "High",
  "component": "Auth",
  "milestone": "v1.1"
}
```

**Required Fields:**
- `project_identifier` (string) - Project identifier
- `title` (string) - Issue title

**Optional Fields:**
- `description` (string) - Issue description (supports Markdown)
- `priority` (string) - Priority level (see [Priority Mapping](#priority-mapping))
- `component` (string) - Component label
- `milestone` (string) - Milestone label

**Response:**
```json
{
  "identifier": "HULLY-28",
  "title": "Fix authentication bug",
  "project": "HULLY",
  "status": "Backlog",
  "priority": "High"
}
```

**Example:**
```bash
curl -X POST http://192.168.50.90:3458/api/issues \
  -H "Content-Type: application/json" \
  -d '{
    "project_identifier": "HULLY",
    "title": "Fix authentication bug",
    "description": "Users are unable to log in with SSO credentials",
    "priority": "High"
  }'
```

---

### PUT /api/issues/:identifier

Update a specific field of an issue.

**Path Parameters:**
- `identifier` (string, required) - Issue identifier (e.g., "HULLY-27")

**Request Body:**
```json
{
  "field": "status",
  "value": "In Progress"
}
```

**Supported Fields:**
- `title` (string) - Update issue title
- `description` (string) - Update issue description (supports Markdown)
- `status` (string) - Update issue status (see [Status Mapping](#status-mapping))
- `priority` (string) - Update priority level (see [Priority Mapping](#priority-mapping))

**Response:**
```json
{
  "identifier": "HULLY-27",
  "field": "status",
  "value": "In Progress",
  "updated": true
}
```

**Examples:**

```bash
# Update issue status
curl -X PUT http://192.168.50.90:3458/api/issues/HULLY-27 \
  -H "Content-Type: application/json" \
  -d '{
    "field": "status",
    "value": "In Progress"
  }'

# Update issue title
curl -X PUT http://192.168.50.90:3458/api/issues/HULLY-27 \
  -H "Content-Type: application/json" \
  -d '{
    "field": "title",
    "value": "Updated title for the issue"
  }'

# Update issue priority
curl -X PUT http://192.168.50.90:3458/api/issues/HULLY-27 \
  -H "Content-Type: application/json" \
  -d '{
    "field": "priority",
    "value": "Urgent"
  }'
```

---

## Status Mapping

The API supports the following status values for issues:

| Status Name | Description | Common Transitions |
|-------------|-------------|-------------------|
| `Backlog` | Not yet started, in backlog | → To Do, In Progress |
| `To Do` | Planned for current iteration | → In Progress |
| `In Progress` | Currently being worked on | → In Review, Done |
| `In Review` | Under review/testing | → Done, In Progress |
| `Done` | Completed | Final state |
| `Canceled` | Canceled/won't do | Final state |

**Note:** Available statuses may vary by project. If an invalid status is provided, the API will return an error with a list of available statuses for that project.

---

## Priority Mapping

The API supports the following priority values:

| Priority | Numeric Value | Description |
|----------|--------------|-------------|
| `NoPriority` | 0 | No priority set (default) |
| `Urgent` | 1 | Highest priority, needs immediate attention |
| `High` | 2 | Important, should be addressed soon |
| `Medium` | 3 | Normal priority |
| `Low` | 4 | Can be deferred |

**Example:** When creating or updating an issue, use the string value (e.g., `"High"`, `"Urgent"`).

---

## Error Handling

The API uses standard HTTP status codes and returns error messages in JSON format.

### Common Error Responses

**400 Bad Request:**
```json
{
  "error": "project_identifier and title are required"
}
```

**404 Not Found:**
```json
{
  "error": "Project INVALID not found"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Failed to connect to Huly platform"
}
```

**503 Service Unavailable:**
```json
{
  "error": "Huly client not initialized"
}
```

### Status-Specific Errors

When updating an issue with an invalid status:
```json
{
  "error": "Status 'Invalid Status' not found",
  "availableStatuses": ["Backlog", "To Do", "In Progress", "In Review", "Done", "Canceled"]
}
```

---

## Examples

### Complete Workflow Example

```bash
# 1. Check API health
curl http://192.168.50.90:3458/health

# 2. List all projects
curl http://192.168.50.90:3458/api/projects

# 3. Get all issues in a project
curl http://192.168.50.90:3458/api/projects/HULLY/issues

# 4. Create a new issue
curl -X POST http://192.168.50.90:3458/api/issues \
  -H "Content-Type: application/json" \
  -d '{
    "project_identifier": "HULLY",
    "title": "Implement new feature",
    "description": "Add support for bulk operations",
    "priority": "High"
  }'

# 5. Update issue status to "In Progress"
curl -X PUT http://192.168.50.90:3458/api/issues/HULLY-28 \
  -H "Content-Type: application/json" \
  -d '{
    "field": "status",
    "value": "In Progress"
  }'

# 6. Get issue details
curl http://192.168.50.90:3458/api/issues/HULLY-28

# 7. Mark issue as done
curl -X PUT http://192.168.50.90:3458/api/issues/HULLY-28 \
  -H "Content-Type: application/json" \
  -d '{
    "field": "status",
    "value": "Done"
  }'
```

### Incremental Sync Example

For syncing systems that need to fetch only recently modified issues:

```bash
# 1. First sync - get all issues
curl "http://192.168.50.90:3458/api/projects/HULLY/issues" > initial_sync.json

# Store the timestamp of this sync
LAST_SYNC=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# 2. Wait for changes...

# 3. Incremental sync - get only issues modified since last sync
curl "http://192.168.50.90:3458/api/projects/HULLY/issues?modifiedAfter=${LAST_SYNC}" > incremental_sync.json
```

### Batch Status Update Example

Update multiple issues programmatically:

```bash
# Update issue statuses in a loop
for issue_id in HULLY-1 HULLY-2 HULLY-3; do
  curl -X PUT "http://192.168.50.90:3458/api/issues/${issue_id}" \
    -H "Content-Type: application/json" \
    -d '{"field": "status", "value": "In Review"}'
  echo ""
done
```

---

## Performance Considerations

### Batch Operations

The REST API is optimized for batch operations:

- **Full Project Fetch**: ~500-900ms for 50-100 issues with full details
- **Incremental Fetch**: ~100-300ms for 0-10 modified issues
- **Single Issue Update**: ~50-100ms per update

### Rate Limiting

Currently, there is no rate limiting implemented. Best practices:

- Batch related operations together when possible
- Use incremental sync (`modifiedAfter`) for regular polling
- Add small delays (50-100ms) between bulk updates

### Caching

The API fetches fresh data from Huly on each request. For high-frequency reads, consider implementing client-side caching based on the `modifiedOn` timestamp.

---

## Integration Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');

const HULY_API = 'http://192.168.50.90:3458';

async function listProjects() {
  const response = await axios.get(`${HULY_API}/api/projects`);
  return response.data.projects;
}

async function getIssues(projectId, modifiedAfter = null) {
  const params = modifiedAfter ? { modifiedAfter } : {};
  const response = await axios.get(
    `${HULY_API}/api/projects/${projectId}/issues`,
    { params }
  );
  return response.data.issues;
}

async function updateIssueStatus(issueId, status) {
  const response = await axios.put(
    `${HULY_API}/api/issues/${issueId}`,
    { field: 'status', value: status }
  );
  return response.data;
}

// Usage
(async () => {
  const projects = await listProjects();
  console.log('Projects:', projects);

  const issues = await getIssues('HULLY');
  console.log(`Found ${issues.length} issues`);

  await updateIssueStatus('HULLY-27', 'In Progress');
  console.log('Status updated');
})();
```

### Python

```python
import requests
from datetime import datetime

HULY_API = 'http://192.168.50.90:3458'

def list_projects():
    response = requests.get(f'{HULY_API}/api/projects')
    return response.json()['projects']

def get_issues(project_id, modified_after=None):
    params = {'modifiedAfter': modified_after} if modified_after else {}
    response = requests.get(
        f'{HULY_API}/api/projects/{project_id}/issues',
        params=params
    )
    return response.json()['issues']

def update_issue_status(issue_id, status):
    response = requests.put(
        f'{HULY_API}/api/issues/{issue_id}',
        json={'field': 'status', 'value': status}
    )
    return response.json()

# Usage
projects = list_projects()
print(f'Projects: {projects}')

issues = get_issues('HULLY')
print(f'Found {len(issues)} issues')

update_issue_status('HULLY-27', 'In Progress')
print('Status updated')
```

---

## Troubleshooting

### Common Issues

**Problem:** API returns `503 Service Unavailable`
```
Solution: The API client may not be connected to Huly. Check:
- HULY_URL is correct
- HULY_EMAIL and HULY_PASSWORD are valid
- HULY_WORKSPACE exists
- Huly platform is accessible
```

**Problem:** Issues have empty descriptions
```
Solution: Descriptions are fetched from Huly's blob storage. Ensure:
- Network connectivity to Huly platform
- Sufficient permissions to read issue content
```

**Problem:** Status update fails with "Status not found"
```
Solution: Each project may have different available statuses.
Use the error message's `availableStatuses` field to see valid options.
```

### Debug Mode

Enable debug logging by checking the container logs:

```bash
docker-compose logs -f huly-rest-api
```

Look for messages like:
- `[Huly REST] Successfully connected to Huly platform` - Connection OK
- `[Huly REST] Fetching issues for project XXX` - API requests
- `[Huly REST] Error fetching issues:` - Errors with details

---

## Support and Feedback

For issues, questions, or feature requests related to the Huly REST API, please contact the development team or file an issue in the project repository.

**Last Updated:** 2025-10-27
