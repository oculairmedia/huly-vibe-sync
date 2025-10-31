# Letta Code Integration Analysis

## Executive Summary

After reviewing both the updated proposal and the `letta-code` repository, I recommend a **hybrid approach** that leverages the best of both systems while maintaining our PM-focused architecture.

## What We've Built (70% Complete)

### ✅ Completed (M1: Agent Infrastructure)
- Database schema for tracking Letta agents per project
- Letta SDK integration and service wrapper
- Agent creation with MCP tool attachment (Huly + Vibe)
- Integration into sync flow with idempotency

### 🚧 In Progress (M2: State Builder - 40% Complete)
- ✅ Project metadata snapshot builder
- ✅ Board metrics and hotspots analyzer
- ⏳ Backlog summary and change log tracker
- ⏳ Memory block upsert implementation
- ⏳ Integration into sync flow

## What Letta Code Provides

### Core Capabilities
1. **CLI Interface** - Interactive and headless modes for human-agent interaction
2. **Project-Level Persistence** - Auto-resumes agents per directory via `.letta/settings.local.json`
3. **Memory Management** - Hierarchical memory blocks (global, project-local, project-shared)
4. **Tool Management** - Dynamic tool loading with permissions system
5. **Developer Tools** - Bash, Read, Write, Edit, NotebookEdit for code modification

### Architecture Highlights
```typescript
// Memory Hierarchy
~/.letta/settings.json          // Global: persona, human, API keys
./.letta/settings.local.json    // Local: lastAgentId (gitignored)
./.letta/settings.json           // Shared: project block (committable)

// Agent Creation Pattern
- Reuses existing memory blocks (persona, human) across agents
- Creates new blocks only when needed
- Stores block IDs for reuse
```

## Key Differences: Our Service vs Letta Code

| Feature | Huly-Vibe Sync Service | Letta Code |
|---------|----------------------|------------|
| **Purpose** | Automated PM agent with board analysis | Interactive dev agent with code editing |
| **Execution** | Headless, runs on schedule | Interactive CLI, user-initiated |
| **Persistence** | SQLite database | JSON files in `.letta/` |
| **Memory Blocks** | PM-specific: metrics, hotspots, changelog | Dev-focused: persona, human, project |
| **Tools** | MCP only (Huly + Vibe) | Local dev tools (Bash, Read, Write) + MCP |
| **Integration** | Automatic on every sync | Manual via `letta` command |

## Recommended Approach: Hybrid Integration

### Phase 1: Complete Current Work (Immediate)
**Continue with M2-M3 completion** - We're 70% done and our architecture is solid.

**Why:**
- Our PM agent use case is fundamentally different from letta-code's coding agent
- We need automated, headless execution (not interactive CLI)
- Our memory model (board_metrics, hotspots, etc.) is domain-specific
- We already have the core infrastructure working

**Tasks:**
1. ✅ Complete M2.3: Backlog summary and change log tracker
2. ✅ Complete M2.4: Memory block upsert implementation
3. ✅ Complete M2.5: Integration into sync flow
4. ✅ Complete M3: README upload functionality

### Phase 2: Add Letta Code Interop (M4 Enhancement)
**Enable developers to interact with PM agents via letta-code CLI**

**Implementation:**
```javascript
// In processProject(), after agent creation:
if (process.env.LETTA_CODE_INTEROP === 'true') {
  // Write .letta/settings.local.json for auto-resume
  const lettaDir = path.join(filesystemPath, '.letta');
  await fs.mkdir(lettaDir, { recursive: true });
  
  await fs.writeFile(
    path.join(lettaDir, 'settings.local.json'),
    JSON.stringify({
      lastAgentId: agent.id,
      lastInteraction: Date.now(),
    }, null, 2)
  );
  
  console.log(`[Letta] CLI interop enabled: cd ${filesystemPath} && letta`);
}
```

**Usage:**
```bash
# From project directory
cd /opt/stacks/my-project
letta -p "Show me current board hotspots" --tools ""

# The agent auto-resumes and has access to PM memory blocks
# --tools "" prevents loading Bash/Write (keeps it read-only)
```

### Phase 3: Adopt Memory Block Patterns (M2 Refinement)
**Align our memory blocks with letta-code's conventions**

**Current Structure:**
```javascript
// Our PM-specific blocks
{
  persona: "PM agent role...",
  project: { name, identifier, repo_path, vibe_id },
  board_config: { status_mapping, workflow },
  board_metrics: { total, by_status, wip },
  hotspots: { blocked, ageing_wip },
  backlog_summary: { top_items },
  change_log: { recent_changes }
}
```

