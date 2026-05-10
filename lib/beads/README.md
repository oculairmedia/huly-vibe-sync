# Beads CLI Adapter

TypeScript/Node.js wrapper for Beads issue tracking with safe, idempotent access patterns, LRU caching, and conflict handling.

## Overview

The `BeadsAdapter` provides a high-level API for interacting with Beads (`bd`) CLI commands while ensuring:

- **Idempotency**: Query operations are fully idempotent; mutations have guards for non-idempotent operations
- **Caching**: LRU cache with TTL and max entry bounds to reduce CLI overhead
- **Conflict handling**: Atomic claims, circular dependency detection, and retry logic
- **Audit trail**: BEADS_ACTOR environment variable for mutation tracking
- **Readonly mode**: Optional read-only enforcement for safe deployments

## Installation

```bash
npm install
```

## Quick Start

```javascript
import { BeadsAdapter } from './lib/beads/BeadsAdapter.js';

const adapter = new BeadsAdapter({
  cacheTtlMs: 60_000,        // 1 minute cache TTL
  cacheMaxEntries: 100,      // Max 100 cached entries
  actor: 'my-app',           // Audit trail actor name
  readonly: false,           // Allow mutations
});

const project = {
  identifier: 'PROJ',
  filesystem_path: '/opt/stacks/my-project',
};

// Get ready work (unblocked, actionable issues)
const ready = await adapter.getReadyWork(project);
console.log(ready.items);

// Get specific issue
const issue = await adapter.getIssue('PROJ-1', project);
console.log(issue);

// Claim an issue
const claimed = await adapter.claimIssue('PROJ-1', project, 'user-a');
console.log(claimed);

// Close an issue
const closed = await adapter.closeIssue('PROJ-1', project);
console.log(closed);
```

## API Reference

### Constructor Options

```javascript
new BeadsAdapter({
  cacheTtlMs: 60_000,           // Cache TTL in milliseconds (default: 60000)
  cacheMaxEntries: 100,         // Max cached entries (default: 100)
  beadsDb: '.beads',            // Beads database path (default: .beads)
  actor: 'my-app',              // Audit trail actor (default: $USER)
  readonly: false,              // Readonly mode (default: false)
  runCommand: customRunner,     // Custom command runner (optional)
})
```

### Query Operations (Fully Idempotent)

All query operations are safe to retry and fully idempotent.

#### `getReadyWork(project, options?)`

Returns unblocked, actionable issues (equivalent to `bd ready`).

```javascript
const ready = await adapter.getReadyWork(project);
// Returns: { items: [{ id, title, status, priority, ... }] }

// Force refresh (bypass cache)
const fresh = await adapter.getReadyWork(project, { forceRefresh: true });
```

#### `getIssue(issueId, project, options?)`

Returns full issue detail by ID.

```javascript
const issue = await adapter.getIssue('PROJ-1', project);
// Returns: { id, title, status, priority, description, assignee, labels, ... }
```

#### `listIssues(project, filters?, options?)`

Lists issues with optional filters.

```javascript
const issues = await adapter.listIssues(project, {
  status: 'todo',
  priority: 'P1',
  type: 'task',
  assignee: 'user-a',
});
// Returns: { items: [...] }
```

#### `getProjectWorkItems(project, options?)`

Combines ready work + list (used by tests and Android API).

```javascript
const items = await adapter.getProjectWorkItems(project);
// Returns: { items: [...] }

// Filter by status
const todos = await adapter.getProjectWorkItems(project, { status: 'todo' });
```

#### `getDependencies(issueId, project, options?)`

Returns issue blockers and dependencies.

```javascript
const deps = await adapter.getDependencies('PROJ-1', project);
// Returns: [{ id, type: 'blocks' | 'discovered-from' }, ...]
```

#### `checkCycles(project, options?)`

Detects circular dependencies.

```javascript
const cycles = await adapter.checkCycles(project);
// Returns: [{ cycle: ['PROJ-1', 'PROJ-2', 'PROJ-1'] }, ...]
```

#### `getGraph(issueId, project, options?)`

Returns dependency graph visualization.

```javascript
const graph = await adapter.getGraph('PROJ-1', project);
// Returns: { nodes: [...], edges: [...] }
```

