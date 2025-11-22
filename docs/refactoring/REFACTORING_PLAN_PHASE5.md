# Refactoring Plan Phase 5 - Service Layer Extraction

**Date:** November 3, 2025  
**Current State:** 316 tests passing, 87.97% coverage, VibeRestClient deployed  
**Goal:** Extract service layers from index.js with full test coverage

---

## Current State

### Completed Phases
- ✅ **Phase 1-3:** Database integration, mock factories, tests (Complete)
- ✅ **Phase 4:** VibeRestClient implementation (Complete - 100% coverage)

### File Sizes
```
index.js:           1,589 lines (26 functions) ← TOO LARGE
LettaService.js:    1,923 lines (focused, acceptable)
database.js:          574 lines (good)
VibeRestClient.js:    538 lines (good, 100% coverage)
HulyRestClient.js:    344 lines (good)
textParsers.js:       233 lines (good)
http.js:               82 lines (good)
statusMapper.js:       82 lines (good)
```

### Functions in index.js (26)
Grouped by responsibility:
1. **Utilities (6):** withTimeout, formatDuration, parseProjectsFromText, parseIssuesFromText, extractFilesystemPath, getGitUrl
2. **Status Mapping (2):** mapHulyStatusToVibe, mapVibeStatusToHuly  
3. **Parsing (3):** extractFullDescription, extractHulyIdentifier, determineGitRepoPath
4. **Huly Operations (4):** fetchHulyProjects, fetchHulyIssues, updateHulyIssueStatus, updateHulyIssueDescription
5. **Vibe Operations (6):** listVibeProjects, createVibeProject, listVibeTasks, createVibeTask, updateVibeTaskStatus, updateVibeTaskDescription
6. **Sync Logic (3):** syncVibeTaskToHuly, syncHulyToVibe, processBatch
7. **Infrastructure (2):** startHealthServer, main

---

## Refactoring Strategy

### Principle: Test-Driven Refactoring
With 316 tests passing, we can refactor confidently:
1. **Extract code** to new modules
2. **Run tests** - they should pass without changes
3. **Refactor incrementally** - small steps
4. **No new tests required** - existing tests validate behavior

---

## Phase 5A: Extract Utilities (SAFEST - Do First)

### Create `lib/utils.js`

**Functions to move:**
```javascript
export async function withTimeout(promise, timeoutMs, operation) { /* ... */ }
export function formatDuration(ms) { /* ... */ }
export async function processBatch(items, batchSize, processFunction) { /* ... */ }
```

**Benefits:**
- Reusable across all modules
- Already pure functions (easy to move)
- No dependencies on index.js state

**Testing:**
- ✅ All 316 tests should pass unchanged
- No new tests needed (behavior unchanged)

**Estimated reduction:** ~80 lines from index.js

---

## Phase 5B: Consolidate Parsers (SAFE)

### Option 1: Enhance `lib/textParsers.js`
### Option 2: Create new `lib/parsers.js`

**Recommendation:** Enhance existing `textParsers.js`

**Functions to move:**
```javascript
// Already in textParsers.js:
export function extractFilesystemPath(description) { /* ... */ }
export function extractUrlsFromText(text) { /* ... */ }

// ADD from index.js:
export function parseProjectsFromText(text) { /* ... */ }
export function parseIssuesFromText(text, projectId) { /* ... */ }
export function extractFullDescription(detailText) { /* ... */ }
export function extractHulyIdentifier(description) { /* ... */ }
export function getGitUrl(repoPath) { /* ... */ }
```

**Clean up:**
- Remove duplicate `extractFilesystemPath` from index.js (already in textParsers.js:69-80)

**Benefits:**
- All parsing logic in one place
- Eliminates duplication
- Better organization

**Testing:**
- ✅ textParsers.test.js already has 42 tests (97.46% coverage)
- ✅ All 316 tests should pass unchanged

**Estimated reduction:** ~150 lines from index.js

---

## Phase 5C: Extract Status Mapping (SAFE)

### Enhance `lib/statusMapper.js`

**Currently in statusMapper.js:**
```javascript
export function mapVibeToHuly(vibeStatus) { /* ... */ }
export function normalizeStatus(status) { /* ... */ }
export function areStatusesEquivalent(status1, status2) { /* ... */ }
```

**ADD from index.js:**
```javascript
export function mapHulyStatusToVibe(hulyStatus) { /* ... */ }
export function mapVibeStatusToHuly(vibeStatus) { /* ... */ }
```

