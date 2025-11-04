# Comprehensive Testing Strategy

**Date:** 2025-11-04  
**Current Coverage:** 85.41% statements, 79.83% branches  
**Current Tests:** 381 passing  
**Goal:** 95%+ coverage, 600+ tests, confidence for continuous development

---

## Executive Summary

### Current State
```
✅ Excellent:    Config, StatusMapper, TextParsers, Logger, HTTP
✅ Good:         VibeRestClient (95%), HulyRestClient (77%)
⚠️  Needs Work:  Database (67%), HulyService, VibeService, HealthService
❌ Missing:      SyncOrchestrator, LettaService (core business logic!)
```

### Priority Action Items
1. **Add SyncOrchestrator tests** - 0% coverage on 457-line core orchestration
2. **Add Service Layer tests** - HulyService, VibeService, HealthService, LettaService
3. **Add Integration tests** - Full sync cycle E2E
4. **Add Error scenario tests** - Transient failures, retries, edge cases

---

## Test Coverage Analysis

###Current Coverage by File

| File | Statements | Branches | Functions | Lines | Status |
|------|------------|----------|-----------|-------|--------|
| **statusMapper.js** | 100% | 100% | 100% | 100% | ✅ Perfect |
| **logger.js** | 100% | 67% | 100% | 100% | ✅ Excellent |
| **config.js** | 100% | 81% | 100% | 100% | ✅ Excellent |
| **textParsers.js** | 96% | 91% | 100% | 96% | ✅ Excellent |
| **VibeRestClient.js** | 95% | 92% | 100% | 95% | ✅ Good |
| **http.js** | 85% | 100% | 78% | 85% | ✅ Good |
| **HulyRestClient.js** | 77% | 61% | 69% | 81% | ⚠️ Needs Work |
| **database.js** | 67% | 69% | 79% | 66% | ⚠️ Needs Work |
| **HulyService.js** | 0% | 0% | 0% | 0% | ❌ Missing |
| **VibeService.js** | 0% | 0% | 0% | 0% | ❌ Missing |
| **SyncOrchestrator.js** | 0% | 0% | 0% | 0% | ❌ Missing |
| **HealthService.js** | 0% | 0% | 0% | 0% | ❌ Missing |
| **LettaService.js** | 0% | 0% | 0% | 0% | ❌ Missing |

### Gaps Analysis

**Critical Gaps (Block Development):**
- ❌ **SyncOrchestrator** - 457 lines of core sync logic untested
- ❌ **HulyService** - 279 lines of API wrapper untested
- ❌ **VibeService** - 228 lines of API wrapper untested
- ❌ **HealthService** - 289 lines of metrics/health untested

**Important Gaps (Risk to Stability):**
- ⚠️ **Database** - Letta integration methods (423-452, 545-610)
- ⚠️ **HulyRestClient** - Error handling paths (253-343)
- ⚠️ **LettaService** - 1,923 lines, zero tests!

---

## Testing Roadmap

### Phase 1: Critical Foundation (2-3 days)

#### 1.1 HulyService Tests
**File:** `tests/unit/HulyService.test.js`  
**Priority:** 🔴 Critical

```javascript
describe('HulyService', () => {
  describe('fetchHulyProjects', () => {
    it('should return projects from REST client');
    it('should handle empty project list');
    it('should handle API errors gracefully');
    it('should record API latency');
  });

  describe('fetchHulyIssues', () => {
    it('should fetch issues for project');
    it('should support incremental sync with lastSyncTime');
    it('should handle pagination');
    it('should record API latency');
    it('should handle network errors');
  });

  describe('updateHulyIssueStatus', () => {
    it('should update via REST client');
    it('should update via MCP client');
    it('should respect dry-run mode');
    it('should record API latency');
    it('should handle update failures');
  });

  describe('updateHulyIssueDescription', () => {
    it('should update via REST client');
    it('should update via MCP client');
    it('should respect dry-run mode');
    it('should record API latency');
  });
});
```

**Estimated:** 50-60 tests, 3-4 hours

#### 1.2 VibeService Tests
**File:** `tests/unit/VibeService.test.js`  
**Priority:** 🔴 Critical

