# Critical Issues - Immediate Action Required

**Review Date:** 2025-11-03  
**Priority:** P0 (Production Blockers)

---

## Overview

This document details **critical issues** that must be resolved before production deployment. Each issue includes:
- Root cause analysis
- Impact assessment
- Concrete remediation steps
- Acceptance criteria

---

## Issue #1: No Automated Testing ❌ CRITICAL

### Severity: P0 - Production Blocker
### Impact: High Risk of Regression, Production Bugs

### Current State
- **0% automated test coverage**
- Manual test scripts exist (`test-*.js`) but are not automated
- No CI/CD quality gates
- Refactoring is dangerous without tests

### Root Cause
- Project prioritized feature delivery over test infrastructure
- No testing framework configured
- No test database setup

### Business Impact
```
Risk Level: CRITICAL
- Production bugs will go undetected
- Refactoring is unsafe → technical debt accumulates
- Onboarding new developers is difficult
- Regression bugs after every change
```

### Remediation Plan

#### Step 1: Set Up Testing Infrastructure (2 days)
```bash
# Install testing dependencies
npm install --save-dev vitest @vitest/ui c8

# Create test configuration
cat > vitest.config.js << 'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'c8',
      reporter: ['text', 'json', 'html'],
      exclude: ['test/**', 'migrations/**'],
    },
  },
});
EOF

# Add test scripts to package.json
npm pkg set scripts.test="vitest"
npm pkg set scripts.test:ui="vitest --ui"
npm pkg set scripts.test:coverage="vitest --coverage"
```

#### Step 2: Write Unit Tests (1 week)
```javascript
// tests/unit/statusMapper.test.js
import { describe, it, expect } from 'vitest';
import { mapHulyStatusToVibe, mapVibeStatusToHuly } from '../../index.js';

describe('Status Mapping', () => {
  describe('mapHulyStatusToVibe', () => {
    it('maps Backlog to todo', () => {
      expect(mapHulyStatusToVibe('Backlog')).toBe('todo');
    });
    
    it('maps In Progress to inprogress', () => {
      expect(mapHulyStatusToVibe('In Progress')).toBe('inprogress');
    });
    
    it('maps Done to done', () => {
      expect(mapHulyStatusToVibe('Done')).toBe('done');
    });
    
    it('defaults unknown status to todo', () => {
      expect(mapHulyStatusToVibe('Unknown Status')).toBe('todo');
    });
  });
  
  describe('mapVibeStatusToHuly', () => {
    it('maps todo to Backlog', () => {
      expect(mapVibeStatusToHuly('todo')).toBe('Backlog');
    });
    
    it('maps inprogress to In Progress', () => {
      expect(mapVibeStatusToHuly('inprogress')).toBe('In Progress');
    });
    
    it('maps done to Done', () => {
      expect(mapVibeStatusToHuly('done')).toBe('Done');
    });
  });
});

// tests/unit/database.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from '../../lib/database.js';
import fs from 'fs';

describe('Database', () => {
  let db;
  const testDbPath = './test-sync.db';
  
  beforeEach(() => {
    db = new Database(testDbPath);
  });
  
  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
  });
  
  describe('upsertProject', () => {
    it('inserts new project', () => {
      db.upsertProject({
        identifier: 'TEST',
        name: 'Test Project',
        huly_id: 'huly-123',
      });
      
      const project = db.getProject('TEST');
      expect(project).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.huly_id).toBe('huly-123');
    });
    
    it('updates existing project', () => {
      db.upsertProject({ identifier: 'TEST', name: 'Original' });
      db.upsertProject({ identifier: 'TEST', name: 'Updated' });
      
      const project = db.getProject('TEST');
      expect(project.name).toBe('Updated');
    });
  });
});
```

#### Step 3: Write Integration Tests (1 week)
```javascript
// tests/integration/sync.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { syncHulyToVibe } from '../../index.js';

// Mock clients
class MockHulyClient {
  constructor() {
    this.issues = [];
  }
  
  async listIssues() {
    return this.issues;
  }
  
  mockIssues(issues) {
    this.issues = issues;
  }
}

class MockVibeClient {
  constructor() {
    this.tasks = [];
  }
  
  async createTask(projectId, task) {
    const newTask = { id: this.tasks.length + 1, ...task };
    this.tasks.push(newTask);
    return newTask;
  }
  
  getTasks() {
    return this.tasks;
  }
}

describe('Sync Integration', () => {
  let hulyClient, vibeClient, db;
  
  beforeEach(() => {
    hulyClient = new MockHulyClient();
    vibeClient = new MockVibeClient();
    db = new Database(':memory:');
  });
  
  it('creates Vibe task for new Huly issue', async () => {
    hulyClient.mockIssues([
      {
        identifier: 'TEST-1',
        title: 'Test Issue',
        description: 'Test description',
        status: 'Backlog',
      }
    ]);
    
    await syncHulyToVibe(hulyClient, vibeClient, db, 'TEST');
    
    const tasks = vibeClient.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('TEST-1: Test Issue');
  });
});
```

