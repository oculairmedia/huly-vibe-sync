# Vibe Sync - Comprehensive Refactoring Plan

## Executive Summary

After reviewing the entire codebase, the system works but has several architectural issues that will cause problems at scale. The most critical issue is the **file-based JSON state management** which needs to be replaced with a proper database.

---

## 🔴 Critical Issues (Must Fix)

### 1. **State Management - Replace JSON with SQLite** ⭐ TOP PRIORITY

**Current Problem (index.js:47-93):**
```javascript
const SYNC_STATE_FILE = path.join(__dirname, 'logs', '.sync-state.json');
const projectActivityCache = new Map(); // Lost on restart

function saveSyncState(state) {
  fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2)); // No locking!
}
```

**Issues:**
- ❌ No atomic writes → data corruption risk
- ❌ No concurrent access control → race conditions
- ❌ 40+ projects in single JSON file → slow
- ❌ projectActivityCache lost on restart
- ❌ Can't efficiently query: "show projects with issues > 10"
- ❌ No historical tracking
- ❌ No transaction support

**Solution:** ✅ **SQLite Database (ALREADY CREATED: `lib/database.js`)**

**Benefits:**
- ✅ ACID transactions (no corruption)
- ✅ Concurrent reads, safe writes
- ✅ Fast indexed queries
- ✅ Built-in locking
- ✅ ~1MB overhead
- ✅ Persistent cache
- ✅ Historical tracking

**Migration Path:**
1. ✅ Database module created (`lib/database.js`)
2. ⏳ Update package.json (DONE)
3. ⏳ Integrate into index.js (see below)
4. ⏳ Test migration
5. ⏳ Deploy

---

### 2. **Fragile Text Parsing** (index.js:249-469)

**Current:**
```javascript
// Lines 249-314: Parsing emoji-decorated text
if (trimmed.startsWith('📁 ') && trimmed.includes('(') && trimmed.endsWith(')')) {
  // Extract name and identifier
  const content = trimmed.substring(2); // Remove "📁 "
  const lastParen = content.lastIndexOf('(');
  const name = content.substring(0, lastParen).trim();
  // ...
}
```

**Problems:**
- ❌ Brittle - breaks if MCP output format changes
- ❌ No error handling for malformed responses
- ❌ Manual string parsing with substring() is error-prone
- ❌ Relies on emojis (📁, 📋) for structure detection

**Solutions:**
1. **Short-term:** Add validation and fallbacks
2. **Long-term:** Request JSON output from Legacy MCP or use structured parser

---

### 3. **Giant Function: `syncLegacyToVibe` (185 lines)**

**Lines 835-1019:** This function does EVERYTHING:
- Fetches projects
- Filters projects
- Creates projects
- Syncs issues
- Handles errors
- Generates reports

**Refactor to:**
```javascript
async function syncLegacyToVibe(legacyClient, vibeClient, db) {
  const syncId = db.startSyncRun();

  try {
    const projects = await fetchAndFilterProjects(legacyClient, db);
    const results = await processProjects(projects, legacyClient, vibeClient, db);

    const stats = generateStats(results);
    db.completeSyncRun(syncId, stats);

    return stats;
  } catch (error) {
    db.completeSyncRun(syncId, { error: error.message });
    throw error;
  }
}
```

---

### 4. **No Retry Logic or Circuit Breaker**

**Current:** If API is down, sync fails completely with no recovery.

**Add:**
```javascript
// lib/retry.js
export async function withRetry(fn, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const baseDelay = options.baseDelay || 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;

      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`[Retry] Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

---

## 🟡 High Priority Issues

### 5. **No Structured Logging**

**Current:**
```javascript
console.log('[Legacy] Found ${projects.length} projects');
```

**Problems:**
- Can't filter by log level
- Can't parse logs programmatically
- No timestamps (Docker adds them, but not in code)

