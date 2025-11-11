# Phase 1 (Huly→Vibe) Issue Analysis

## Problem Report

User reported that when changing a value in Huly, it did not reflect accurately in Vibe Kanban.

## Investigation Results

### ✅ Phase 2 (Vibe→Huly) Timestamp Protection Working

Looking at logs, I found evidence that **Phase 2 protection IS working**:

```
{"level":"warn","time":"2025-11-06T06:14:32.143Z","identifier":"LMS-28","hulyStatus":"Done","msg":"Conflict detected - both systems changed, Huly wins"}
{"level":"info","time":"2025-11-06T06:15:02.651Z","identifier":"LMS-28","hulyModifiedAt":"2025-11-06T06:14:15.422Z","vibeModifiedAt":"2025-10-27T20:11:58.321Z","msg":"Skipping Phase 2 - Huly change is newer (timestamp conflict resolution)"}
```

This shows:

1. Phase 1 detected conflict and said "Huly wins"
2. Phase 2 correctly skipped overwriting Huly

### ❓ Phase 1 (Huly→Vibe) Status Updates

**Question**: Did Phase 1 actually UPDATE Vibe with the Huly change?

**Evidence from logs**: Only seeing conflict warnings, not seeing explicit "Huly→Vibe: Status update" messages.

## Root Cause Analysis

### Issue #1: Missing `vibe_status` Column (Bug)

**Code** (`lib/SyncOrchestrator.js:409`):

```javascript
const lastKnownVibeStatus = dbIssue?.vibe_status;
```

**Problem**: The `vibe_status` column does NOT exist in the database schema!

**Database Schema**:

```
sqlite> PRAGMA table_info(issues);
...
6|status|TEXT|0||0
11|huly_modified_at|INTEGER|0||0
12|vibe_modified_at|INTEGER|0||0
// NO vibe_status column!
```

**Impact**:

- `lastKnownVibeStatus` is always `undefined`
- Line 456: `vibeChanged = existingTask.status !== undefined` is ALWAYS `true`
- This causes every Phase 1 sync to think "both systems changed" (conflict)
- Goes into conflict branch (line 458-471) instead of "Huly only changed" branch (line 472-487)

### Issue #2: Conflict Branch Still Updates (Mitigating Factor)

**Good news**: Even in the conflict branch (lines 458-471), the code DOES update Vibe if statuses don't match:

```javascript
if (hulyChanged && vibeChanged) {
  // Both changed - conflict! Huly wins
  log.warn(..., 'Conflict detected - both systems changed, Huly wins');
  if (!statusesMatch) {
    await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus, config);
    phase1UpdatedTasks.add(existingTask.id);
  }
}
```

So Phase 1 SHOULD still be updating Vibe, but:

1. It logs it as a "conflict" (wrong log level/message)
2. It only updates if `!statusesMatch`

### Issue #3: Status Mapping Comparison

The check `!statusesMatch` (line 468) compares normalized statuses:

```javascript
const statusesMatch = normalizeStatus(existingTask.status) === normalizeStatus(vibeStatus);
```

**Potential issue**: If the status mapping or normalization is off, it might think statuses match when they don't, preventing the update.

## Test Coverage

✅ **Tests Added** (23 tests pass):

- 3 new tests specifically for Phase 1 Huly→Vibe propagation
- Tests verify the LOGIC works correctly (database updates, change detection)
- Tests do NOT cover the actual API calls to Vibe

## Verification Needed

To confirm Phase 1 is working, we need to:

1. **Check Vibe directly**: Look at the actual task in Vibe Kanban
2. **Check logs for UPDATE calls**: Search for actual Vibe API update attempts
3. **Test with a fresh change**: Make a new status change in Huly and monitor logs

### Commands to Verify:

```bash
# Watch for Phase 1 updates in real-time
docker-compose logs -f | grep -E "Huly→Vibe|updateVibeTaskStatus|Conflict detected"

# Check database vs Vibe for specific issue
sqlite3 logs/sync-state.db "SELECT identifier, status, vibe_task_id FROM issues WHERE identifier='LMS-28';"
# Then check that vibe_task_id in Vibe Kanban UI
```

## Recommended Fixes

### Fix #1: Add `vibe_status` Column (Proper Solution)

**Migration**: `migrations/004_add_vibe_status.sql`

```sql
ALTER TABLE issues ADD COLUMN vibe_status TEXT;
CREATE INDEX IF NOT EXISTS idx_issues_vibe_status ON issues(vibe_status);
```

**Update `database.js`** to store vibe_status:

```javascript
vibe_status = ${issue.vibe_status || null}
```

**Update `SyncOrchestrator.js`** Phase 1 to store it (line 499):

```javascript
vibe_status: existingTask.status,  // This line already exists!
```

**Note**: The code ALREADY tries to store `vibe_status` (line 499), but the column doesn't exist, so it's silently ignored!

### Fix #2: Better Logging

Add more explicit logging in Phase 1 to track what's happening:

```javascript
if (hulyChanged && vibeChanged) {
  log.warn({
    identifier: hulyIssue.identifier,
    hulyStatus: hulyIssue.status,
    vibeStatus: existingTask.status,
    willUpdate: !statusesMatch,
  }, 'Phase 1: Conflict detected - both systems changed, Huly wins');

  if (!statusesMatch) {
    log.info({ from: existingTask.status, to: vibeStatus }, 'Phase 1: Updating Vibe status');
    await updateVibeTaskStatus(...);
  } else {
    log.debug('Phase 1: Statuses already match, skipping update');
  }
}
```

## Summary

**Current Behavior**:

- ✅ Phase 2 timestamp protection works perfectly
- ❓ Phase 1 updates probably work but logged as "conflicts"
- ❌ `vibe_status` column missing causes incorrect conflict detection
- ❓ Need to verify actual Vibe updates are happening

**Next Steps**:

1. Verify if Vibe actually got updated (check UI)
2. If not updated: check status mapping and normalization
3. If updated: the issue is just logging/detection, not functionality
4. Consider adding `vibe_status` column for proper tracking

**Test Results**: ✅ 23/23 tests passing (including 3 new Phase 1 tests)

---

**Investigation Date**: November 6, 2025  
**Status**: Issue identified, verification needed, fixes proposed