#### Step 4: Add CI/CD Quality Gates (1 day)
```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run tests
        run: npm run test:coverage
      
      - name: Check coverage threshold
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 60" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 60% threshold"
            exit 1
          fi
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

### Acceptance Criteria
- [ ] Vitest configured and running
- [ ] Unit tests for all utility functions (60%+ coverage)
- [ ] Integration tests for sync flows (40%+ coverage)
- [ ] CI/CD pipeline runs tests on every PR
- [ ] Coverage threshold enforced (60% minimum)
- [ ] All tests passing

### Timeline: 2-3 weeks

---

## Issue #2: No Transactional Guarantees ❌ CRITICAL

### Severity: P0 - Data Integrity Risk
### Impact: Duplicate Tasks, Inconsistent State

### Current State
```javascript
// PROBLEM: These operations are not atomic
await createVibeTask(vibeClient, vibeProject.id, hulyIssue);  // Step 1
db.upsertIssue({ identifier, vibe_task_id: task.id });        // Step 2

// If Step 2 fails:
// - Vibe has the task
// - Database doesn't know about it
// - Next sync creates duplicate task
```

### Root Cause
- No distributed transaction support across HTTP APIs
- No idempotency keys in API calls
- No write-ahead log for recovery

### Business Impact
```
Risk Level: CRITICAL
- Duplicate tasks created in Vibe Kanban
- Inconsistent state between systems
- Manual cleanup required
- User confusion and lost trust
```

### Remediation Plan

#### Option 1: Idempotency Keys (Recommended)

```javascript
// Step 1: Add unique constraint in Vibe API
// Modify Vibe task creation to use external_id