### Mutation Operations

Mutations support idempotency guards and conflict handling.

#### `createIssue(project, title, options?)`

Creates a new issue.

```javascript
const issue = await adapter.createIssue(project, 'New task', {
  description: 'Task description',
  priority: 'P1',
  type: 'task',
  checkDuplicate: true,  // Check for existing issue with same title
});
// Returns: { id, title, status: 'todo', ... }
```

**Idempotency**: NOT idempotent—creates new ID each time. Use `checkDuplicate: true` to prevent duplicates.

#### `updateIssue(issueId, project, updates?, options?)`

Updates issue fields.

```javascript
const updated = await adapter.updateIssue('PROJ-1', project, {
  status: 'in_progress',
  priority: 'P1',
  title: 'Updated title',
  description: 'Updated description',
  labels: ['bug', 'urgent'],  // Appends new labels
});
// Returns: { id, title, status, ... }
```

**Idempotency**: Setter fields (status, priority, title, description) are idempotent. Appender fields (labels) are NOT idempotent—use `skipIdempotencyCheck: true` to bypass the check.

#### `claimIssue(issueId, project, actor?)`

Atomically claims an issue for a user.

```javascript
const claimed = await adapter.claimIssue('PROJ-1', project, 'user-a');
// Returns: { id, assignee: 'user-a', ... }
```

**Idempotency**: Idempotent—fails if already claimed by someone else (atomic operation).

#### `closeIssue(issueId, project, options?)`

Closes an issue.

```javascript
const closed = await adapter.closeIssue('PROJ-1', project, {
  reason: 'Fixed in PR #123',
});
// Returns: { id, status: 'closed', closed_at: '2026-01-03T...', ... }
```

**Idempotency**: Idempotent—closing an already-closed issue succeeds.

#### `reopenIssue(issueId, project)`

Reopens a closed issue.

```javascript
const reopened = await adapter.reopenIssue('PROJ-1', project);
// Returns: { id, status: 'todo', closed_at: null, ... }
```

**Idempotency**: Idempotent—reopening an already-open issue succeeds.

#### `addNote(issueId, project, text, options?)`

Adds a note to an issue.

```javascript
const issue = await adapter.addNote('PROJ-1', project, 'Important note', {
  checkDuplicate: true,  // Check for existing note with same text
});
// Returns: { id, notes: [...], ... }
```

**Idempotency**: NOT idempotent—appends each time. Use `checkDuplicate: true` to prevent duplicates.

#### `addComment(issueId, project, text, options?)`

Adds a comment to an issue.

```javascript
const issue = await adapter.addComment('PROJ-1', project, 'Great work!', {
  checkDuplicate: true,  // Check for existing comment with same text
});
// Returns: { id, comments: [...], ... }
```

**Idempotency**: NOT idempotent—appends each time. Use `checkDuplicate: true` to prevent duplicates.

#### `addDependency(issueId, dependsOnId, project, type?)`

Adds a dependency between issues.

```javascript
const result = await adapter.addDependency('PROJ-1', 'PROJ-2', project, 'blocks');
// Returns: { success: true }
```

**Idempotency**: Idempotent—adding an existing dependency succeeds.

#### `removeDependency(issueId, dependsOnId, project)`

Removes a dependency between issues.

```javascript
const result = await adapter.removeDependency('PROJ-1', 'PROJ-2', project);
// Returns: { success: true }
```

**Idempotency**: Idempotent—removing a non-existent dependency succeeds.

## Idempotency Matrix

| Operation | Idempotent | Notes |
|-----------|-----------|-------|
| `getReadyWork` | ✅ Yes | Query only |
| `getIssue` | ✅ Yes | Query only |
| `listIssues` | ✅ Yes | Query only |
| `getDependencies` | ✅ Yes | Query only |
| `checkCycles` | ✅ Yes | Query only |
| `getGraph` | ✅ Yes | Query only |
| `createIssue` | ❌ No | Use `checkDuplicate: true` |
| `updateIssue` (setters) | ✅ Yes | status, priority, title, description |
| `updateIssue` (appenders) | ❌ No | labels—use `skipIdempotencyCheck: true` |
| `claimIssue` | ✅ Yes | Atomic; fails if already claimed |
| `closeIssue` | ✅ Yes | Idempotent |
| `reopenIssue` | ✅ Yes | Idempotent |
| `addNote` | ❌ No | Use `checkDuplicate: true` |
| `addComment` | ❌ No | Use `checkDuplicate: true` |
| `addDependency` | ✅ Yes | Idempotent |
| `removeDependency` | ✅ Yes | Idempotent |