**Clean up:**
- Consolidate `mapVibeToHuly` and `mapVibeStatusToHuly` (they do the same thing)
- Rename for clarity: `mapVibeToHuly` → `mapVibeStatusToHuly`

**Benefits:**
- All status mapping in one place
- Consistent naming
- Better tested (statusMapper already has 26 tests, 100% coverage)

**Testing:**
- ✅ statusMapper.test.js already has 26 tests (100% coverage)
- ✅ All 316 tests should pass unchanged

**Estimated reduction:** ~40 lines from index.js

---

## Phase 5D: Create Service Layer (MODERATE RISK)

### Create `lib/services/HulyService.js`

**Purpose:** High-level Huly operations (wraps HulyRestClient)

**Structure:**
```javascript
export class HulyService {
  constructor(client, config) {
    this.client = client;
    this.config = config;
  }

  async fetchProjects() {
    // Move fetchHulyProjects() logic here
  }

  async fetchIssues(projectIdentifier, lastSyncTime = null) {
    // Move fetchHulyIssues() logic here
  }

  async updateIssueStatus(issueIdentifier, status) {
    // Move updateHulyIssueStatus() logic here
  }

  async updateIssueDescription(issueIdentifier, description) {
    // Move updateHulyIssueDescription() logic here
  }
}

export function createHulyService(client, config) {
  return new HulyService(client, config);
}
```

**Dependencies:**
- `HulyRestClient` (already exists)
- `textParsers` (for parsing responses)
- Config object

**Testing:**
- ✅ HulyRestClient.test.js already tests API calls (42 tests)
- ✅ Service layer just orchestrates existing tested functions
- ✅ All 316 tests should pass unchanged

**Estimated reduction:** ~200 lines from index.js

---

### Create `lib/services/VibeService.js`

**Purpose:** High-level Vibe operations (wraps VibeRestClient)

**Structure:**
```javascript
export class VibeService {
  constructor(client, statusMapper, stacksDir, config) {
    this.client = client;
    this.statusMapper = statusMapper;
    this.stacksDir = stacksDir;
    this.config = config;
  }

  async listProjects() {
    // Move listVibeProjects() logic here
  }

  async createProject(hulyProject) {
    // Move createVibeProject() logic here
    // Include determineGitRepoPath logic
  }

  async listTasks(projectId) {
    // Move listVibeTasks() logic here
  }

  async createTask(vibeProjectId, hulyIssue) {
    // Move createVibeTask() logic here
  }

  async updateTaskStatus(taskId, status) {
    // Move updateVibeTaskStatus() logic here
  }

  async updateTaskDescription(taskId, description) {
    // Move updateVibeTaskDescription() logic here
  }
}

export function createVibeService(client, statusMapper, stacksDir, config) {
  return new VibeService(client, statusMapper, stacksDir, config);
}
```

**Dependencies:**
- `VibeRestClient` (already exists, 100% coverage)
- `statusMapper` (already exists, 100% coverage)
- Config object

**Testing:**
- ✅ VibeRestClient.test.js already tests API calls (65 tests, 100% coverage)
- ✅ Service layer just orchestrates existing tested functions
- ✅ All 316 tests should pass unchanged

**Estimated reduction:** ~250 lines from index.js

---

## Phase 5E: Extract Sync Orchestration (HIGHER RISK - Do Last)

### Create `lib/services/SyncOrchestrator.js`

**Purpose:** Orchestrates bidirectional sync

**Structure:**
```javascript
export class SyncOrchestrator {
  constructor(hulyService, vibeService, db, lettaService, statusMapper, config) {
    this.hulyService = hulyService;
    this.vibeService = vibeService;
    this.db = db;
    this.lettaService = lettaService;
    this.statusMapper = statusMapper;
    this.config = config;
  }

  async performSync() {
    // Move main syncHulyToVibe() logic here
    const syncId = this.db.startSyncRun();
    
    try {
      const hulyProjects = await this.hulyService.fetchProjects();
      const vibeProjects = await this.vibeService.listProjects();
      
      // ... orchestration logic ...
      
      this.db.completeSyncRun(syncId, stats);
      return stats;
    } catch (error) {
      this.db.completeSyncRun(syncId, { error: error.message });
      throw error;
    }
  }

  async syncTaskToHuly(vibeTask, hulyIssues, projectIdentifier, phase1UpdatedTasks) {
    // Move syncVibeTaskToHuly() logic here
  }

  async processProject(hulyProject, vibeProject) {
    // Extract project processing logic
  }
}

export function createSyncOrchestrator(hulyService, vibeService, db, lettaService, statusMapper, config) {
  return new SyncOrchestrator(hulyService, vibeService, db, lettaService, statusMapper, config);
}
```

