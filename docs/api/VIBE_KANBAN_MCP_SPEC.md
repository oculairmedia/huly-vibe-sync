# Comprehensive Vibe Kanban MCP Server Specification

## Executive Summary

This document specifies a comprehensive MCP server for Vibe Kanban that exposes all critical functionality needed for effective AI-powered task management and workflow automation.

**Current Tools (7)**: list_projects, list_tasks, create_task, start_task_attempt, get_task, update_task, delete_task

**Proposed Tools (35+)**: Complete coverage of projects, tasks, attempts, execution processes, executor profiles, approvals, tags, and system management.

---

## Tool Categories

### 1. Project Management (9 tools)

#### ✅ Currently Available
- `list_projects` - List all projects

#### ❌ Missing (HIGH Priority)
- `get_project` - Get detailed project information including settings, branches, executor profiles
- `create_project` - Create new project with git repo path, name, description
- `update_project` - Update project settings (name, description, git repo, base branch)
- `delete_project` - Delete a project
- `get_project_branches` - List available git branches for a project
- `search_project_files` - Search for files within a project's repository
- `open_project_in_editor` - Open project in configured IDE
- `get_project_executor_profiles` - List executor profiles configured for a project

**Rationale**: Projects are the foundation - agents need to discover project settings, configure environments, and manage project metadata.

---

### 2. Task Management (11 tools)

#### ✅ Currently Available
- `list_tasks` - List tasks with optional filtering
- `get_task` - Get task details
- `create_task` - Create new task
- `update_task` - Update task (title, description, status)
- `delete_task` - Delete a task

#### ❌ Missing (HIGH Priority)
- `create_task_and_start` - Create task and immediately start attempt (atomic operation)
- `get_task_images` - Get images/screenshots attached to a task
- `upload_task_image` - Upload image to a task
- `search_tasks` - Search tasks by text query
- `bulk_update_tasks` - Update multiple tasks at once
- `get_task_history` - Get task status/update history

**Rationale**: Task discovery and bulk operations are critical for efficient agent workflows. Image support enables visual context.

---

### 3. Task Attempt Management (16 tools) 🔥 **CRITICAL**

#### ✅ Currently Available
- `start_task_attempt` - Create and start a new attempt

#### ❌ Missing (VERY HIGH Priority)
- `list_task_attempts` - List all attempts for a task (see what was tried, what failed)
- `get_task_attempt` - Get detailed attempt information
- `get_attempt_artifacts` - Access work products (diffs, commits, logs)
- `merge_task_attempt` - Merge completed work into target branch **[TESTED - WORKS]**
- `create_followup_attempt` - Create follow-up attempt addressing feedback
- `rebase_task_attempt` - Rebase attempt branch on latest target branch
- `abort_conflicts` - Abort rebase/merge conflicts
- `get_commit_info` - Get commit details for an attempt
- `compare_commit_to_head` - Compare attempt commits to target branch
- `push_attempt_branch` - Push attempt branch to remote
- `create_github_pr` - Create GitHub pull request for attempt
- `change_target_branch` - Change the base/target branch for merge
- `get_branch_status` - Get branch sync status (ahead/behind counts)
- `delete_attempt_file` - Delete a file in the attempt worktree
- `open_attempt_in_editor` - Open attempt in IDE
- `replace_execution_process` - Replace/restart the execution process

**Rationale** (from Meridian): *"This is crucial for: debugging failures, resuming work, iterative refinement, code review workflows, understanding what was already tried."*

---

### 4. Execution Process Management (7 tools)

#### ❌ Missing (HIGH Priority)
- `list_execution_processes` - List all running/recent execution processes
- `get_execution_process` - Get process details (status, exit code, runtime)
- `stop_execution_process` - Stop a running execution process
- `get_process_raw_logs` - Get raw stdout/stderr logs
- `get_process_normalized_logs` - Get structured, parsed logs
- `start_dev_server` - Start development server for an attempt
- `stream_process_logs` - Stream logs in real-time (WebSocket)

**Rationale**: Agents need to monitor execution, debug failures, and manage long-running processes.

---

### 5. Executor Profile Management (5 tools) 🔥 **CRITICAL**

#### ❌ Missing (VERY HIGH Priority)
- `list_executor_profiles` - List available executor profiles (claude-code, opencode, etc.)
- `get_executor_profile` - Get profile configuration details
- `create_executor_profile` - Create custom executor profile with prompts/settings
- `update_executor_profile` - Update profile configuration
- `delete_executor_profile` - Delete an executor profile

**Rationale**: Without this, agents can't discover which executors are available or configure custom coding agents. **This was a blocker in our testing.**

---

### 6. Approval Workflow (4 tools)

#### ❌ Missing (MEDIUM Priority)
- `create_approval` - Create approval request for a task attempt
- `get_approval_status` - Check if approval is pending/approved/rejected
- `respond_to_approval` - Approve or reject an approval request
- `get_pending_approvals` - List all pending approval requests

**Rationale**: Enables human-in-the-loop workflows where agents request approval before merging or proceeding.

---

### 7. Tags & Labels (5 tools)

#### ❌ Missing (LOW Priority)
- `list_tags` - List all tags
- `get_tag` - Get tag details
- `create_tag` - Create new tag
- `update_tag` - Update tag metadata
- `delete_tag` - Delete a tag

