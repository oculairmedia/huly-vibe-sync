# PM Agent Tool Provisioning Strategy
## Recommended MCP Tools for Huly PM Agents

**Created**: 2025-11-01  
**Purpose**: Define optimal tool mix for Letta PM agents managing Huly projects  
**Status**: Recommendation - Ready for Implementation

---

## Executive Summary

Huly PM agents currently have **only core Letta tools** (send_message, memory_replace, memory_insert). They need MCP tools to:
1. Read/write Huly issues and projects
2. Manage Vibe Kanban tasks and executions
3. Research technical topics online
4. Access code documentation

---

## Available MCP Servers

### ✅ Already Registered in Letta

1. **huly** - `http://192.168.50.90:3457/mcp`
2. **vibekanban** - `http://192.168.50.90:9717/mcp`
3. **vibekanban_system** - `http://192.168.50.90:9718/mcp`
4. **Searxng** - Web search capabilities
5. **context7** - Library documentation lookup
6. **filesystem** - File operations
7. **claude-code-mcp** - Code execution
8. **graphiti** - Knowledge graph
9. Plus 11 more servers (bookstack, ghost, matrix, etc.)

---

## Recommended Tool Mix for PM Agents

### Tier 1: Essential (Must Have)

These tools enable core PM functionality:

#### From **huly** MCP (3 tools)
1. **huly_query** - Read projects, issues, comments
   - List all projects
   - Search issues by status/priority/assignee
   - Get detailed issue information
   
2. **huly_issue_ops** - Create/update issues
   - Create new issues
   - Update issue status, priority, description
   - Create sub-issues
   - Bulk operations
   
3. **huly_entity** - Manage project metadata
   - Create/update components and milestones
   - Manage project structure
   - Add comments to issues

**Rationale**: PM agents need to read issue status and update them based on Vibe execution results.

---

#### From **vibekanban** MCP (7 tools)
1. **list_projects** - Discover available Vibe projects
   
2. **list_tasks** - See what tasks exist and their status
   - Filter by status (todo, inprogress, done)
   - Check execution status
   
3. **get_task** - Get full task details including description
   
4. **update_task** - Update task metadata
   - Change title/description
   - Update status
   
5. **list_task_attempts** - View execution history
   - See what was tried
   - Check branch names and executors used
   - Understand failure patterns
   
6. **get_task_attempt** - Detailed attempt information
   - Branch status
   - Timestamps
   - Worktree details
   
7. **get_branch_status** - Git sync status
   - Commits ahead/behind
   - Conflict detection
   - PR status

**Rationale**: PM agents need to monitor task execution, understand failures, and coordinate between Huly and Vibe.

---

### Tier 2: High Value (Should Have)

These tools enhance PM capabilities:

#### From **vibekanban** MCP (4 tools)
8. **get_execution_process** - Process details
   - Exit codes
   - Runtime metrics
   - Git commits made
   
9. **get_process_raw_logs** - Debugging support
   - Full stdout/stderr
   - Understand what went wrong
   
10. **get_attempt_commits** - Code review
    - See what code was changed
    - Review commit messages
    - Assess quality
    
11. **merge_task_attempt** - Merge completed work
    - Perform git merge
    - Mark tasks as done

**Rationale**: Enables agents to debug failures and complete successful tasks.

---

#### From **Searxng** MCP (2 tools)
12. **searxng_web_search** - Research technical topics
    - Find solutions to common errors
    - Research best practices
    - Stay updated on technologies
    
13. **web_url_read** - Deep dive into search results
    - Read Stack Overflow answers
    - Parse documentation pages
    - Extract specific information

**Rationale**: PM agents can research errors and suggest solutions based on web knowledge.

---

### Tier 3: Nice to Have (Optional)

#### From **context7** MCP (2 tools)
14. **resolve-library-id** - Find library documentation
    
15. **get-library-docs** - Fetch API docs
    - Get up-to-date package documentation
    - Understand library APIs used in projects

**Rationale**: Helps agents understand the codebase's dependencies.

---

#### From **vibekanban_system** MCP (2 tools)
16. **list_executor_profiles** - See available executors
    - Claude Code, Cursor, Copilot, etc.
    
17. **health_check** - Monitor Vibe system health

**Rationale**: System awareness for better task assignment.

---

## Recommended Provisioning Configuration

### Minimal Set (Essential Only - 10 tools)
Perfect for starting out and testing:

**Huly Tools (3):**
- huly_query
- huly_issue_ops  
- huly_entity

**Vibe Tools (7):**
- list_projects
- list_tasks
- get_task
- update_task
- list_task_attempts
- get_task_attempt
- get_branch_status

**Total**: 10 tools

---

### Recommended Set (Essential + High Value - 17 tools)
Best balance of capability and complexity:

**Huly Tools (3):**
- huly_query
- huly_issue_ops
- huly_entity

**Vibe Tools (11):**
- list_projects
- list_tasks
- get_task
- update_task
- list_task_attempts
- get_task_attempt
- get_branch_status
- get_execution_process
- get_process_raw_logs
- get_attempt_commits
- merge_task_attempt