```javascript
describe('VibeService', () => {
  describe('listVibeProjects', () => {
    it('should list projects from client');
    it('should handle empty list');
    it('should record API latency');
    it('should handle errors');
  });

  describe('createVibeProject', () => {
    it('should create project with git repo path');
    it('should handle existing repo');
    it('should respect dry-run mode');
    it('should record API latency');
    it('should handle creation failures');
  });

  describe('listVibeTasks', () => {
    it('should list tasks for project');
    it('should return empty array on error');
    it('should record API latency');
  });

  describe('createVibeTask', () => {
    it('should create task with Huly metadata');
    it('should map status correctly');
    it('should respect dry-run mode');
    it('should record API latency');
  });

  describe('updateVibeTaskStatus', () => {
    it('should update task status');
    it('should respect dry-run mode');
    it('should record API latency');
    it('should handle errors gracefully');
  });

  describe('updateVibeTaskDescription', () => {
    it('should update description');
    it('should respect dry-run mode');
    it('should record API latency');
  });
});
```

**Estimated:** 40-50 tests, 3-4 hours

#### 1.3 HealthService Tests
**File:** `tests/unit/HealthService.test.js`  
**Priority:** 🔴 Critical

```javascript
describe('HealthService', () => {
  describe('metrics registration', () => {
    it('should register all Prometheus metrics');
    it('should use correct metric types');
    it('should have proper labels');
  });

  describe('recordApiLatency', () => {
    it('should record huly API latency');
    it('should record vibe API latency');
    it('should handle different operations');
  });

  describe('recordSyncStats', () => {
    it('should update sync run counter');
    it('should record sync duration');
    it('should track projects and issues');
  });

  describe('initializeHealthStats', () => {
    it('should return default stats object');
  });

  describe('recordSuccessfulSync', () => {
    it('should update stats');
    it('should increment sync counter');
  });

  describe('recordFailedSync', () => {
    it('should update error count');
    it('should store last error');
  });
});
```

**Estimated:** 30-40 tests, 2-3 hours

#### 1.4 SyncOrchestrator Tests
**File:** `tests/unit/SyncOrchestrator.test.js`  
**Priority:** 🔴 Critical

```javascript
describe('SyncOrchestrator', () => {
  describe('syncHulyToVibe', () => {
    it('should sync projects from Huly to Vibe');
    it('should create missing Vibe projects');
    it('should create missing Vibe tasks');
    it('should update existing task statuses');
    it('should update existing task descriptions');
    it('should handle Phase 2 bidirectional sync');
    it('should skip empty projects when configured');
    it('should respect dry-run mode');
    it('should update Letta PM agent memory');
    it('should handle Letta errors gracefully');
    it('should record sync stats');
    it('should handle network errors');
    it('should handle partial failures');
  });

  describe('project filtering', () => {
    it('should skip projects with no changes');
    it('should skip empty projects');
    it('should process projects with new issues');
  });

  describe('bidirectional sync', () => {
    it('should sync Vibe changes back to Huly');
    it('should avoid sync loops');
    it('should handle conflicts (Huly wins)');
    it('should update descriptions if Huly changed');
    it('should update statuses if Vibe changed');
  });

  describe('error handling', () => {
    it('should continue on single project failure');
    it('should handle Huly API errors');
    it('should handle Vibe API errors');
    it('should handle database errors');
  });
});
```

**Estimated:** 80-100 tests, 6-8 hours

---

### Phase 2: Service Layer Completeness (1-2 days)

#### 2.1 LettaService Tests (High Value)
**File:** `tests/unit/LettaService.test.js`  
**Priority:** 🟡 Important

**Focus Areas:**
- Agent CRUD operations
- Memory block builders
- Folder/source management
- Error handling

**Estimated:** 100+ tests, 8-10 hours

#### 2.2 Complete Database Coverage
**File:** `tests/unit/database.test.js` (extend existing)  
**Priority:** 🟡 Important

**Add Tests For:**
- Letta integration methods (lines 423-452)
- Sync state queries (lines 545-553)
- Project summary methods (lines 575-610)

**Estimated:** 20-30 tests, 2-3 hours

#### 2.3 Complete HulyRestClient Coverage
**File:** `tests/unit/HulyRestClient.test.js` (extend existing)  
**Priority:** 🟡 Important

**Add Tests For:**
- Error handling paths (253-267, 319-343)
- Timeout scenarios
- Retry logic (if added in PR 2)

**Estimated:** 15-20 tests, 2 hours

---

### Phase 3: Integration & E2E (1 day)

