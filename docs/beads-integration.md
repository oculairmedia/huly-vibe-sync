# Beads Integration

## Overview

This document describes the integration of **Beads** (git-backed distributed issue tracker) into the huly-vibe-sync bidirectional synchronization system.

## Architecture

The sync system now supports **three-way synchronization**:

1. **Phase 1: Huly → Vibe** (existing) - Source of truth: Huly
2. **Phase 2: Vibe → Huly** (existing) - Bidirectional status updates
3. **Phase 3: Beads ↔ Huly** (NEW) - Bidirectional sync with git-backed issues

### Sync Flow

```
┌──────────┐
│   Huly   │ (Central issue tracker)
└────┬─────┘
     │
     ├──► Phase 1 ──────► Vibe Kanban (visual board)
     │                    │
     │◄─── Phase 2 ───────┘
     │
     └──► Phase 3 ──────► Beads (git-backed)
          ◄────────────┘
```

## Components

### 1. BeadsService.js

Located at: `lib/BeadsService.js`

**Responsibilities:**
- Execute `bd` CLI commands via `execSync()`
- List, create, update, and close beads issues
- Bidirectional sync between Huly and Beads
- Track sync state in database

**Key Functions:**
- `listBeadsIssues(projectPath, filters)` - Fetch all beads issues
- `getBeadsIssue(projectPath, issueId)` - Get single issue by ID
- `createBeadsIssue(projectPath, issueData, config)` - Create new issue
- `updateBeadsIssue(projectPath, issueId, field, value, config)` - Update field
- `closeBeadsIssue(projectPath, issueId, config)` - Close issue
- `reopenBeadsIssue(projectPath, issueId, config)` - Reopen closed issue
- `syncHulyIssueToBeads(projectPath, hulyIssue, beadsIssues, db, config)` - Huly → Beads
- `syncBeadsIssueToHuly(hulyClient, beadsIssue, hulyIssues, projectIdentifier, db, config, phase3UpdatedIssues)` - Beads → Huly

### 2. Field Mappings (statusMapper.js)

**Status Mapping:**

| Huly Status | Beads Status | Notes |
|-------------|--------------|-------|
| Backlog     | open         | Default state |
| Todo        | open + `huly:Todo` label | Preserves Todo vs Backlog |
| In Progress | in_progress  | Native Beads status |
| In Review   | in_progress + `huly:In Review` label | Preserves review state |
| Done        | closed       | Native close state |
| Canceled    | closed + `huly:Canceled` label | Preserves canceled vs done |

**Priority Mapping:**

| Huly Priority | Beads Priority | Numeric Value |
|---------------|----------------|---------------|
| Urgent        | 1              | Highest       |
| High          | 2              |               |
| Medium        | 3              | Default       |
| Low           | 4              |               |
| NoPriority    | 5              | Lowest        |

**Issue Type Mapping:**

| Huly Type | Beads Type | Notes |
|-----------|------------|-------|
| Task      | task       | Default |
| Bug       | bug        | |
| Feature   | feature    | |
| Epic      | epic       | |
| Chore     | chore      | Maintenance work |

### 3. Database Schema (database.js)

**New Columns in `issues` table:**
- `beads_issue_id TEXT` - Beads issue ID (e.g., "graphiti-abc123")
- `beads_status TEXT` - Cached beads status (open/closed)
- `beads_modified_at INTEGER` - Timestamp of last beads modification

**Migration:**
- Migration script: `migrations/add-beads-support.js`
- Run automatically adds columns using `ALTER TABLE`
- Safe to run multiple times (idempotent)

### 4. Configuration (config.js)

**Environment Variables:**

```bash
# Enable/disable beads sync (default: true)
BEADS_ENABLED=true

# Beads sync interval in milliseconds (default: 60000 = 1 minute)
BEADS_SYNC_INTERVAL=60000
```

**Config Structure:**

```javascript
{
  beads: {
    enabled: true,      // Enable beads sync
    syncInterval: 60000 // Sync interval in ms
  }
}
```

### 5. Sync Orchestrator Integration (SyncOrchestrator.js)

**Phase 3: Beads ↔ Huly**

Located after Phase 2 in `syncHulyToVibe()` function.

**Conditions:**
- Only runs if `config.beads.enabled === true`
- Only syncs projects with `filesystem_path` set
- Requires `.beads/` directory in project path

**Sub-phases:**
1. **Phase 3a: Huly → Beads** - Create/update beads issues from Huly
2. **Phase 3b: Beads → Huly** - Update Huly status from beads changes

