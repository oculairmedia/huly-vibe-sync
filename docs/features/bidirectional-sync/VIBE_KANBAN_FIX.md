# Fix for Vibe Kanban Timestamp Bug

## The Problem

Vibe Kanban's `Task::update()` function doesn't update the `updated_at` timestamp when you change a task's status via the REST API or UI. This causes the huly-vibe-sync to oscillate because it can't tell which system was modified more recently.

## The Fix

**File**: `crates/db/src/models/task.rs`  
**Line**: 317

### Change This:
```rust
r#"UPDATE tasks 
   SET title = $3, description = $4, status = $5, parent_task_attempt = $6 
   WHERE id = $1 AND project_id = $2 
   RETURNING ..."#,
```

### To This:
```rust
r#"UPDATE tasks 
   SET title = $3, description = $4, status = $5, parent_task_attempt = $6, updated_at = datetime('now', 'subsec')
   WHERE id = $1 AND project_id = $2 
   RETURNING ..."#,
```

## How to Apply

1. **Copy the fixed source**:
```bash
cp -r /opt/stacks/huly-vibe-sync/vibe-kanban-source /opt/stacks/vibe-kanban-fixed
cd /opt/stacks/vibe-kanban-fixed
```

2. **Build the Docker image**:
```bash
docker build -t vibe-kanban:fixed .
```

3. **Update your docker-compose.yml** to use the fixed image:
```yaml
services:
  vibe-kanban:
    image: vibe-kanban:fixed
    # ... rest of config
```

4. **Restart Vibe Kanban**:
```bash
cd /opt/stacks/vibe-kanban
docker-compose down
docker-compose up -d
```

## Verification

After applying the fix, when you move a task in Vibe Kanban UI, check that the `updated_at` field changes:

```bash
# Via MCP API
curl -X POST http://192.168.50.90:9717/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tasks","arguments":{"project_id":"YOUR_PROJECT_ID"}}}' \
  | jq -r '.result.content[0].text' \
  | jq '.[] | select(.title | contains("YOUR_TASK")) | .updated_at'
```

The timestamp should reflect the current time after you move the task.

## Alternative: Use the Fixed Source I Already Patched

The source at `/opt/stacks/huly-vibe-sync/vibe-kanban-source` already has the fix applied. You can build from there directly.

## File Bug Report

Consider filing this as a bug report with Vibe Kanban:
- Repository: https://github.com/BloopAI/vibe-kanban
- Issue: Task.update() doesn't update updated_at timestamp
- Impact: Breaks bidirectional sync systems that rely on timestamps