**Enhanced Structure (Letta Code Compatible):**
```javascript
{
  // Standard letta-code blocks
  persona: "PM agent role...",          // Global, reusable
  human: "Team preferences...",         // Global, reusable
  
  // Project-specific (committable)
  project: {
    name, identifier, repo_path,
    board_url: `${VIBE_API_URL}/projects/${vibe_id}`,
    sync_metadata: { last_sync, sync_count }
  },
  
  // PM domain blocks (our innovation)
  board_state: { metrics, hotspots },   // Dynamic, updated each sync
  backlog: { top_items, priorities },   // Dynamic
  history: { change_log, trends }       // Append-only
}
```

## Implementation Priority

### High Priority (This Sprint)
1. ✅ Complete M2.3-M2.5 (state builder + memory upsert)
2. ✅ Complete M3 (README upload)
3. ✅ Test end-to-end PM agent flow
4. ✅ Document PM agent capabilities

### Medium Priority (Next Sprint)
1. Add `.letta/settings.local.json` writer for CLI interop
2. Document how developers can use `letta` to query PM agents
3. Add environment flag: `LETTA_CODE_INTEROP=true`
4. Create usage examples in README

### Low Priority (Future)
1. Consider adopting letta-code's permission system for M5
2. Explore using letta-code as a library (if they export modules)
3. Contribute PM agent patterns back to letta-code project

## Technical Recommendations

### Do Now
- ✅ **Keep our current architecture** - it's working and nearly complete
- ✅ **Finish M2-M3** - we're 70% done, push through
- ✅ **Add Letta Code mention to README** - acknowledge the awesome work

### Do Soon (M4)
- Add `.letta/settings.local.json` writer for interop
- Test manual agent queries via letta-code CLI
- Document developer workflow

### Consider Later (M5)
- Evaluate letta-code's permission system for gated writes
- Explore shared memory block infrastructure
- Contribute our PM patterns to letta-code

## Code Changes Needed (Minimal)

### 1. Add Letta Code Interop Flag
```javascript
// In .env
LETTA_CODE_INTEROP=false  // Off by default

// In config
letta: {
  ...existing config...,
  cliInterop: process.env.LETTA_CODE_INTEROP === 'true',
}
```

### 2. Write CLI Settings After Agent Creation
```javascript
// In processProject(), after agent ensure
if (config.letta.cliInterop && filesystemPath) {
  await writeLettaCliSettings(filesystemPath, agent.id);
}

async function writeLettaCliSettings(repoPath, agentId) {
  const lettaDir = path.join(repoPath, '.letta');
  await fs.mkdir(lettaDir, { recursive: true });
  
  const settings = {
    lastAgentId: agentId,
    lastInteraction: Date.now(),
  };
  
  await fs.writeFile(
    path.join(lettaDir, 'settings.local.json'),
    JSON.stringify(settings, null, 2)
  );
}
```

### 3. Update .gitignore Template
```bash
# Add to .gitignore in each repo (or document)
.letta/settings.local.json
```

## Benefits of This Approach

### ✅ Pros
1. **No major refactoring** - we keep 70% of completed work
2. **Best of both worlds** - automated PM + interactive queries
3. **Standards compliance** - align with letta-code patterns where sensible
4. **Developer empowerment** - enable manual agent interaction
5. **Fast completion** - finish M2-M3 quickly, add interop later

### ⚠️ Considerations
1. **Two persistence systems** - SQLite (service) + JSON (letta-code)
2. **Memory block drift** - keep PM blocks separate from dev blocks
3. **Tool confusion** - document which tools are available where

## Conclusion

**Recommended Path Forward:**

1. **Complete M2-M3 NOW** (1-2 hours of work remaining)
2. **Add minimal Letta Code interop in M4** (30 minutes)
3. **Document both modes** (service auto-sync + CLI queries)
4. **Test and iterate** on memory block structure

This gives us:
- ✅ A working PM agent system (our original goal)
- ✅ Developer-friendly CLI access (bonus from letta-code)
- ✅ Standards alignment (memory blocks, agent patterns)
- ✅ Fast time to completion (finish what we started)

**Next Steps:**
1. Get approval on this approach
2. Complete M2.3: Backlog summary and change log tracker
3. Complete M2.4: Memory block upsert  
4. Complete M2.5: Wire into sync flow
5. Complete M3: README upload
6. Add optional Letta Code interop flag
7. Document everything
8. Ship it! 🚀
