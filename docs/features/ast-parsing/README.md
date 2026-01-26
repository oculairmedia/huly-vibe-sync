# AST Parsing for Function Extraction

Extracts function-level code structure from source files using Tree-sitter AST parsing and syncs to Graphiti Knowledge Graph.

## Overview

The AST parsing feature extends `CodePerceptionWatcher` to extract functions from JS/TS/Python files and create `Function` entities in Graphiti, enabling queries like:

- "What functions are in this file?"
- "Show me all async functions in the project"
- "Find functions that handle authentication"

## Architecture

```
File Change → CodePerceptionWatcher
                    ↓
              ASTParser (Tree-sitter via Python subprocess)
                    ↓
              ASTCache (local diff detection)
                    ↓
              GraphitiClient.syncFilesWithFunctions()
                    ↓
              Graphiti Knowledge Graph
```

## Components

### ASTParser (`lib/ASTParser.js`)

Node.js wrapper for Python Tree-sitter parsing.

```javascript
import { parseFile, parseFiles, isSupported } from './ASTParser.js';

// Check if file type is supported
isSupported('main.js'); // true
isSupported('data.csv'); // false

// Parse single file
const result = await parseFile('/path/to/file.js');
// { file, language, functions: [{name, signature, docstring, start_line, end_line}], error }

// Batch parse
const results = await parseFiles(['/path/a.js', '/path/b.py']);
```

**Supported Languages:**

- JavaScript (.js, .mjs, .cjs, .jsx)
- TypeScript (.ts, .mts, .cts, .tsx)
- Python (.py, .pyw)

### ASTCache (`lib/ASTCache.js`)

Local cache for incremental updates - only syncs changed functions.

```javascript
import { ASTCache } from './ASTCache.js';

const cache = new ASTCache({
  projectId: 'my-project',
  projectPath: '/path/to/project',
});

await cache.load();

// Check if file needs re-parsing
const contentHash = ASTCache.computeHash(fileContent);
if (cache.needsReparse(relativePath, contentHash)) {
  // Parse and get diff
  const diff = cache.diff(relativePath, newFunctions);
  // { added: [], modified: [], removed: [], unchanged: [] }

  // Update cache
  cache.set(relativePath, contentHash, mtime, newFunctions);
}

await cache.save();
```

### GraphitiClient Extensions (`lib/GraphitiClient.js`)

New methods for Function entity management:

```javascript
// Single function upsert
await client.upsertFunction({
  projectId: 'my-project',
  filePath: 'lib/utils.js',
  name: 'calculateSum',
  signature: 'function calculateSum(a, b)',
  docstring: 'Adds two numbers',
  startLine: 10,
  endLine: 15,
});

// Batch upsert with rate limiting
await client.upsertFunctionsWithEdges({
  projectId: 'my-project',
  filePath: 'lib/utils.js',
  functions: [...],
  concurrency: 10,
  rateLimit: 100,
});

// Bulk sync multiple files
await client.syncFilesWithFunctions({
  projectId: 'my-project',
  files: [
    { filePath: 'a.js', functions: [...] },
    { filePath: 'b.js', functions: [...] },
  ],
  concurrency: 10,
  rateLimit: 100,
});

// Delete functions (cascade on file deletion)
await client.deleteFunctions('my-project', 'deleted-file.js', ['func1', 'func2']);
```

## Configuration

### Environment Variables

```bash
# Already required for CodePerceptionWatcher
GRAPHITI_ENABLED=true
GRAPHITI_API_URL=http://localhost:8003
```

### CodePerceptionWatcher Options

```javascript
new CodePerceptionWatcher({
  config: { ... },
  db: { ... },
  astEnabled: true,        // Enable AST parsing (default: true)
  astConcurrency: 10,      // Max concurrent Graphiti operations (default: 10)
  astRateLimit: 100,       // Max Graphiti ops per second (default: 100)
});
```

### Config File (`config.codePerception.astEnabled`)

```json
{
  "codePerception": {
    "astEnabled": false // Disable AST parsing
  }
}
```

## Entity Schema

### Function Entity

**Name format:** `Function:{projectId}:{filePath}:{functionName}`

**Example:** `Function:huly-vibe-sync:lib/ASTParser.js:parseFile`

**Summary contains:**

```
function parseFile(filePath, options)

Parses a single file and extracts functions.

Lines: 77-135
```

### Edges

**File CONTAINS Function**

- Source: `File:{filePath}`
- Target: `Function:{projectId}:{filePath}:{functionName}`
- Edge name: `CONTAINS`

## Metrics

Available in `watcher.getStats()`:

| Metric            | Description                        |
| ----------------- | ---------------------------------- |
| `functionsSynced` | Total functions synced to Graphiti |
| `astParseSuccess` | Files successfully parsed          |
| `astParseFailure` | Files that failed to parse         |
| `astSuccessRate`  | Percentage success rate            |

Health metrics logged periodically include `functionsSynced` and `astSuccessRate`.

## Performance

Benchmarked on huly-vibe-sync project (595 source files):

| Metric                 | Result        | Target  |
| ---------------------- | ------------- | ------- |
| Single file parse      | 52ms avg      | < 500ms |
| Bulk parse (595 files) | 2.63s         | -       |
| 500-file sync          | 2.13s         | < 30s   |
| Parse success rate     | 100%          | ≥ 95%   |
| Memory delta           | 1.19MB        | -       |
| Throughput             | 226 files/sec | -       |
| Functions extracted    | 3,380         | -       |

## Graceful Degradation

If AST parsing fails for a file:

- File entity is still synced (existing behavior preserved)
- Error is logged at DEBUG level
- `astParseFailure` counter incremented
- Success rate visible in health metrics
- No impact on other files

## Testing

```bash
# Run AST-related unit tests
npm test -- --run tests/unit/ASTParser.test.js
npm test -- --run tests/unit/ASTCache.test.js
npm test -- --run tests/unit/GraphitiClient.test.js
npm test -- --run tests/unit/CodePerceptionWatcher.test.js

# Run performance benchmark
node scripts/benchmark-ast.js
```

## Troubleshooting

### Python Dependencies Missing

```bash
cd /opt/stacks/huly-vibe-sync/python
pip install -r requirements.txt
```

### Low Success Rate

Check logs for parse errors:

```bash
docker logs huly-vibe-sync 2>&1 | grep "AST parse failed"
```

Common causes:

- Syntax errors in source files
- Unsupported language features
- Files with encoding issues

### High Memory Usage

Reduce batch size or concurrency:

```javascript
new CodePerceptionWatcher({
  astConcurrency: 5, // Lower concurrency
  astRateLimit: 50, // Lower rate limit
});
```