**Loop Prevention:**
- Tracks updated issues in `phase3UpdatedIssues` Set
- Skips bidirectional updates for issues just modified

### 6. Enhanced Beads Status Sync (Phase 3b)

Beads → Huly sync now resolves status using this priority:

1. `beadsIssue.metadata.huly_status` when available
2. Fallback mapping from Beads status + labels

For closed Beads issues, sync always respects the close action and maps from
`closed` (typically `Done`, or `Canceled` when `huly:Canceled` is present).

This guarantees:

- Backward compatibility for older issues (no metadata required)
- Correct close behavior when users run `bd close`
- Status restoration on reopen when metadata is available

### 7. Repository Path Validation Before Sync

Before any Beads sync phase runs, repository path validation now checks:

- Path is a non-empty absolute string
- Path exists and is a directory
- `.git` exists (valid git repository)

Invalid paths are skipped gracefully with clear logs, and sync continues for
other valid projects.

## Installation & Setup

### 1. Install Beads CLI

```bash
# Beads should already be installed at /usr/local/bin/bd
bd version
```

### 2. Initialize Beads in Project

For each project that should sync with beads:

```bash
cd /opt/stacks/your-project
bd init
bd hooks install  # Optional: auto-sync on git operations
```

### 3. Run Database Migration

```bash
cd /opt/stacks/huly-vibe-sync
node migrations/add-beads-support.js
```

### 4. Configure Environment

The beads integration is **enabled by default**. To disable:

```bash
# In .env file
BEADS_ENABLED=false
```

### 5. Restart Sync Service

```bash
docker-compose restart huly-vibe-sync
```

## Usage

### Automatic Sync

Once configured, beads sync happens automatically during the regular sync cycle:

1. Huly issues are synced to beads (created/updated)
2. Beads status changes (open → closed) sync back to Huly
3. Sync state tracked in SQLite database

### Manual Testing

**List beads issues in a project:**

```bash
cd /opt/stacks/graphiti
bd list
```

**Check sync state in database:**

```bash
sqlite3 /opt/stacks/huly-vibe-sync/sync-state.db \
  "SELECT identifier, beads_issue_id, beads_status 
   FROM issues 
   WHERE beads_issue_id IS NOT NULL 
   LIMIT 10;"
```

**Test beads service directly:**

```bash
cd /opt/stacks/huly-vibe-sync
node -e "
import('./lib/BeadsService.js').then(m => 
  m.listBeadsIssues('/opt/stacks/graphiti')
    .then(issues => console.log('Found', issues.length, 'issues'))
)
"
```

## Conflict Resolution

### Status Conflicts

When both Huly and Beads change status between syncs:

**Strategy:** Last-write-wins (currently)

**Example:**
1. Initial: Huly = "In Progress", Beads = "open"
2. User closes in beads: Beads = "closed"
3. User updates in Huly: Huly = "In Review"
4. Next sync:
   - Phase 3a: Huly → Beads (Huly wins, beads reopened)
   - Phase 3b: Skipped (beads just updated)

**Future Improvement:** Add timestamp-based conflict resolution using `beads_modified_at` and `huly_modified_at`.

### Description Conflicts

**Current Behavior:**
- Descriptions are NOT synced bidirectionally
- Beads description set once on creation with Huly footer: `---\nHuly Issue: GRAPH-123`
- Changes to beads descriptions do not sync back to Huly

**Rationale:** Beads uses comments for descriptions, complex to bidirectionally sync

## Limitations

### Current Limitations

1. **Status Granularity**
   - Beads only has "open" and "closed"
   - Multiple Huly statuses map to "open" (Backlog, In Progress, In Review)
   - Status changes within "open" states don't sync to beads

2. **Description Sync**
   - Descriptions only sync Huly → Beads on creation
   - Beads description changes don't sync back to Huly

3. **Assignee Sync**
   - Assignee field not currently synced
   - Would require user mapping between Huly and beads

4. **Dependencies**
   - Beads dependency tracking not synced
   - Huly sub-issues not mapped to beads dependencies

5. **Labels/Tags**
   - Beads labels not synced to Huly
   - Huly components/milestones not synced to beads

6. **No Arbitrary Metadata in `bd` CLI**
   - Current `bd create/update/show` commands expose labels and standard fields
   - No generic key/value metadata flag is available for issues
   - `.beads/issues.jsonl` does not include a `metadata` object by default

## Beads Metadata/Tags Research (HVSYN-186)

### Questions Answered