#### 3.1 Full Sync Cycle Integration Test
**File:** `tests/integration/fullSyncCycle.test.js`  
**Priority:** 🔴 Critical

```javascript
describe('Full Sync Cycle Integration', () => {
  it('should complete full sync with mock APIs', async () => {
    // Setup mock Huly with projects and issues
    // Setup mock Vibe with projects
    // Run syncHulyToVibe
    // Verify all projects created
    // Verify all issues synced
    // Verify database state
    // Verify metrics recorded
  });

  it('should handle incremental sync correctly');
  it('should handle bidirectional sync');
  it('should update Letta agent memory');
  it('should skip unchanged projects');
  it('should handle API failures gracefully');
});
```

**Estimated:** 10-15 tests, 4-5 hours

#### 3.2 Error Scenario Integration Tests
**File:** `tests/integration/errorScenarios.test.js`  
**Priority:** 🟡 Important

```javascript
describe('Error Scenarios', () => {
  it('should handle Huly API timeout');
  it('should handle Vibe API 500 error');
  it('should handle database lock');
  it('should handle network disconnection');
  it('should handle partial sync completion');
  it('should recover from transient errors');
});
```

**Estimated:** 10-12 tests, 3-4 hours

---

### Phase 4: Confidence Boosters (Optional)

#### 4.1 API Latency Instrumentation Tests
**File:** `tests/unit/apiLatency.test.js`

- Verify latency recorded on success
- Verify latency recorded on error
- Verify operation names correct
- Verify histogram buckets

**Estimated:** 15-20 tests, 2 hours

#### 4.2 Performance Regression Tests
**File:** `tests/performance/regression.test.js`

- Sync duration thresholds
- Memory usage limits
- Database query performance
- API call counts

**Estimated:** 10-15 tests, 2-3 hours

#### 4.3 Mutation Testing Setup
**Tool:** Stryker Mutator

```bash
npm install --save-dev @stryker-mutator/core @stryker-mutator/vitest-runner
```

Mutation testing ensures tests actually catch bugs by:
- Changing code (mutations)
- Running tests
- Failing if tests still pass (weak tests)

**Estimated:** Setup 2-3 hours, analysis ongoing

---

## Testing Best Practices

### 1. Test Structure (AAA Pattern)

```javascript
describe('Feature', () => {
  it('should do something when condition', () => {
    // Arrange - Setup test data and mocks
    const mockClient = { fetch: vi.fn() };
    
    // Act - Execute the code under test
    const result = await functionUnderTest(mockClient);
    
    // Assert - Verify the outcome
    expect(result).toEqual(expectedValue);
    expect(mockClient.fetch).toHaveBeenCalledWith(expectedArgs);
  });
});
```

### 2. Mock Strategy

**Use Real Implementations For:**
- Pure functions (statusMapper, textParsers)
- Database (SQLite in-memory)
- Logger (can capture output)

**Mock For:**
- External APIs (Huly, Vibe, Letta)
- File system operations
- Network calls
- Time-dependent operations

### 3. Test Data Management

```javascript
// tests/__fixtures__/testData.js
export const mockHulyProject = {
  identifier: 'TEST',
  name: 'Test Project',
  description: 'Test description',
  status: 'active'
};

export const mockHulyIssue = {
  identifier: 'TEST-1',
  title: 'Test Issue',
  description: 'Issue description',
  status: 'Todo'
};
```

### 4. Async Testing

```javascript
// Good - wait for promises
it('should fetch data', async () => {
  const result = await fetchData();
  expect(result).toBeDefined();
});

// Good - use done callback for events
it('should emit event', (done) => {
  emitter.on('data', (data) => {
    expect(data).toBeDefined();
    done();
  });
});
```

### 5. Error Testing

```javascript
it('should throw error on invalid input', async () => {
  await expect(functionUnderTest(null))
    .rejects
    .toThrow('Expected error message');
});
```

---

## Coverage Goals

### Target Coverage
```
Statements:   95%+  (currently 85%)
Branches:     90%+  (currently 80%)
Functions:    95%+  (currently 88%)
Lines:        95%+  (currently 86%)
```