**Dependencies:**
- `HulyService` (created in Phase 5D)
- `VibeService` (created in Phase 5D)
- `database` (already exists)
- `LettaService` (already exists)
- `statusMapper` (already exists)

**Testing:**
- ✅ sync.test.js already tests sync flows (16 tests)
- ✅ All underlying services already tested
- ✅ All 316 tests should pass unchanged

**Estimated reduction:** ~400 lines from index.js

---

## Phase 5F: Extract Configuration (SAFE)

### Create `lib/config.js`

**Purpose:** Centralize configuration with validation

**Structure:**
```javascript
export class Config {
  constructor(env = process.env) {
    this.huly = this.parseHulyConfig(env);
    this.vibeKanban = this.parseVibeConfig(env);
    this.sync = this.parseSyncConfig(env);
    this.stacks = this.parseStacksConfig(env);
    this.letta = this.parseLettaConfig(env);
    this.validate();
  }

  parseHulyConfig(env) {
    return {
      apiUrl: env.HULY_API_URL || env.HULY_MCP_URL || 'http://192.168.50.90:3457/api',
      useRestApi: env.HULY_USE_REST !== 'false',
    };
  }

  parseSyncConfig(env) {
    const interval = parseInt(env.SYNC_INTERVAL || '300000');
    const maxWorkers = parseInt(env.MAX_WORKERS || '5');
    
    if (isNaN(interval) || interval < 0) {
      throw new Error('SYNC_INTERVAL must be a positive number');
    }
    if (maxWorkers < 1 || maxWorkers > 50) {
      throw new Error('MAX_WORKERS must be between 1 and 50');
    }
    
    return {
      interval,
      dryRun: env.DRY_RUN === 'true',
      incremental: env.INCREMENTAL_SYNC !== 'false',
      parallel: env.PARALLEL_SYNC === 'true',
      maxWorkers,
      skipEmpty: env.SKIP_EMPTY_PROJECTS === 'true',
      apiDelay: parseInt(env.API_DELAY || '10'),
    };
  }

  validate() {
    const required = [
      ['HULY_API_URL', this.huly.apiUrl],
      ['VIBE_API_URL', this.vibeKanban.apiUrl],
    ];
    
    const missing = required.filter(([name, value]) => !value);
    if (missing.length > 0) {
      throw new Error(`Missing required config: ${missing.map(([name]) => name).join(', ')}`);
    }
  }

  toJSON() {
    return {
      hulyApi: this.huly.apiUrl,
      hulyMode: this.huly.useRestApi ? 'REST API' : 'MCP',
      vibeApi: this.vibeKanban.apiUrl,
      vibeMode: this.vibeKanban.useRestApi ? 'REST API' : 'MCP',
      stacksDir: this.stacks.baseDir,
      syncInterval: `${this.sync.interval/1000}s`,
      incrementalSync: this.sync.incremental,
      parallelProcessing: this.sync.parallel,
      maxWorkers: this.sync.maxWorkers,
      skipEmptyProjects: this.sync.skipEmpty,
      dryRun: this.sync.dryRun,
    };
  }
}

export function createConfig(env = process.env) {
  return new Config(env);
}
```

**Benefits:**
- Input validation
- Type safety
- Clear error messages
- Easy to test

**Testing:**
- Create `tests/unit/config.test.js` (NEW - ~15 tests)
- Test validation, parsing, defaults

**Estimated reduction:** ~60 lines from index.js

---

## Expected Results

### Before Phase 5
```
index.js:     1,589 lines (26 functions)
Total tests:    316
Coverage:    87.97%
```

### After Phase 5
```
index.js:           ~400 lines (main, health server, initialization)
lib/utils.js:       ~100 lines (NEW)
lib/textParsers.js: ~350 lines (ENHANCED)
lib/statusMapper.js: ~120 lines (ENHANCED)
lib/config.js:       ~120 lines (NEW)
lib/services/
  HulyService.js:    ~250 lines (NEW)
  VibeService.js:    ~300 lines (NEW)
  SyncOrchestrator.js: ~500 lines (NEW)

Total tests:    331+ (add ~15 for config)
Coverage:    88%+ (maintain or improve)
```

