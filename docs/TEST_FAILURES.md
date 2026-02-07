# Test Failure Report

**Generated:** 2026-02-05
**Suite:** Vitest 3.x
**Total:** 2584 tests across 52 files
**Result:** 51 failed, 2528 passed, 5 skipped (1 file failed, 51 passed)

---

## Summary

All 51 failures originate from a **single root cause** in one test file. The Temporal workflow tests (3 files), which appeared to fail in the initial full-suite run, pass reliably when run individually — their failures were caused by Temporal test server startup race conditions under parallel execution load.

| File | Failed | Passed | Root Cause |
|------|--------|--------|------------|
| `tests/unit/SyncOrchestrator.test.js` | 51 | 10 | Missing `resolveGitUrl` mock |
| `tests/unit/TemporalOrchestration.test.ts` | 0* | 21 (5 skipped) | Temporal server race (intermittent) |
| `tests/unit/temporal/issue-sync.test.ts` | 0* | 25 | Temporal server race (intermittent) |
| `tests/unit/temporal/memory-update.test.ts` | 0* | 27 | Temporal server race (intermittent) |

\* These files fail intermittently during full-suite parallel runs but pass when run individually.

---

## Failure #1: Missing `resolveGitUrl` Mock (51 tests)

### Breaking Commit

```
a3c3413 feat(HVSYN-941): auto-populate git_url and add agent lookup API endpoints
```

This commit added `resolveGitUrl()` to `lib/textParsers.js` and called it from `lib/SyncOrchestrator.js:495` inside `processProject()`. The corresponding test file was **not updated** to include the new export in its `vi.mock()`.

### Error Message

```
Error: [vitest] No "resolveGitUrl" export is defined on the "../../lib/textParsers.js" mock.
Did you forget to return it from "vi.mock"?
```

### Where It Breaks

**Source:** `lib/SyncOrchestrator.js:495`
```js
const gitUrl = await resolveGitUrl(filesystemPath);
```

**Test mock** (`tests/unit/SyncOrchestrator.test.js:59-66`):
```js
vi.mock('../../lib/textParsers.js', () => ({
  extractHulyIdentifier: vi.fn(desc => {
    if (!desc) return null;
    const match = desc.match(/Huly Issue: (\w+-\d+)/);
    return match ? match[1] : null;
  }),
  determineGitRepoPath: vi.fn(() => '/home/user/project'),
  // MISSING: resolveGitUrl, cleanGitUrl, getGitUrl, validateGitRepoPath,
  //          extractHulyIdentifierFromDescription, extractFilesystemPath,
  //          parseProjectsFromText, parseIssuesFromText, parseIssueCount,
  //          extractFullDescription
}));
```

### Fix

Add `resolveGitUrl` (and ideally the other missing exports) to the mock:

```js
vi.mock('../../lib/textParsers.js', () => ({
  extractHulyIdentifier: vi.fn(desc => {
    if (!desc) return null;
    const match = desc.match(/Huly Issue: (\w+-\d+)/);
    return match ? match[1] : null;
  }),
  determineGitRepoPath: vi.fn(() => '/home/user/project'),
  resolveGitUrl: vi.fn().mockResolvedValue(null),     // <-- ADD THIS
  cleanGitUrl: vi.fn().mockReturnValue(null),          // <-- ADD THIS
}));
```

### All 51 Affected Tests

#### syncHulyToVibe - basic flow (6 failures)
| Line | Test Name |
|------|-----------|
| 263 | creates sync run and completes it on success |
| 270 | fetches Huly projects then Vibe projects |
| 277 | creates missing Vibe projects |
| 298 | processes projects sequentially by default |
| 315 | uses processBatch when parallel enabled |
| 333 | records sync stats on completion |

#### syncHulyToVibe - project filtering (3 failures)
| Line | Test Name |
|------|-----------|
| 349 | filters to specific projectId when provided |
| 372 | matches projectId by filesystem path in description |
| 385 | skips empty/unchanged projects when skipEmpty is true |