### Per-File Targets
```
Core Business Logic:     100% (SyncOrchestrator, Services)
Database Operations:     95%
API Clients:            90%
Utilities:              100%
Configuration:          100%
```

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [18.x, 20.x]
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run type check
        run: npm run type-check
      
      - name: Run unit tests
        run: npm run test:unit
      
      - name: Run integration tests
        run: npm run test:integration
      
      - name: Run performance benchmarks
        run: npm run test:performance
      
      - name: Generate coverage report
        run: npm run test:coverage
      
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/coverage-final.json
          fail_ci_if_error: true
      
      - name: Check coverage thresholds
        run: |
          npm run test:coverage -- --thresholds.statements=95 \
                                   --thresholds.branches=90 \
                                   --thresholds.functions=95 \
                                   --thresholds.lines=95
```

### Pre-commit Hooks

```bash
# .husky/pre-commit
#!/bin/sh
npm run lint
npm run type-check
npm run test:unit
```

---

## Test Execution Commands

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test tests/unit/HulyService.test.js

# Run tests in watch mode
npm test -- --watch

# Run tests with specific pattern
npm test -- --grep="HulyService"

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run performance benchmarks
npm run test:performance

# Generate HTML coverage report
npm run test:coverage && npx vite preview --outDir coverage

# Type check without running tests
npm run type-check
```

---

## Success Metrics

### Phase 1 Complete (Critical Foundation)
- ✅ 95%+ coverage on HulyService, VibeService, HealthService
- ✅ 90%+ coverage on SyncOrchestrator
- ✅ 500+ total tests passing
- ✅ All critical paths tested

### Phase 2 Complete (Service Completeness)
- ✅ 80%+ coverage on LettaService
- ✅ 95%+ coverage on Database
- ✅ 90%+ coverage on all REST clients
- ✅ 600+ total tests passing

### Phase 3 Complete (Integration)
- ✅ Full sync cycle integration test
- ✅ Error scenario coverage
- ✅ E2E confidence
- ✅ 650+ total tests passing

### Production Ready
- ✅ 95%+ overall coverage
- ✅ All critical paths tested
- ✅ Integration tests passing
- ✅ Performance benchmarks passing
- ✅ CI/CD pipeline green
- ✅ Mutation testing score >80%

---

## Estimated Timeline

| Phase | Tasks | Tests | Hours | Days |
|-------|-------|-------|-------|------|
| Phase 1 | HulyService, VibeService, HealthService, SyncOrchestrator | +180 | 18-22 | 2-3 |
| Phase 2 | LettaService, Database, HulyRestClient | +135 | 12-15 | 1-2 |
| Phase 3 | Integration, Error Scenarios | +25 | 7-9 | 1 |
| Phase 4 | API Latency, Performance, Mutation | +40 | 6-8 | 1 |
| **Total** | **All Tests** | **+380** | **43-54** | **5-7** |

**Target:** 381 current + 380 new = **761 total tests**

---

## Recommendations

### Immediate Next Steps (Choose One)

**Option A: Full Test Suite (5-7 days)**
- Complete all 3 phases
- Achieve 95%+ coverage
- Maximum confidence for development
- **Recommended if:** Building for production, long-term project

**Option B: Critical Tests Only (2-3 days)**
- Phase 1 only (Services + SyncOrchestrator)
- Achieve 90%+ coverage on critical paths
- Good confidence for continued development
- **Recommended if:** Need to start PR 2 soon, time-constrained

**Option C: Test-Driven PR 2 (Hybrid Approach)**
- Write tests for new code as you implement PR 2
- Add service tests incrementally
- Learn TDD patterns
- **Recommended if:** Want to improve skills, prefer incremental progress

### Long-Term Testing Culture

1. **Test-First Development**
   - Write tests before implementing features
   - Red → Green → Refactor cycle

2. **Code Review Checklist**
   - Tests included for new code?
   - Coverage maintained or improved?
   - Integration tests added if needed?

3. **Continuous Monitoring**
   - Track coverage trends
   - Monitor test execution time
   - Review mutation testing scores

---

## Conclusion

Current test suite is **good but incomplete**. The main gaps are:

1. **SyncOrchestrator** - Core business logic untested (457 lines)
2. **Service Layer** - HulyService, VibeService, HealthService untested
3. **LettaService** - Largest file (1,923 lines) with zero tests

Completing Phase 1 (2-3 days) will give you **solid confidence** for continued development. Completing all phases (5-7 days) will give you **maximum confidence** for production deployment.

**Recommendation:** Start with Phase 1, then decide based on your timeline and confidence level whether to continue with Phases 2-3 or move on to PR 2.