async function createOrUpdateVibeTask(vibeClient, vibeProjectId, hulyIssue) {
  const taskData = {
    title: `${hulyIssue.identifier}: ${hulyIssue.title}`,
    description: buildDescription(hulyIssue),
    status: mapHulyStatusToVibe(hulyIssue.status),
    external_id: hulyIssue.identifier, // Unique constraint
  };
  
  try {
    // Try to create
    return await vibeClient.createTask(vibeProjectId, taskData);
  } catch (error) {
    if (error.code === 'DUPLICATE_EXTERNAL_ID') {
      // Task already exists, update instead
      const existingTask = await vibeClient.getTaskByExternalId(
        vibeProjectId,
        hulyIssue.identifier
      );
      return await vibeClient.updateTask(existingTask.id, taskData);
    }
    throw error;
  }
}
```

#### Option 2: Write-Ahead Log Pattern

```javascript
// lib/wal.js - Write-Ahead Log implementation
export class WriteAheadLog {
  constructor(db) {
    this.db = db;
    this.initSchema();
  }
  
  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wal_intents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        intent_type TEXT NOT NULL,
        payload JSON NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        completed_at INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_wal_status ON wal_intents(status);
    `);
  }
  
  createIntent(intentType, payload) {
    const stmt = this.db.prepare(`
      INSERT INTO wal_intents (intent_type, payload)
      VALUES (?, ?)
    `);
    const result = stmt.run(intentType, JSON.stringify(payload));
    return result.lastInsertRowid;
  }
  
  completeIntent(intentId, result) {
    this.db.prepare(`
      UPDATE wal_intents
      SET status = 'completed',
          completed_at = strftime('%s', 'now'),
          payload = json_patch(payload, ?)
      WHERE id = ?
    `).run(JSON.stringify({ result }), intentId);
  }
  
  failIntent(intentId, error) {
    this.db.prepare(`
      UPDATE wal_intents
      SET status = 'failed',
          error = ?
      WHERE id = ?
    `).run(error.message, intentId);
  }
  
  getPendingIntents() {
    return this.db.prepare(`
      SELECT * FROM wal_intents
      WHERE status = 'pending'
      ORDER BY created_at ASC
    `).all();
  }
  
  async replayPendingIntents(handlers) {
    const intents = this.getPendingIntents();
    
    for (const intent of intents) {
      const handler = handlers[intent.intent_type];
      if (!handler) {
        console.error(`No handler for intent type: ${intent.intent_type}`);
        continue;
      }
      
      try {
        const result = await handler(JSON.parse(intent.payload));
        this.completeIntent(intent.id, result);
      } catch (error) {
        this.failIntent(intent.id, error);
      }
    }
  }
}

// Usage in sync logic
const wal = new WriteAheadLog(db);

// 1. Write intent before action
const intentId = wal.createIntent('create_vibe_task', {
  projectId: vibeProject.id,
  hulyIssue,
});

try {
  // 2. Execute action
  const task = await createVibeTask(vibeClient, vibeProject.id, hulyIssue);
  
  // 3. Update database
  db.upsertIssue({
    identifier: hulyIssue.identifier,
    vibe_task_id: task.id,
  });
  
  // 4. Mark intent as completed
  wal.completeIntent(intentId, { taskId: task.id });
} catch (error) {
  wal.failIntent(intentId, error);
  throw error;
}

// On startup: replay incomplete intents
await wal.replayPendingIntents({
  create_vibe_task: async (payload) => {
    const task = await createVibeTask(vibeClient, payload.projectId, payload.hulyIssue);
    db.upsertIssue({
      identifier: payload.hulyIssue.identifier,
      vibe_task_id: task.id,
    });
    return { taskId: task.id };
  },
});
```

### Acceptance Criteria
- [ ] Idempotency implemented for all create operations
- [ ] WAL pattern implemented for critical operations
- [ ] Recovery mechanism tested (kill process mid-sync)
- [ ] No duplicate tasks created in stress tests
- [ ] Database state always consistent with external APIs

### Timeline: 1 week

---

## Issue #3: Swallowed Errors ❌ CRITICAL

### Severity: P0 - Silent Failures
### Impact: Data Loss, Undetected Failures

### Current State
```javascript
// Pattern appears 40+ times in codebase
try {
  const tasks = await vibeClient.listTasks(projectId);
  return tasks;
} catch (error) {
  console.error(`[Vibe] Error listing tasks:`, error.message);
  return []; // ⚠️ Caller doesn't know this failed
}
```

### Root Cause
- No error classification (transient vs permanent)
- No structured error types
- No error reporting to monitoring system
- Defensive programming taken too far

### Business Impact
```
Risk Level: CRITICAL
- Sync failures go unnoticed
- No alerts when systems are down
- Data loss without visibility
- Debugging is extremely difficult
```

### Remediation Plan

#### Step 1: Create Error Hierarchy
```javascript
// lib/errors/SyncError.js
export class SyncError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'SyncError';
    this.code = options.code || 'UNKNOWN_ERROR';
    this.retryable = options.retryable ?? false;
    this.context = options.context || {};
    this.cause = options.cause;
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
  
  static fromHttpError(error, context = {}) {
    const statusCode = error.response?.status || error.statusCode;
    const retryable = [408, 429, 500, 502, 503, 504].includes(statusCode);
    
    return new SyncError(
      `HTTP ${statusCode}: ${error.message}`,
      {
        code: `HTTP_${statusCode}`,
        retryable,
        context: { ...context, statusCode },
        cause: error,
      }
    );
  }
  
  static networkError(error, context = {}) {
    return new SyncError('Network error', {
      code: 'NETWORK_ERROR',
      retryable: true,
      context,
      cause: error,
    });
  }
  
  static timeout(operation, timeoutMs, context = {}) {
    return new SyncError(`Timeout after ${timeoutMs}ms: ${operation}`, {
      code: 'TIMEOUT',
      retryable: true,
      context: { ...context, operation, timeoutMs },
    });
  }
}

export class HulyError extends SyncError {
  constructor(message, options = {}) {
    super(message, { ...options, code: `HULY_${options.code || 'ERROR'}` });
    this.name = 'HulyError';
  }
}

export class VibeError extends SyncError {
  constructor(message, options = {}) {
    super(message, { ...options, code: `VIBE_${options.code || 'ERROR'}` });
    this.name = 'VibeError';
  }
}

export class LettaError extends SyncError {
  constructor(message, options = {}) {
    super(message, { ...options, code: `LETTA_${options.code || 'ERROR'}` });
    this.name = 'LettaError';
  }
}
```

#### Step 2: Implement Retry Logic
```javascript
// lib/utils/retry.js
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    onRetry = () => {},
  } = options;
  
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry if error is not retryable
      if (error.retryable === false) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelay * Math.pow(backoffFactor, attempt),
        maxDelay
      );
      
      onRetry({ attempt, delay, error });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}
```

#### Step 3: Update Error Handling
```javascript
// Before
try {
  const tasks = await vibeClient.listTasks(projectId);
  return tasks;
} catch (error) {
  console.error(`[Vibe] Error listing tasks:`, error.message);
  return [];
}

// After
import { VibeError } from './lib/errors/SyncError.js';
import { retryWithBackoff } from './lib/utils/retry.js';

try {
  const tasks = await retryWithBackoff(
    () => vibeClient.listTasks(projectId),
    {
      maxRetries: 3,
      onRetry: ({ attempt, delay, error }) => {
        logger.warn({
          component: 'vibe',
          operation: 'list_tasks',
          projectId,
          attempt,
          delay,
          error: error.message,
        }, 'Retrying list tasks');
      },
    }
  );
  return tasks;
} catch (error) {
  const vibeError = VibeError.fromHttpError(error, { projectId });
  
  logger.error({
    error: vibeError,
    stack: vibeError.stack,
  }, 'Failed to list Vibe tasks');
  
  // Report to monitoring
  metrics.syncErrors.inc({
    component: 'vibe',
    operation: 'list_tasks',
    error_code: vibeError.code,
    retryable: vibeError.retryable,
  });
  
  // Re-throw to let caller decide
  throw vibeError;
}
```

### Acceptance Criteria
- [ ] SyncError hierarchy implemented
- [ ] All errors classified as retryable or not
- [ ] Retry logic with exponential backoff
- [ ] All errors logged with full context
- [ ] Errors reported to metrics system
- [ ] No silent failures (all errors propagate or are explicitly handled)

### Timeline: 1 week

---

## Issue #4: No Type Safety ❌ CRITICAL

### Severity: P1 - Maintenance Risk
### Impact: Runtime Errors, Difficult Refactoring

### Current State
- No TypeScript
- No JSDoc annotations
- No type checking in CI/CD
- IDE autocomplete is limited

### Remediation Plan

#### Phase 1: Add JSDoc (1 week)
```javascript
/**
 * @typedef {Object} HulyIssue
 * @property {string} identifier - Issue identifier (e.g., "PROJ-123")
 * @property {string} title - Issue title
 * @property {string} description - Full description
 * @property {string} status - Current status
 * @property {string} priority - Priority level
 * @property {number} [modifiedAt] - Last modified timestamp (optional)
 */

/**
 * Create a task in Vibe Kanban from a Huly issue
 * @param {Object} vibeClient - Vibe API client
 * @param {number} vibeProjectId - Vibe project ID
 * @param {HulyIssue} hulyIssue - Source issue from Huly
 * @returns {Promise<Object|null>} Created task or null on failure
 */
async function createVibeTask(vibeClient, vibeProjectId, hulyIssue) {
  // ...
}
```

#### Phase 2: TypeScript Migration (2-3 weeks)
```typescript
// types/huly.ts
export interface HulyIssue {
  identifier: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  modifiedAt?: number;
}

export interface HulyProject {
  identifier: string;
  name: string;
  id: string;
}

// lib/HulyRestClient.ts
export class HulyRestClient {
  async listIssues(
    projectId: string,
    options?: { modifiedAfter?: number }
  ): Promise<HulyIssue[]> {
    // ...
  }
}
```

### Acceptance Criteria
- [ ] JSDoc annotations on all public functions
- [ ] Type checking in CI/CD
- [ ] TypeScript migration plan created
- [ ] No type errors in IDE

### Timeline: 1-2 weeks (JSDoc), 2-3 weeks (TypeScript)

---

## Summary

| Issue | Severity | Timeline | Dependencies |
|-------|----------|----------|--------------|
| No Automated Testing | P0 | 2-3 weeks | None |
| No Transactional Guarantees | P0 | 1 week | None |
| Swallowed Errors | P0 | 1 week | None |
| No Type Safety | P1 | 1-2 weeks | None |

**Total Estimated Effort:** 5-7 weeks

**Recommended Approach:** Tackle in parallel with 2-3 developers
- Developer 1: Testing infrastructure + unit tests
- Developer 2: Transactional guarantees + WAL
- Developer 3: Error handling + retry logic

**Next Steps:**
1. Review and approve this plan
2. Create GitHub issues for each item
3. Assign developers
4. Set up weekly progress reviews
5. Deploy to staging after each fix