1. **Metadata storage**: No documented generic per-issue key/value metadata write API in current `bd` CLI.
2. **Tag support**: Labels are fully supported and round-trip via CLI + JSONL.
3. **CLI access**: Use `--labels`, `--add-label`, `--remove-label`, `--set-labels`.
4. **JSONL format**: Stores `labels`, no `metadata` field by default.
5. **Update mechanism**: Label updates were observed without `updated_at` changing in local POC.

### Proof-of-Concept

```bash
bd create "Metadata POC" --labels "huly:In Review" --json --no-daemon
bd show <id> --json --no-daemon
bd update <id> --add-label "huly:Todo" --json --no-daemon
```

Observed `bd show --json` keys:

`created_at, created_by, description, id, issue_type, labels, owner, priority, status, title, updated_at`

Observed `.beads/issues.jsonl` keys:

`created_at, created_by, description, id, issue_type, labels, owner, priority, status, title, updated_at`

### Recommendation

- Primary status persistence approach: labels (`huly:Todo`, `huly:In Review`, `huly:Canceled`)
- Forward-compatible enhancement: read `metadata.huly_status` when present
- Do not depend on custom metadata writes until Beads adds explicit metadata support

### Project Requirements

- Project must have `filesystem_path` set in Huly project description
- Project must have `.beads/` directory initialized
- `bd` CLI must be accessible in PATH

## Troubleshooting

### Beads sync not running

**Check config:**

```bash
docker exec huly-vibe-sync env | grep BEADS
```

**Expected output:**
```
BEADS_ENABLED=true
BEADS_SYNC_INTERVAL=60000
```

### Project not syncing to beads

**Check project has filesystem_path:**

```bash
sqlite3 /tmp/container-sync-state.db \
  "SELECT identifier, name, filesystem_path 
   FROM projects 
   WHERE identifier = 'GRAPH';"
```

**Check beads initialized:**

```bash
ls -la /opt/stacks/graphiti/.beads/
bd info  # In project directory
```

### Beads issues not appearing in Huly

**Check database sync state:**

```bash
# Copy database from container
docker cp huly-vibe-sync:/app/logs/sync-state.db /tmp/sync-state.db

# Check beads sync
sqlite3 /tmp/sync-state.db \
  "SELECT identifier, title, status, beads_issue_id, beads_status 
   FROM issues 
   WHERE project_identifier = 'GRAPH' 
   AND beads_issue_id IS NOT NULL;"
```

**Check sync logs:**

```bash
docker logs huly-vibe-sync --tail=100 | grep -i beads
```

### Database migration failed

**Re-run migration:**

```bash
cd /opt/stacks/huly-vibe-sync
node migrations/add-beads-support.js
```

**Migration is idempotent** - safe to run multiple times.

## Performance Considerations

### Sync Frequency

- Default: Every 60 seconds (configurable via `BEADS_SYNC_INTERVAL`)
- Beads sync adds ~1-2 seconds per project with beads initialized
- Scales linearly with number of beads-enabled projects

### Database Performance

- New indexes added: `idx_issues_beads_id`
- Minimal performance impact (< 1% overhead)
- Database size increase: ~3 bytes per issue (for `beads_issue_id`)

### CLI Overhead

- Each beads operation spawns `bd` process via `execSync()`
- Typical latency: 50-200ms per operation
- Consider batch operations for large syncs (future improvement)

## Future Enhancements

### Planned Features

1. **Bidirectional Description Sync**
   - Parse beads comments and sync back to Huly
   - Handle comment threading

2. **Timestamp-based Conflict Resolution**
   - Use `beads_modified_at` and `huly_modified_at`
   - Implement three-way merge strategy

3. **Assignee Mapping**
   - Map Huly users to beads assignees
   - Configurable user mapping file

4. **Dependency Sync**
   - Map Huly sub-issues to beads dependencies
   - Sync blocked/blocker relationships

5. **Batch Operations**
   - Bulk create/update via single `bd` invocation
   - Reduce CLI overhead

6. **Webhook Integration**
   - Real-time sync via git hooks
   - Reduce polling frequency

### Known Issues

- None currently

## References

- **Beads Documentation:** `/opt/stacks/beads/README.md`
- **Beads CLI Help:** `bd help`
- **Huly API Docs:** Check `huly-mcp` MCP server
- **SyncOrchestrator:** `lib/SyncOrchestrator.js` (lines 557-625)
- **BeadsService:** `lib/BeadsService.js`

## Support

For issues or questions:

1. Check logs: `docker logs huly-vibe-sync`
2. Verify beads status: `bd status` in project directory
3. Check database state: See troubleshooting section above
4. Review sync orchestrator logs for Phase 3 entries