**Rationale**: Tags enable categorization and filtering. Lower priority than core functionality.

---

### 8. System & Configuration (8 tools)

#### ❌ Missing (MEDIUM Priority)
- `get_system_info` - Get system information (OS, architecture, directories)
- `get_config` - Get current Vibe Kanban configuration
- `update_config` - Update configuration settings
- `list_mcp_servers` - List configured MCP servers
- `update_mcp_servers` - Update MCP server configuration
- `list_git_repos` - List git repositories on system
- `list_directory` - List files in a directory
- `health_check` - Check if Vibe Kanban is healthy

**Rationale**: Enables self-management and discovery of available resources.

---

### 9. Authentication (3 tools)

#### ❌ Missing (LOW Priority)
- `github_auth_start` - Start GitHub device flow authentication
- `github_auth_poll` - Poll for GitHub authentication completion
- `github_check_token` - Check if GitHub token is valid

**Rationale**: Needed for GitHub integration but not critical for core workflows.

---

## Priority Implementation Plan

### Phase 1: Critical Gaps (Week 1)
**Goal**: Enable complete task execution lifecycle

1. ✅ **Executor Profile Management** (5 tools)
   - Without this, agents can't discover or use executors properly
   - Blocked our testing session

2. ✅ **Task Attempt Management** (16 tools)
   - Core of the execution workflow
   - Merge, rebase, PR creation, artifacts

3. ✅ **Execution Process Management** (7 tools)
   - Monitor and debug running processes
   - Get logs and status

**Estimated**: ~40-60 hours of development

### Phase 2: Project & Task Enhancements (Week 2)
**Goal**: Better discovery and management

4. **Project Management** (8 missing tools)
5. **Task Management** (6 missing tools)
6. **System Configuration** (8 tools)

**Estimated**: ~30-40 hours

### Phase 3: Workflow Features (Week 3)
**Goal**: Advanced workflows

7. **Approval Workflow** (4 tools)
8. **Tags & Labels** (5 tools)
9. **Authentication** (3 tools)

**Estimated**: ~20-30 hours

---

## Implementation Notes

### Technology Stack
- **Language**: Rust (matches existing Vibe Kanban codebase)
- **Framework**: `rmcp` (existing MCP framework used by Vibe Kanban)
- **Transport**: HTTP with Supergateway (existing setup)
- **Location**: Extend existing `/opt/stacks/vibe-kanban/crates/server/src/mcp/task_server.rs`

### Code Structure
```rust
// Existing pattern from task_server.rs
#[tool(description = "Tool description here")]
async fn tool_name(
    &self,
    Parameters(RequestStruct {
        field1,
        field2,
    }): Parameters<RequestStruct>,
) -> Result<CallToolResult, ErrorData> {
    // Implementation
    let url = self.url("/api/endpoint");
    let result: ResponseType = self.send_json(
        self.client.post(&url).json(&payload)
    ).await?;
    
    TaskServer::success(&result)
}
```

### API Endpoints Reference
All endpoints are documented in:
- `/opt/stacks/vibe-kanban/crates/server/src/routes/*.rs`
- Backend API runs on `http://localhost:3105`

---

## Testing Checklist

### Integration Tests
- [ ] All 35+ tools can be called successfully
- [ ] Tools return properly formatted JSON responses
- [ ] Error handling works (404, 500, etc.)
- [ ] Parameters are validated

### Workflow Tests
- [ ] Complete task lifecycle: create → start → work → merge → done
- [ ] Follow-up attempts after review feedback
- [ ] Rebase and conflict resolution
- [ ] Executor profile discovery and selection
- [ ] Process monitoring and log retrieval

### Performance Tests
- [ ] Bulk operations don't timeout
- [ ] Streaming logs work correctly
- [ ] Concurrent tool calls don't cause issues

---

## Success Metrics

1. **Coverage**: 100% of critical API endpoints exposed as MCP tools
2. **Completeness**: Agents can perform entire task lifecycle without UI
3. **Discoverability**: Agents can discover available executors, projects, branches
4. **Reliability**: Error handling and validation prevent bad states
5. **Performance**: Bulk operations complete in <5s

---

## Meridian's Key Insights

From conversation:
> **"Think about the agent workflow to prioritize what's needed"**

> **Core execution cycle (you have this):**
> - ✅ list_tasks - See what work is available
> - ✅ get_task - Get task details  
> - ✅ start_task_attempt - Begin work
> - ✅ update_task - Report progress/completion

> **Critical gaps for real workflows:**
> - ❌ get_task_attempts - See attempt history (what was tried, what failed)
> - ❌ get_attempt_artifacts - Access work products from attempts
> - **This is crucial for:** debugging failures, resuming work, iterative refinement, code review workflows

---

## Next Steps

1. ✅ Review and approve this specification
2. Create GitHub issue/task for MCP server expansion
3. Implement Phase 1 tools (Executor Profiles + Attempts + Processes)
4. Test with real agent workflows
5. Iterate based on usage patterns
6. Implement Phase 2 & 3

---

**Document Version**: 1.0
**Created**: 2025-10-28
**Last Updated**: 2025-10-28
**Author**: OpenCode AI
**Reviewer**: Meridian (Letta Agent)