#### syncHulyToVibe - Phase 1 Huly->Vibe (10 failures)
| Line | Test Name |
|------|-----------|
| 421 | creates new Vibe task for unmatched Huly issue |
| 435 | upserts issue to database after creating task |
| 451 | does not upsert when createVibeTask returns null |
| 467 | updates existing task status on first sync when statuses differ |
| 483 | skips status update when statuses match |
| 502 | handles conflict (both changed) - Huly wins |
| 522 | updates when only Huly changed and statuses differ |
| 541 | does NOT update when only Vibe changed (not Huly) |
| 560 | updates description when Huly description changed |
| 591 | always upserts db record for existing task even without status change |

#### syncHulyToVibe - Phase 2 Vibe->Huly (7 failures)
| Line | Test Name |
|------|-----------|
| 629 | skips tasks updated in Phase 1 |
| 651 | skips tasks without Huly identifier |
| 666 | skips when Huly issue not found for identifier |
| 681 | updates Huly status when Vibe status differs |
| 700 | skips when Beads has more recent change (timestamp conflict) |
| 719 | upserts issue to database after successful status update |
| 735 | does not upsert when status update returns false |

#### syncHulyToVibe - Phase 3 Beads (6 failures)
| Line | Test Name |
|------|-----------|
| 769 | skips Beads sync when disabled |
| 777 | skips when no git repo path |
| 786 | initializes Beads in project directory |
| 802 | skips when Beads initialization fails |
| 812 | syncs issues to Beads and calls syncBeadsToGit |
| 833 | does NOT call syncBeadsToGit in dry run |

#### syncHulyToVibe - Phase 4 BookStack (8 failures)
| Line | Test Name |
|------|-----------|
| 862 | skips when BookStack disabled |
| 869 | skips when no filesystem path |
| 877 | calls bidirectional sync when configured |
| 893 | falls back to export+import when bidirectional fails |
| 910 | calls export-only when bidirectional not configured |
| 922 | calls import when importOnSync is true and bidirectional not configured |
| 933 | handles export failure gracefully |
| 941 | handles import failure gracefully |

#### syncHulyToVibe - Letta integration (5 failures)
| Line | Test Name |
|------|-----------|
| 949 | creates Letta agent when not exists |
| 958 | updates memory blocks for existing agent |
| 974 | skips Letta in dry run mode |
| 981 | handles Letta errors gracefully (non-fatal) |
| 991 | sets Letta sync timestamp after update |

#### syncHulyToVibe - bulk fetch (3 failures)
| Line | Test Name |
|------|-----------|
| 1006 | uses bulk fetch for multi-project sync |
| 1038 | falls back to individual fetch on bulk failure |
| 1057 | uses individual fetch for single project |

#### syncHulyToVibe - database (3 failures)
| Line | Test Name |
|------|-----------|
| 1074 | upserts project metadata with vibe_id |
| 1087 | updates project activity after sync |
| 1100 | queries last sync timestamp |

#### syncHulyToVibe - error handling (1 failure)
| Line | Test Name |
|------|-----------|
| 1117 | throws when fetchHulyIssues fails for a project |

**Note:** This last test has a different symptom — it expects an `'Issue fetch failed'` error but gets the `resolveGitUrl` mock error instead, since `resolveGitUrl` blows up before `fetchHulyIssues` is even called.

---

## Failure #2: Temporal Test Server Race Condition (Intermittent)

### Affected Files

- `tests/unit/TemporalOrchestration.test.ts` (26 tests, 5 skipped)
- `tests/unit/temporal/issue-sync.test.ts` (25 tests)
- `tests/unit/temporal/memory-update.test.ts` (27 tests)

### Error Message (when it occurs)

```
Error: Failed to start ephemeral server: No such file or directory (os error 2)
```

### Cause

