# Round 2: Monolith Splits — Detailed Changelog

## Overview

This document describes the second round of module decomposition for huly-vibe-sync.
Five large monolith files (700–1,300 lines each) were split into focused, single-responsibility
modules using the **facade pattern** — the original file becomes a thin wrapper that delegates
to new sub-modules, preserving all existing imports and test contracts.

**Key metrics:**
- 5 monolith files refactored
- 21 new focused modules created
- 0 test failures — all 2,530 tests pass (52 test files)
- 0 consumer-visible API changes — every import path still works
- Net code: ~200 lines of facade overhead added

---

## Item 1: HulyRestClient Split

**Before:** `lib/HulyRestClient.js` — 983 lines, 25 methods, single class
**After:** 5 sub-clients + thin facade (~65 lines)

### New Files

| File | Lines | Responsibility |
|------|-------|---------------|
| `lib/huly/HulyBaseClient.js` | ~180 | Shared HTTP helper: constructor (URL normalization, port 3458), `initialize()`, `healthCheck()`, `callTool()`, `getStats()` |
| `lib/huly/HulyProjectClient.js` | ~60 | `listProjects()`, `listComponents()`, `getProjectActivity()` |
| `lib/huly/HulyIssueClient.js` | ~350 | 13 methods: `listIssues`, `listIssuesBulk`, `getIssue`, `createIssue`, `updateIssue`, `patchIssue`, `deleteIssue`, `deleteIssuesBulk`, `getIssuesBulk`, `searchIssues`, `searchIssuesGlobal`, `moveIssue`, `updateIssueDueDate` |
| `lib/huly/HulyHierarchyClient.js` | ~100 | `getSubIssues()`, `createSubIssue()`, `getIssueTree()` |
| `lib/huly/HulyCommentsClient.js` | ~50 | `getComments()`, `createComment()` |

### Architecture

```
HulyRestClient (facade)
  ├── HulyBaseClient ← shared HTTP config (baseUrl, timeout, name)
  ├── HulyProjectClient → delegates to _base
  ├── HulyIssueClient → delegates to _base
  ├── HulyHierarchyClient → delegates to _base
  └── HulyCommentsClient → delegates to _base
```

Sub-clients receive `_base` (HulyBaseClient instance) in their constructor and use
`this._base.callTool(name, args)` for all HTTP calls. The facade exposes the same
public API via `...args` spread delegation:

```javascript
listProjects(...args) { return this._projects.listProjects(...args); }
```

### Consumer Impact
Zero. `createHulyRestClient()` returns facade with identical shape. Consumers:
`index.js`, `lib/HulyService.js`, tests.

### Test Results
97 tests pass (`tests/unit/HulyRestClient.test.js`)

---

## Item 2: ApiServer Extract

**Before:** `lib/ApiServer.js` — 702 lines, 3 embedded classes + route setup
**After:** 3 extracted classes + facade (~218 lines)

### New Files

| File | Lines | Responsibility |
|------|-------|---------------|
| `lib/api/SSEManager.js` | ~120 | `SSEManager` class: manages Server-Sent Events connections, broadcasting, heartbeat |
| `lib/api/SyncHistoryStore.js` | ~115 | `SyncHistoryStore` class: in-memory ring buffer for sync history entries |
| `lib/api/ConfigurationHandler.js` | ~200 | `ConfigurationHandler` class: handles `/api/config` GET/PUT routes |

### Architecture

```
ApiServer.js (facade)
  ├── imports SSEManager, sseManager singleton from api/SSEManager.js
  ├── imports SyncHistoryStore, syncHistory singleton from api/SyncHistoryStore.js
  ├── imports ConfigurationHandler from api/ConfigurationHandler.js
  ├── keeps: parseJsonBody, sendJson, sendError (used by deps + routes)
  ├── keeps: createApiServer, broadcastSyncEvent, recordIssueMapping
  └── re-exports: sseManager, syncHistory (backward compat)
```

**Key design decision:** `ConfigurationHandler` constructor was changed to accept a deps
object `{ sseManager, parseJsonBody, sendJson, sendError }` instead of using module-level
globals. This enables proper dependency injection and testability.

### Consumer Impact
Zero. `index.js` imports `createApiServer`, `broadcastSyncEvent`, `recordIssueMapping`
from `lib/ApiServer.js` — unchanged. Tests import `sseManager` and `syncHistory` singletons
from `lib/ApiServer.js` — still re-exported.

### Test Results
155 tests pass (`tests/unit/ApiServer.test.js`)

---

## Item 3: BeadsSyncService Split

**Before:** `lib/BeadsSyncService.js` — 1,195 lines, 6 exported functions + helpers
**After:** 6 focused modules + pure re-export facade (~23 lines)

### New Files