**Solution:** Create `lib/logger.js`
```javascript
export const logger = {
  info: (component, message, meta = {}) => log('INFO', component, message, meta),
  warn: (component, message, meta = {}) => log('WARN', component, message, meta),
  error: (component, message, meta = {}) => log('ERROR', component, message, meta),
};

function log(level, component, message, meta) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
    ...meta,
  }));
}
```

---

### 6. **Missing Input Validation**

**Lines 22-43:** Config has NO validation:
```javascript
const config = {
  sync: {
    interval: parseInt(process.env.SYNC_INTERVAL || '300000'),  // NaN if invalid!
    maxWorkers: parseInt(process.env.MAX_WORKERS || '5'),      // Could be -5 or 99999
  }
};
```

**Add validation:**
```javascript
function validateConfig(config) {
  const errors = [];

  if (!config.legacy.apiUrl) errors.push('REMOVED_API_URL required');
  if (!config.vibeKanban.apiUrl) errors.push('VIBE_API_URL required');
  if (isNaN(config.sync.interval) || config.sync.interval < 0) {
    errors.push('SYNC_INTERVAL must be positive number');
  }
  if (config.sync.maxWorkers < 1 || config.sync.maxWorkers > 50) {
    errors.push('MAX_WORKERS must be 1-50');
  }

  if (errors.length > 0) {
    console.error('Configuration errors:', errors);
    process.exit(1);
  }
}
```

---

### 7. **Hardcoded Magic Numbers**

```javascript
setTimeout(resolve, 50);  // Why 50ms?
60000,  // 1 minute
900000, // 15 minutes
300000  // 5 minutes
```

**Extract to constants:**
```javascript
// lib/constants.js
export const TIMEOUTS = {
  MCP_CALL: 60000,
  FULL_SYNC: 900000,
  API_RATE_LIMIT: 50,
};

export const CACHE = {
  PROJECT_ACTIVITY_TTL: 300000,
  MAX_SIZE: 1000,
};

export const SYNC_DEFAULTS = {
  INTERVAL: 300000,
  MAX_WORKERS: 5,
  HEARTBEAT_INTERVAL: 30000,
};
```

---

### 8. **Weak Timeout Implementation**

**Lines 105-120:**
```javascript
async function withTimeout(promise, timeoutMs, operation) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout`)), timeoutMs)
    )
  ]);
}
```

**Problem:** Timeout doesn't CANCEL the underlying promise. It continues running, potentially causing resource leaks.

**Better:** Use `AbortController` (like LegacyRestClient does):
```javascript
async function withTimeout(promiseFn, timeoutMs, operation) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await promiseFn(controller.signal);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Timeout after ${timeoutMs}ms: ${operation}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

---

### 9. **Inconsistent Error Handling**

Sometimes returns `[]`, sometimes `null`, sometimes throws:
```javascript
// index.js:374
return [];

// index.js:647
return null;

// index.js:78
throw error;
```

**Standardize:** Always return empty arrays for collections, throw for errors.

---

## 🟢 Medium Priority

### 10. **Duplicate MCP Client Code**
- `sync-projects.js` has simplified MCPClient
- `index.js` has full MCPClient
- **Fix:** Extract to `lib/MCPClient.js`

### 11. **No Metrics/Observability**
- Add execution time tracking
- Add success/failure rates
- Add slow query detection

### 12. **Memory Leak Risk**
```javascript
const projectActivityCache = new Map(); // Unbounded growth
```
**Fix:** Add TTL and max size limits

---

## 📁 Recommended File Structure