These tests use `@temporalio/testing`'s `TestWorkflowEnvironment.createLocal()` which downloads and starts an ephemeral Temporal server binary. Under full-suite parallel execution (vitest runs with `maxThreads: 5`), multiple test files race to start their own ephemeral server instances simultaneously. This causes:

1. **Binary download contention** — Multiple threads try to download/extract the server binary at the same time
2. **Port conflicts** — Ephemeral servers need available ports; parallel starts can collide
3. **File system races** — The binary path may not exist when one thread checks while another is still extracting

### Evidence

All three files pass reliably when run individually:
```
tests/unit/temporal/issue-sync.test.ts      — 25 passed
tests/unit/temporal/memory-update.test.ts   — 27 passed
tests/unit/TemporalOrchestration.test.ts    — 21 passed, 5 skipped
```

### Fix Options

**Option A (Recommended): Serialize Temporal tests**

In `vitest.config.js`, add a `sequence` or `poolMatchGlobs` config to run Temporal tests in a single thread:

```js
test: {
  poolOptions: {
    threads: {
      // Run temporal tests sequentially in a single thread
      singleThread: true,
    }
  },
  // Or use the sequence option:
  sequence: {
    setupFiles: 'list',
  },
}
```

**Option B: Add a global setup that pre-downloads the binary**

Create a `tests/setup-temporal.ts` that calls `TestWorkflowEnvironment.createLocal()` once before any tests run, ensuring the binary is available.

**Option C: Add retry/skip logic to beforeAll**

```ts
let testEnv: TestWorkflowEnvironment;
beforeAll(async () => {
  try {
    testEnv = await TestWorkflowEnvironment.createLocal();
  } catch (err) {
    if (err.message?.includes('No such file or directory')) {
      console.warn('Temporal test server unavailable, skipping suite');
      return; // tests will check for testEnv and skip
    }
    throw err;
  }
}, 60000);
```

---

## Passing Tests (10 in SyncOrchestrator)

These tests pass because they hit code paths that return **before** reaching `resolveGitUrl()` at line 495:

| Line | Test Name | Why It Passes |
|------|-----------|---------------|
| 234 | passes dependencies through to syncHulyToVibe | Tests factory only, no sync call |
| 241 | passes lettaService and bookstackService to sync | Tests factory only, no sync call |
| 289 | skips project when Vibe project creation fails | Returns before processProject |
| 339 | throws and propagates error on failure | fetchHulyProjects throws before processProject |
| 405 | handles dry run with no projects to process | Empty project list, no processProject |
| 1112 | throws when fetchHulyProjects fails | fetchHulyProjects throws before processProject |
| 1125 | does not call completeSyncRun on error | fetchHulyProjects throws before processProject |
| + 3 more | (various createSyncOrchestrator tests) | Factory tests, no actual sync |

---

## Recommendations

### Immediate (unblocks CI)

1. **Add `resolveGitUrl` to the textParsers mock** in `SyncOrchestrator.test.js:59-66` — fixes all 51 failures
2. Consider using `importOriginal` pattern for safer mocking:
   ```js
   vi.mock('../../lib/textParsers.js', async (importOriginal) => {
     const actual = await importOriginal();
     return {
       ...actual,
       resolveGitUrl: vi.fn().mockResolvedValue(null),
       determineGitRepoPath: vi.fn(() => '/home/user/project'),
     };
   });
   ```

### Short-term (prevents recurrence)

3. **Add a lint rule or test** that verifies mock completeness — when a module gains new exports, the mock should be updated
4. **Isolate Temporal test execution** to prevent ephemeral server race conditions
5. **Add the test suite to pre-commit hooks** so breaking changes are caught before push

### Process

6. The breaking commit `a3c3413` modified both `lib/textParsers.js` (added export) and `lib/SyncOrchestrator.js` (added consumer) but did not update the test mock. Future PRs that add exports to mocked modules should include a checklist item to update all test mocks.