| File | Lines | Responsibility |
|------|-------|---------------|
| `lib/beads/BeadsMutexService.js` | ~55 | `acquireProjectMutex()` + per-project mutex map |
| `lib/beads/BeadsTitleMatcher.js` | ~95 | `normalizeTitleForComparison()`, `findMatchingIssueByTitle()`, `isValidProjectPath()`, `delay()`, `getOperationDelay()`, `getBatchDelay()` |
| `lib/beads/HulyToBeadsSync.js` | ~280 | `syncHulyIssueToBeads()` — one-way Huly→Beads sync for a single issue |
| `lib/beads/BeadsToHulySync.js` | ~280 | `syncBeadsIssueToHuly()` — one-way Beads→Huly sync for a single issue |
| `lib/beads/BeadsGitSync.js` | ~110 | `syncBeadsToGit()` — git commit/push for Beads changes |
| `lib/beads/BeadsBatchSync.js` | ~200 | `batchSyncHulyToBeads()`, `batchSyncBeadsToHuly()`, `fullBidirectionalSync()` |

### Architecture

```
BeadsSyncService.js (pure re-export facade)
  ├── re-exports from beads/BeadsMutexService.js
  ├── re-exports from beads/BeadsTitleMatcher.js
  ├── re-exports from beads/HulyToBeadsSync.js
  ├── re-exports from beads/BeadsToHulySync.js
  ├── re-exports from beads/BeadsGitSync.js
  └── re-exports from beads/BeadsBatchSync.js
```

This is the simplest facade — just `export { ... } from './beads/...'` statements.
No class, no constructor, no delegation logic needed.

### Dependency Graph

```
BeadsBatchSync → HulyToBeadsSync, BeadsToHulySync, BeadsGitSync
HulyToBeadsSync → BeadsMutexService, BeadsTitleMatcher
BeadsToHulySync → BeadsMutexService, BeadsTitleMatcher
All → BeadsService.js, BeadsDBReader.js, statusMapper.js (external)
```

### Consumer Impact
Zero. `lib/BeadsService.js` re-exports from `./BeadsSyncService.js` — facade re-exports
same names. Dynamic imports in tests also unchanged.

### Test Results
65 tests pass (`tests/unit/BeadsSyncService.test.js`)
116 tests pass (`tests/unit/BeadsService.test.js`)

---

## Item 4: CodePerceptionWatcher Split

**Before:** `lib/CodePerceptionWatcher.js` — 1,300 lines, 8 public + 13 private methods
**After:** 4 pipeline stages + facade (~370 lines)

### New Files

| File | Lines | Responsibility |
|------|-------|---------------|
| `lib/perception/FileUtils.js` | ~140 | Pure functions: `computeFileHash()`, `extractFileSummary()`, `detectLanguage()`, `getActiveProjectFiles()`, `shouldIgnoreDir()` |
| `lib/perception/FileChangeDetector.js` | ~210 | `watchProject()`, `unwatchProject()`, `handleChange()`, `trackBurst()`, `isInBurstMode()`, `scheduleProcessing()` |
| `lib/perception/ChangeProcessor.js` | ~195 | `processPendingChanges()` — the main pipeline: hash check → extract summary → upsert entities → create edges → AST processing |
| `lib/perception/ASTProcessor.js` | ~315 | `_processAstForFiles()`, `_handleDeletedFilesAst()`, `astInitialSync()` |

### Architecture — Composition with Shared State

Unlike the other splits which use simple delegation, CodePerceptionWatcher uses
**composition with shared state**. The facade instance (`this`) IS the shared state
object — it holds all Maps (watchers, graphitiClients, astCaches, pendingChanges,
fileHashes, debounceTimers, processing, burstMode, stats).

Sub-modules receive this state reference in their constructor:

```javascript
// In facade constructor:
this._detector = new FileChangeDetector(this, this.config);
this._processor = new ChangeProcessor(this, this.config);
this._astProcessor = new ASTProcessor(this, this.config);

// In sub-module:
class FileChangeDetector {
  constructor(state, config) {
    this._s = state; // Reference to facade instance
  }
  watchProject(id, path) {
    this._s.watchers.set(id, ...); // Mutates shared state
  }
}
```

This pattern is necessary because the sub-modules need to read/write shared state
(e.g., ChangeProcessor needs to check `this._s.processing` set, access
`this._s._detector.scheduleProcessing()`, and call
`this._s._astProcessor._processAstForFiles()`).

### Consumer Impact
Zero. `index.js` imports `CodePerceptionWatcher` — unchanged. Tests create
`new CodePerceptionWatcher(options)` — unchanged.

### Test Results
124 tests pass (`tests/unit/CodePerceptionWatcher.test.js`)

---

## Item 5: index.js Split

**Before:** `index.js` — 1,166 lines with MCPClient class, sync control closure,
event handlers, and scheduler setup all in one file
**After:** 4 extracted modules + thin orchestrator (~428 lines)

### New Files