**Search Tools (2):**
- searxng_web_search
- web_url_read

**Total**: 16 tools

---

### Full Set (All Recommended - 21 tools)
Maximum capability for advanced PM agents:

**All of Recommended Set (16)** plus:

**Context7 Tools (2):**
- resolve-library-id
- get-library-docs

**Vibe System Tools (2):**
- list_executor_profiles
- health_check

**Total**: 20 tools

---

## Tools to AVOID

### ❌ Don't Attach These (Too Risky)

From **vibekanban** MCP:
- ❌ **create_task** - Sync service handles this
- ❌ **delete_task** - Dangerous, sync service manages
- ❌ **start_task_attempt** - Should be manual/controlled
- ❌ **stop_execution_process** - Risky to kill processes
- ❌ **start_dev_server** - Not needed for PM role
- ❌ **abort_conflicts** - Should be manual operation
- ❌ **create_followup_attempt** - Let humans decide

From **vibekanban_system** MCP:
- ❌ **update_config** - System configuration should be protected
- ❌ **update_mcp_servers** - System-level changes

From **huly** MCP:
- ❌ **huly_workflow** - Complex multi-step operations (risky)
- ❌ **huly_template_ops** - Template management (not needed)
- ❌ **huly_account_ops** - User management (security risk)
- ❌ **huly_integration** - GitHub integration (complex)
- ❌ **huly_validate** - Deletion validation (implies deletion)

**Rationale**: These tools can make destructive changes or interfere with the sync service's job.

---

## Implementation Approach

### Option 1: Manual Attachment (One-time Setup)
Use Letta UI to manually attach tools to each agent:

```bash
# For each of the 42 agents:
1. Navigate to https://letta.oculair.ca
2. Select agent from list
3. Go to Tools tab
4. Click "Add Tool"
5. Select from MCP servers:
   - huly → huly_query, huly_issue_ops, huly_entity
   - vibekanban → (7-11 tools depending on tier)
   - Searxng → searxng_web_search, web_url_read (if tier 2+)
6. Save
```

**Pros**: 
- Visual confirmation
- Easy to customize per agent
- No code changes

**Cons**: 
- Time consuming (42 agents × ~5 min = 3.5 hours)
- Manual process prone to errors
- Not repeatable for new agents

---

### Option 2: Programmatic Attachment (Automated)
Add tool attachment logic to `lib/LettaService.js`:

```javascript
async attachPmTools(agentId, tier = 'recommended') {
  const toolSets = {
    minimal: [
      // Huly tools
      { server: 'huly', tools: ['huly_query', 'huly_issue_ops', 'huly_entity'] },
      // Vibe tools
      { server: 'vibekanban', tools: [
        'list_projects', 'list_tasks', 'get_task', 'update_task',
        'list_task_attempts', 'get_task_attempt', 'get_branch_status'
      ]}
    ],
    recommended: [
      // All minimal tools plus:
      { server: 'vibekanban', tools: [
        'get_execution_process', 'get_process_raw_logs',
        'get_attempt_commits', 'merge_task_attempt'
      ]},
      { server: 'Searxng', tools: ['searxng_web_search', 'web_url_read'] }
    ],
    full: [
      // All recommended tools plus:
      { server: 'context7', tools: ['resolve-library-id', 'get-library-docs'] },
      { server: 'vibekanban_system', tools: ['list_executor_profiles', 'health_check'] }
    ]
  };
  
  const toolsToAttach = tier === 'full' 
    ? [...toolSets.minimal, ...toolSets.recommended, ...toolSets.full]
    : tier === 'recommended'
    ? [...toolSets.minimal, ...toolSets.recommended]
    : toolSets.minimal;
  
  // Use Letta API to attach tools
  for (const { server, tools } of toolsToAttach) {
    for (const toolName of tools) {
      await this.attachToolToAgent(agentId, server, toolName);
    }
  }
}
```

**Pros**:
- Automated and repeatable
- Consistent across all agents
- Easy to update/change tiers
- New agents get tools automatically

**Cons**:
- Requires implementation (2-3 hours)
- Need to find correct Letta API endpoint
- Testing required

---

### Option 3: Hybrid (Recommended)
1. Implement programmatic attachment in code
2. Use it to provision all 42 existing agents
3. Use it automatically for new agents
4. Allow manual override in Letta UI if needed

**Steps**:
```bash
1. Implement attachPmTools() method
2. Add env var: PM_AGENT_TOOL_TIER=recommended
3. Call attachPmTools() after ensureAgent() in sync flow
4. Run sync once to provision all agents
5. Verify in Letta UI
```

---

## Testing Strategy

### Phase 1: Single Agent Test
1. Pick one agent (e.g., Huly-VIBEK-PM for Vibe Kanban project)
2. Manually attach **minimal set** (10 tools)
3. Send test message: "What tasks are in progress in Vibe Kanban?"
4. Verify agent can call tools and respond correctly