## Caching

The adapter uses an LRU cache with TTL and max entry bounds:

```javascript
const adapter = new BeadsAdapter({
  cacheTtlMs: 60_000,      // Entries expire after 60 seconds
  cacheMaxEntries: 100,    // Max 100 entries; evicts oldest on overflow
});

// Cache is automatically invalidated after mutations
await adapter.closeIssue('PROJ-1', project);
// Related caches are invalidated:
// - PROJ:ready-work
// - PROJ:issue:PROJ-1
// - PROJ:issues:*

// Force refresh to bypass cache
const fresh = await adapter.getReadyWork(project, { forceRefresh: true });
```

## Conflict Handling

### Atomic Claims

Claims are atomic and fail if already claimed by someone else:

```javascript
try {
  await adapter.claimIssue('PROJ-1', project, 'user-a');
} catch (error) {
  if (error.message.includes('already claimed')) {
    console.log('Issue already claimed by another user');
  }
}
```

### Circular Dependency Detection

Check for cycles before adding dependencies:

```javascript
const cycles = await adapter.checkCycles(project);
if (cycles.length > 0) {
  console.log('Circular dependencies detected:', cycles);
}
```

### Idempotency Guards

For non-idempotent operations, use idempotency guards:

```javascript
// Check for duplicate before creating
const existing = await adapter.listIssues(project, {});
if (!existing.items.some(i => i.title === 'New task')) {
  await adapter.createIssue(project, 'New task');
}

// Or use built-in guard
await adapter.createIssue(project, 'New task', { checkDuplicate: true });
```

## Readonly Mode

Enable readonly mode to prevent mutations:

```javascript
const adapter = new BeadsAdapter({
  readonly: true,  // Prevent all mutations
});

// Queries work fine
const ready = await adapter.getReadyWork(project);

// Mutations throw
try {
  await adapter.closeIssue('PROJ-1', project);
} catch (error) {
  console.log(error.message); // "Cannot close issue in readonly mode"
}
```

## Environment Variables

The adapter respects Beads environment variables:

```bash
# Set Beads database path
export BEADS_DB=/opt/stacks/my-project/.beads

# Set audit trail actor
export BEADS_ACTOR=my-app

# Enable readonly mode
export BEADS_READONLY=1

# Auto-commit Dolt changes
export BEADS_DOLT_AUTO_COMMIT=on
```

## Error Handling

The adapter throws descriptive errors:

```javascript
try {
  await adapter.getReadyWork(project);
} catch (error) {
  if (error.message.includes('Beads command failed')) {
    console.log('CLI error:', error.message);
  }
}
```

## Testing

Run the test suite:

```bash
npm test -- tests/unit/BeadsAdapter.test.js
npm test -- tests/unit/BeadsAdapter.integration.test.js
```

## Performance

Typical latencies (with cache hits):

- Query operations: 5-50ms (cached), 50-200ms (uncached)
- Mutations: 100-500ms (depends on Beads database size)
- Cache lookup: <1ms

## Limitations

- **No streaming**: All results are buffered in memory
- **No pagination**: Large result sets are returned as arrays
- **No real-time updates**: Cache is TTL-based, not event-driven
- **Single-threaded**: Beads database is local-first; concurrent writes may conflict

## Future Enhancements

- [ ] Streaming results for large queries
- [ ] Cursor-based pagination
- [ ] WebSocket subscriptions for real-time updates
- [ ] Batch operations (create multiple issues, bulk update)
- [ ] Performance metrics and observability
- [ ] Retry logic with exponential backoff
- [ ] Connection pooling for multiple projects

## References

- [Beads CLI Documentation](https://github.com/gastownhall/beads)
- [Beads Command Matrix](/tmp/beads-command-matrix.md)
- [Beads CLI Reference](/tmp/beads-cli-reference.md)