| File | Lines | Responsibility |
|------|-------|---------------|
| `lib/MCPClient.js` | ~190 | `MCPClient` class (JSON-RPC over HTTP/SSE) + `parseIssuesFromText()` helper |
| `lib/SyncController.js` | ~210 | `createSyncController()` factory: per-project mutexes, debounced sync, `runSyncWithTimeout()`, `handleSyncTrigger()`, `handleConfigUpdate()` |
| `lib/EventHandlers.js` | ~240 | `createEventHandlers()` factory: `handleWebhookChanges()`, `handleBeadsChange()`, `handleVibeChange()`, `handleBookStackChange()` |
| `lib/SchedulerSetup.js` | ~100 | `setupScheduler()`: Temporal scheduled sync + reconciliation setup with legacy fallback |

### Architecture — Factory Functions with Context

The original `main()` function used closures extensively — all handlers referenced
`config`, `db`, `lettaService`, `fileWatcher`, etc. from the outer scope. Each
extracted module exports a factory function that receives a deps object:

```javascript
// lib/SyncController.js
export function createSyncController({
  config, healthStats, lettaService, fileWatcher,
  codePerceptionWatcher, astMemorySync, getTemporalOrchestration,
  getSyncTimer, setSyncTimer,
}) {
  // ... all sync logic
  return { runSyncWithTimeout, handleSyncTrigger, handleConfigUpdate };
}

// index.js (simplified)
const syncController = createSyncController({ config, healthStats, ... });
const eventHandlers = createEventHandlers({ db, temporalEnabled, ... });
```

### What Stayed in index.js

- Service initialization (config, db, Letta, FileWatcher, CodePerception, etc.)
- Temporal orchestration lazy-loading
- Temporal trigger imports (CJS require)
- `main()` function wiring: creates controller/handlers, starts watchers, calls scheduler
- Process entry point

### What Was Removed from index.js

- `MCPClient` class (→ `lib/MCPClient.js`)
- `parseIssuesFromText()` (→ `lib/MCPClient.js`)
- Sync mutex/debounce logic (→ `lib/SyncController.js`)
- All event handler functions (→ `lib/EventHandlers.js`)
- Scheduler setup code (→ `lib/SchedulerSetup.js`)
- Unused imports: `fetch`, `fs`, `http`, `Mutex`, `pDebounce`, and several
  Huly/Vibe service functions no longer used directly

### Consumer Impact
Zero. No other file imports from `index.js` (it's the entry point).

### Test Results
No dedicated tests for index.js. Full suite: 2,530 tests pass (52 files).

---

## Summary of All New Files

```
lib/
├── huly/                          (Item 1)
│   ├── HulyBaseClient.js
│   ├── HulyProjectClient.js
│   ├── HulyIssueClient.js
│   ├── HulyHierarchyClient.js
│   └── HulyCommentsClient.js
├── api/                           (Item 2)
│   ├── SSEManager.js
│   ├── SyncHistoryStore.js
│   └── ConfigurationHandler.js
├── beads/                         (Item 3)
│   ├── BeadsMutexService.js
│   ├── BeadsTitleMatcher.js
│   ├── HulyToBeadsSync.js
│   ├── BeadsToHulySync.js
│   ├── BeadsGitSync.js
│   └── BeadsBatchSync.js
├── perception/                    (Item 4)
│   ├── FileUtils.js
│   ├── FileChangeDetector.js
│   ├── ChangeProcessor.js
│   └── ASTProcessor.js
├── MCPClient.js                   (Item 5)
├── SyncController.js              (Item 5)
├── EventHandlers.js               (Item 5)
└── SchedulerSetup.js              (Item 5)
```

## Modified Files (Facades)

| File | Before | After | Pattern |
|------|--------|-------|---------|
| `lib/HulyRestClient.js` | 983 lines | ~65 lines | Class facade with `...args` delegation |
| `lib/ApiServer.js` | 702 lines | ~218 lines | Import + re-export facade |
| `lib/BeadsSyncService.js` | 1,195 lines | ~23 lines | Pure re-export facade |
| `lib/CodePerceptionWatcher.js` | 1,300 lines | ~370 lines | Composition with shared state |
| `index.js` | 1,166 lines | ~428 lines | Factory function wiring |

## Design Patterns Used

1. **Delegation facade** (HulyRestClient): Sub-clients hold reference to base client.
   Facade delegates each method call to the appropriate sub-client.

2. **Import/re-export facade** (ApiServer, BeadsSyncService): Original module imports
   from new sub-modules and re-exports their public API for backward compatibility.

3. **Composition with shared state** (CodePerceptionWatcher): Facade passes `this`
   as shared state to sub-modules. Sub-modules mutate shared Maps/Sets directly.

4. **Factory with context** (index.js → SyncController, EventHandlers): Extracted
   modules export factory functions that receive a deps object, returning focused
   handler objects.

## Verification

After each item:
- `npx vitest run` — full suite green (2,530 tests, 52 files)
- No import/export errors
- Zero consumer-visible API changes
