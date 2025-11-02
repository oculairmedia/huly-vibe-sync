# SKIP_EMPTY_PROJECTS Improvements

## Overview

Enhanced the `SKIP_EMPTY_PROJECTS` optimization to detect and sync projects when their metadata changes, even if they're empty and were recently checked.

## Problem

The original `SKIP_EMPTY_PROJECTS` logic would skip empty projects that were checked within the cache expiry window (5 minutes). This meant:
- Projects with updated descriptions wouldn't sync until the cache expired
- Filesystem paths added to descriptions wouldn't be detected immediately
- `.letta/settings.local.json` files wouldn't be created for empty projects with new metadata

## Solution

### 1. Added Description Hash Tracking

**Database Schema Change** (`migrations/002_add_description_hash.sql`):
```sql
ALTER TABLE projects ADD COLUMN description_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_description_hash ON projects(description_hash);
```

**Hash Computation** (`lib/database.js`):
```javascript
static computeDescriptionHash(description) {
  if (!description) return null;
  return crypto.createHash('sha256').update(description).digest('hex').substring(0, 16);
}
```

### 2. Updated Sync Logic Priority

**New Priority Order** (`lib/database.js - getProjectsToSync()`):
1. ✅ Projects with issues (issue_count > 0) - **always sync**
2. ✅ Projects with null description_hash - **always sync** (needs initial hash)
3. ✅ Projects with changed description_hash - **always sync** (metadata changed)
4. ✅ Projects with expired cache (last_checked_at < cutoff) - **sync if cache expired**

**Before:**
```javascript
// Would skip empty projects checked recently, even with changed descriptions
if (project.issue_count > 0) return true;
if (project.last_checked_at < cutoff) return true;
return false;
```

**After:**
```javascript
// Checks metadata changes BEFORE cache expiry
if (project.issue_count > 0) return true;

// Check metadata changes (higher priority than cache)
if (currentHash) {
  if (!project.description_hash) return true;  // Needs initial hash
  if (currentHash !== project.description_hash) return true;  // Changed
}

// Finally check cache expiry
if (project.last_checked_at < cutoff) return true;
return false;
```

### 3. Main Sync Loop Integration

**Updated `index.js`:**
```javascript
// Compute description hashes for ALL projects
const { SyncDatabase } = await import('./lib/database.js');
const descriptionHashes = {};
for (const project of hulyProjects) {
  const identifier = project.identifier || project.name;
  descriptionHashes[identifier] = SyncDatabase.computeDescriptionHash(project.description);
}

// Pass hashes to filtering logic
const projectsNeedingSync = db.getProjectsToSync(300000, descriptionHashes);
```

**Project Upsert:**
```javascript
// Store hash with project
db.upsertProject({
  identifier: projectIdentifier,
  name: hulyProject.name,
  filesystem_path: filesystemPath,
  description_hash: descriptionHash,  // NEW
});
```

## Benefits

### 1. Immediate Change Detection
- Projects with updated descriptions sync immediately
- No need to wait for cache expiry (5 minutes)

### 2. Automatic Initial Hash Population
- All projects get their first hash on next sync
- Logged as: `[DB] Project {identifier} needs initial hash, forcing sync`

### 3. Metadata Update Detection
- Changes to project descriptions trigger sync
- Logged as: `[DB] Project {identifier} metadata changed, forcing sync`

### 4. Filesystem Path Updates
- When paths are added/updated in Huly descriptions
- `.letta/settings.local.json` files are created immediately

## Example Log Output

```
[DB] Querying projects to sync (checking for changes and skipping recently checked empty projects)...
[DB] Project AUGMT needs initial hash, forcing sync
[DB] Project CAGW metadata changed, forcing sync
[Skip] 38 empty projects (cached in database)

--- Processing Huly project: Claude API Gateway ---
[Letta] ✓ Saved agent ID to project: /opt/stacks/claude api gateway/.letta/settings.local.json
```

## Performance Impact

- **Minimal**: Hash computation is O(n) where n = description length (usually < 1KB)
- **SHA-256 truncated to 16 chars**: Fast and sufficient for change detection
- **No additional DB queries**: Hashes computed in memory before filtering
- **Still skips empty projects**: When metadata hasn't changed

## Testing

Tested with 44 Huly projects:
- ✅ 40 projects correctly synced with initial hashes
- ✅ Description changes detected and synced immediately
- ✅ Empty projects still cached when metadata unchanged
- ✅ `.letta` files created for all applicable projects

## Migration

The `description_hash` column is added automatically on service startup if missing.

Existing projects will have `null` description_hash initially, which triggers a sync on next cycle to populate it.

## Future Enhancements

Potential improvements:
1. Track `filesystem_path` changes separately from description
2. Add hash for git_url changes
3. Support manual force-sync via API endpoint
4. Add webhook support to trigger immediate sync on Huly changes