### Phase 2: Tool Capability Test
1. Test each tool category:
   - **Read Huly**: "What are the open issues in VIBEK?"
   - **Read Vibe**: "Show me tasks that are in progress"
   - **Check Status**: "What's the status of task XYZ?"
   - **Web Research**: "Search for solutions to 'Docker connection refused'"
2. Verify responses are accurate

### Phase 3: Full Provisioning
1. Use programmatic approach to attach tools to all 42 agents
2. Verify via Letta API that tools are attached
3. Test 3-5 agents randomly with queries

---

## Expected Benefits

### For PM Agents
- **Situational awareness**: Can see real-time task and issue status
- **Proactive updates**: Can update Huly issues based on Vibe execution
- **Debugging support**: Can analyze logs and suggest fixes
- **Research capability**: Can look up error messages and solutions
- **Code review**: Can review commits and assess quality

### For Users
- **Better communication**: Agents can answer "What's the status of X?"
- **Automated updates**: Issues stay in sync without manual intervention
- **Intelligent insights**: "Task failed because of dependency conflict" (from logs + web search)
- **Reduced context switching**: Ask agent instead of checking multiple systems

### For System
- **Reduced sync service load**: Agents handle some coordination
- **Better error recovery**: Agents can suggest fixes based on research
- **Knowledge retention**: Graphiti integration could store learned solutions

---

## Resource Impact

### Minimal Set (10 tools)
- **Memory**: +5-10MB per agent × 42 = ~420MB
- **API calls**: +10-20 calls/sync cycle
- **Latency**: +200-500ms per agent interaction

### Recommended Set (16 tools)
- **Memory**: +10-15MB per agent × 42 = ~630MB
- **API calls**: +20-30 calls/sync cycle
- **Latency**: +300-700ms per agent interaction

### Full Set (20 tools)
- **Memory**: +15-20MB per agent × 42 = ~840MB
- **API calls**: +30-50 calls/sync cycle
- **Latency**: +400-1000ms per agent interaction

**Assessment**: Minimal and Recommended sets have acceptable resource impact.

---

## Security Considerations

### ✅ Safe Operations
All recommended tools are **read-only** or make **non-destructive updates**:
- Reading issues/tasks: ✅ Safe
- Updating task status: ✅ Safe (reversible)
- Web search: ✅ Safe (read-only)
- Getting logs: ✅ Safe (read-only)
- Merging tasks: ⚠️ Needs verification that attempt is clean

### ⚠️ Caution Areas
- **merge_task_attempt**: Only in "recommended" tier, agent should verify branch is clean first
- **update_task**: Could change status incorrectly, but sync service will correct
- **web_url_read**: Could fetch malicious content (unlikely with Searxng results)

### ❌ Deliberately Excluded
- Task deletion
- Process termination
- System configuration
- User management
- Template operations

**Verdict**: Recommended set is **safe for production** with standard agent oversight.

---

## Recommended Action Plan

### Week 1: Implementation (6 hours)
1. **Day 1** (2h): Implement `attachPmTools()` in LettaService.js
2. **Day 1** (1h): Add tool attachment to sync flow
3. **Day 2** (1h): Test with single agent (manual + programmatic)
4. **Day 2** (2h): Provision all 42 agents with **recommended set**

### Week 2: Testing & Validation (4 hours)
1. **Day 1** (2h): Test 10 random agents with various queries
2. **Day 2** (1h): Monitor memory/performance impact
3. **Day 2** (1h): Document agent capabilities and examples

### Week 3: Optimization (Optional)
1. Analyze tool usage patterns
2. Adjust tier assignments if needed
3. Create agent query templates
4. Integrate with monitoring

---

## Open Questions

1. **Tool limits**: Does Letta have a max tools per agent limit?
2. **API endpoint**: What's the exact API endpoint for attaching MCP tools to agents?
3. **Permissions**: Do agents need special permissions for MCP tools?
4. **Rate limiting**: Should we limit tool calls per agent?
5. **Tier per project**: Should different projects get different tool tiers?

---

## Decision Required

**Which option should we implement?**

### Option A: Minimal Set (10 tools) ✅ SAFEST
- Start small and proven
- Low risk, low resource usage
- Expand later if needed

### Option B: Recommended Set (16 tools) ✅ RECOMMENDED
- Best balance of capability and safety
- Enables research and debugging
- Still reasonable resource usage

### Option C: Full Set (20 tools) ⚠️ OVERKILL
- Maximum capability
- Higher resource usage
- Context7 + system tools rarely needed

**Recommendation**: **Option B - Recommended Set (16 tools)**

---

## Next Steps

Please confirm:
1. ✅ Use **Recommended Set** (16 tools)?
2. ✅ Implement **programmatic attachment**?
3. ✅ Provision all **42 agents**?
4. ✅ Add to **sync service workflow**?

I can start implementation immediately upon approval.

---

**Status**: Awaiting decision  
**Estimated Implementation**: 6 hours  
**Ready to begin**: Yes