```
lib/
  clients/
    LegacyRestClient.js      ✅ Already exists
    MCPClient.js           ⏳ Extract from index.js
    VibeClient.js          ⏳ Wrapper for Vibe REST API

  parsers/
    legacy-text-parser.js    ⏳ Extract parseProjectsFromText, parseIssuesFromText
    status-mapper.js       ⏳ mapLegacyStatusToVibe, mapVibeStatusToLegacy

  services/
    sync-service.js        ⏳ Main sync orchestration
    project-sync.js        ⏳ Project-level operations
    issue-sync.js          ⏳ Issue-level operations

  utils/
    database.js            ✅ Already created!
    logger.js              ⏳ Structured logging
    retry.js               ⏳ Exponential backoff
    constants.js           ⏳ All magic numbers
    config-validator.js    ⏳ Validate env vars

index.js                   ⏳ Minimal entry point (< 100 lines)
```

---

## 🚀 Implementation Steps

### Phase 1: Database Integration (1-2 days) ⭐ DO THIS FIRST

1. ✅ Add `better-sqlite3` to package.json (DONE)
2. ✅ Create `lib/database.js` (DONE)
3. ⏳ Update Dockerfile to include build dependencies
4. ⏳ Integrate database into `index.js`
5. ⏳ Migrate existing JSON state on first run
6. ⏳ Test thoroughly
7. ⏳ Deploy

### Phase 2: Extract Constants & Validation (1 day)

1. Create `lib/constants.js`
2. Create `lib/config-validator.js`
3. Update index.js to use them
4. Test

### Phase 3: Add Structured Logging (1 day)

1. Create `lib/logger.js`
2. Replace all console.log() calls
3. Test log parsing

### Phase 4: Refactor Large Functions (2 days)

1. Break down `syncLegacyToVibe`
2. Extract parsers
3. Extract services
4. Add unit tests

### Phase 5: Add Retry Logic (1 day)

1. Create `lib/retry.js`
2. Wrap all API calls
3. Test with mock failures

---

## 📊 Database Benefits - Concrete Examples

### Example 1: Fast Queries
```javascript
// OLD (JSON): O(n) - iterate all projects
const activeProjects = allProjects.filter(p => p.issueCount > 0);

// NEW (SQLite): O(log n) - indexed query
const activeProjects = db.getActiveProjects();
```

### Example 2: Historical Tracking
```javascript
// See how many issues were synced in last 24 hours
const recentSyncs = db.getRecentSyncs(48); // Last 48 sync runs

recentSyncs.forEach(sync => {
  console.log(`${sync.started_at}: ${sync.issues_synced} issues, ${sync.duration_ms}ms`);
});
```

### Example 3: Analytics Dashboard
```javascript
const stats = db.getStats();
// {
//   totalProjects: 44,
//   activeProjects: 8,
//   emptyProjects: 36,
//   totalIssues: 342,
//   lastSync: '2025-01-27T10:30:00.000Z'
// }
```

### Example 4: Efficient Incremental Sync
```javascript
// OLD: Check every project
for (const project of allProjects) {
  const lastSync = state.projectTimestamps[project.id];
  const issues = await fetchIssues(project.id, lastSync);
}

// NEW: Only check projects that need it
const projectsToSync = db.getProjectsToSync(300000); // 5 min cache
for (const project of projectsToSync) {
  const issues = await fetchIssues(project.identifier, project.last_sync_at);
}
```

---

## 🎯 Quick Wins (Can Do Today)

### 1. Add Database (30 minutes)
```bash
cd /opt/stacks/vibe-sync
npm install better-sqlite3
# Integration code below
```

### 2. Add Config Validation (15 minutes)
Add to top of index.js after config definition

### 3. Extract Constants (15 minutes)
Create lib/constants.js and update references

---

## 📝 Next Steps

1. **Review this plan** - Do you agree with priorities?
2. **Start with database** - This is the foundation for everything else
3. **Test migration** - Run on dev first
4. **Monitor performance** - Compare before/after
5. **Iterate** - Tackle other issues one by one

**Question: Do you want me to:**
1. ✅ Integrate the database into index.js NOW?
2. Create the Dockerfile updates for better-sqlite3?
3. Write a migration script for existing JSON data?
4. Focus on a different issue first?

Let me know which direction you want to go!