**Net result:**
- index.js: 1,589 → 400 lines (-75%)
- Better organization
- Easier to maintain
- Same or better test coverage

---

## Implementation Order (Recommended)

### Step 1: Utilities (20 mins) ✅ SAFEST
```bash
1. Create lib/utils.js
2. Move withTimeout, formatDuration, processBatch
3. Update imports in index.js
4. Run: npm test
5. Verify: All 316 tests pass
```

### Step 2: Parsers (30 mins) ✅ SAFE
```bash
1. Enhance lib/textParsers.js
2. Move parsing functions from index.js
3. Remove duplicate extractFilesystemPath
4. Update imports in index.js
5. Run: npm test
6. Verify: All 316 tests pass
```

### Step 3: Status Mapping (15 mins) ✅ SAFE
```bash
1. Enhance lib/statusMapper.js
2. Move status functions from index.js
3. Consolidate duplicates
4. Update imports in index.js
5. Run: npm test
6. Verify: All 316 tests pass
```

### Step 4: Configuration (30 mins) ✅ SAFE
```bash
1. Create lib/config.js with validation
2. Create tests/unit/config.test.js
3. Replace config object in index.js
4. Run: npm test
5. Verify: All tests pass (331+ total)
```

### Step 5: HulyService (45 mins) ⚠️ MODERATE
```bash
1. Create lib/services/HulyService.js
2. Move Huly operations from index.js
3. Update index.js to use service
4. Run: npm test
5. Verify: All tests pass
```

### Step 6: VibeService (45 mins) ⚠️ MODERATE
```bash
1. Create lib/services/VibeService.js
2. Move Vibe operations from index.js
3. Update index.js to use service
4. Run: npm test
5. Verify: All tests pass
```

### Step 7: SyncOrchestrator (60 mins) ⚠️ HIGHER RISK
```bash
1. Create lib/services/SyncOrchestrator.js
2. Move sync logic from index.js
3. Refactor main() to use orchestrator
4. Run: npm test
5. Verify: All tests pass
6. Test end-to-end sync
```

---

## Safety Net

### After Each Step
1. **Run all tests:** `npm test`
2. **Check coverage:** `npm test -- --coverage`
3. **If tests fail:** `git reset --hard HEAD` and retry

### Git Strategy
```bash
# Create branch for refactoring
git checkout -b refactor/service-layer

# Commit after each successful step
git add -A
git commit -m "refactor: extract utilities to lib/utils.js"
git commit -m "refactor: consolidate parsers in lib/textParsers.js"
git commit -m "refactor: enhance lib/statusMapper.js"
# ... etc
```

### Rollback Plan
```bash
# If something goes wrong
git reset --hard origin/main

# Or revert specific commit
git revert <commit-hash>
```

---

## Success Criteria

- ✅ All 316+ tests pass
- ✅ Coverage maintained at 87.97%+
- ✅ index.js reduced to ~400 lines
- ✅ Clear separation of concerns
- ✅ Service still syncs correctly
- ✅ No performance regression

---

## Timeline Estimate

- **Step 1-3:** 1-1.5 hours (utilities, parsers, status)
- **Step 4:** 30 minutes (config)
- **Step 5-6:** 1.5-2 hours (services)
- **Step 7:** 1-1.5 hours (orchestrator)
- **Total:** 4-5 hours

---

## Risk Assessment

| Phase | Risk Level | Mitigation |
|-------|-----------|------------|
| Utilities | 🟢 Low | Pure functions, easy to move |
| Parsers | 🟢 Low | Already have tests, clear boundaries |
| Status Mapping | 🟢 Low | 100% coverage, simple functions |
| Configuration | 🟢 Low | New module, add tests first |
| Services | 🟡 Medium | Many call sites to update, test after each |
| Orchestrator | 🟠 Higher | Complex logic, do last, test thoroughly |

---

## Benefits

### Immediate
- ✅ Smaller, more focused files
- ✅ Easier to navigate
- ✅ Better IDE support

### Short-term
- ✅ Easier to add features
- ✅ Faster onboarding for new developers
- ✅ Better test isolation

### Long-term
- ✅ More maintainable
- ✅ Easier to extend (new sync sources)
- ✅ Better architecture for scaling

---

## Decision Point

**Which phase should we start with?**

**Recommendation:** Start with **Step 1 (Utilities)** - safest, quickest win, builds confidence.

Would you like me to proceed with Step 1?
