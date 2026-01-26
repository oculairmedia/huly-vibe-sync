# PRD: Tree-sitter AST Integration for Code Perception

**Version**: 1.3  
**Date**: 2026-01-26  
**Author**: Developer Agent  
**Status**: Complete - Phases 1-3 Done, Phase 4 In Progress

---

## Executive Summary

Extend the existing `CodePerceptionWatcher` to extract **function-level code structure** using **Tree-sitter** AST parsing, while maintaining the current deterministic direct-API approach for Graphiti integration.

**Technology Change**: After research, we're using **Tree-sitter directly** instead of CocoIndex. CocoIndex's `SplitRecursively` only outputs text chunks, not structured function data. Tree-sitter provides direct AST access with ~11ms parse time per file.

**Scope for v1**: Functions only. Classes/Methods/Imports deferred to v1.1.

---

## Problem Statement

### Current State

- `CodePerceptionWatcher` syncs **file-level entities** to Graphiti
- Uses simple text extraction (`extractFileSummary`) - no AST parsing
- Creates only `File:` entities and `Project CONTAINS File` edges
- **Works well** for file-level awareness but lacks code structure visibility

### Gap

Agents cannot answer questions like:

- "What functions are in this file?"
- "Where is `AuthHandler` class defined?"
- "What does this file import?"
- "Show me all functions that handle authentication"

### Opportunity

CocoIndex provides Tree-sitter AST parsing for 30+ languages. We can extract functions, classes, and imports **deterministically** and feed them to Graphiti using our existing direct-API pattern.

---

## Goals

| Goal                                    | Success Metric                                         |
| --------------------------------------- | ------------------------------------------------------ |
| **G1**: Extract functions from files    | Functions extracted for JS/TS/Python files             |
| **G2**: Maintain deterministic updates  | Same file = same entities (no LLM variance)            |
| **G3**: Enable incremental updates      | Change one function → update only that function's node |
| **G4**: Preserve existing functionality | Zero regression in current file-level sync             |
| **G5**: Support primary languages       | JS/TS/Python in v1; Go/Rust in v1.1                    |

---

## Non-Goals

- **N1**: Embedding generation (Graphiti handles this)
- **N2**: Episode-based LLM extraction (non-deterministic)
- **N3**: Call graph analysis (FUNCTION_CALLS_FUNCTION) - Phase 2
- **N4**: Cross-file relationship inference - Phase 2
- **N5**: Real-time IDE integration
- **N6**: Classes, Methods, Imports - deferred to v1.1
- **N7**: Nested functions/lambdas - top-level only for v1

---

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CodePerceptionWatcher                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐   │
│   │   Chokidar   │────▶│  CocoIndex AST   │────▶│  GraphitiClient  │   │
│   │  (existing)  │     │   (NEW)          │     │   (existing)     │   │
│   └──────────────┘     └──────────────────┘     └──────────────────┘   │
│                               │                         │               │
│                               ▼                         ▼               │
│                        Extract (v1):             Direct APIs:           │
│                        - Functions only         POST /entity-node       │
│                                                 POST /entity-edge       │
│                        (v1.1: Classes,          GET /api/utils/uuid     │
│                         Methods, Imports)                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Entity Naming Convention (Deterministic UUIDs)

**v1 Scope (Functions only):**

| Entity Type  | Naming Pattern                     | Example                                        |
| ------------ | ---------------------------------- | ---------------------------------------------- |
| **File**     | `File:{project}:{relative_path}`   | `File:graphiti:src/search/bfs.rs`              |
| **Function** | `Function:{project}:{path}:{name}` | `Function:graphiti:src/auth.py:validate_token` |

**v1.1 Scope (Future):**

| Entity Type | Naming Pattern                           | Example                                         |
| ----------- | ---------------------------------------- | ----------------------------------------------- |
| **Class**   | `Class:{project}:{path}:{name}`          | `Class:graphiti:src/auth.py:AuthHandler`        |
| **Method**  | `Method:{project}:{path}:{class}.{name}` | `Method:graphiti:src/auth.py:AuthHandler.login` |
| **Import**  | `Import:{project}:{path}:{module}`       | `Import:graphiti:src/auth.py:hashlib`           |

**Key Principle**: Names are reconstructible from AST data alone - no runtime state needed.

### Edge Types

**v1 Scope:**

| Edge Type  | Source → Target | Example                                                                      |
| ---------- | --------------- | ---------------------------------------------------------------------------- |
| `CONTAINS` | Project → File  | `Project:graphiti` → `File:graphiti:src/auth.py`                             |
| `CONTAINS` | File → Function | `File:graphiti:src/auth.py` → `Function:graphiti:src/auth.py:validate_token` |

**v1.1 Scope (Future):**

| Edge Type  | Source → Target | Example                                                                                    |
| ---------- | --------------- | ------------------------------------------------------------------------------------------ |
| `CONTAINS` | File → Class    | `File:graphiti:src/auth.py` → `Class:graphiti:src/auth.py:AuthHandler`                     |
| `CONTAINS` | Class → Method  | `Class:graphiti:src/auth.py:AuthHandler` → `Method:graphiti:src/auth.py:AuthHandler.login` |
| `IMPORTS`  | File → Import   | `File:graphiti:src/auth.py` → `Import:graphiti:src/auth.py:hashlib`                        |

### Data Flow

```
File Change (chokidar)
    │
    ▼
Hash Check (skip if unchanged) ◄── Existing
    │
    ▼
CocoIndex AST Parse ◄── NEW
    │
    ├── Extract top-level functions only (name, signature, docstring, line range)
    ├── Skip nested functions, lambdas, inner functions
    │
    ▼
Local AST Cache Check ◄── NEW
    │
    ├── Load previous parse result from cache
    ├── Compare with current parse
    │
    ▼
Diff Detection ◄── NEW
    │
    ├── Identify added functions
    ├── Identify modified functions (signature/docstring changed)
    ├── Identify deleted functions
    │
    ▼
Batch Upsert Entities ◄── Extended
    │
    ├── File entity (existing)
    ├── Function entities (new - only changed ones)
    │
    ▼
Batch Create Edges ◄── Extended
    │
    ├── Project CONTAINS File (existing)
    ├── File CONTAINS Function (new)
    │
    ▼
Prune Deleted Functions ◄── NEW (cascade delete when file deleted)
    │
    ▼
Update Local AST Cache ◄── NEW
```

### Bulk Sync Flow (Initial Project Sync)

```
Project Discovery
    │
    ▼
File List (glob patterns)
    │
    ▼
Parallel AST Parsing ◄── NEW
    │
    ├── 10 concurrent workers (configurable)
    ├── Rate limit: max 100 files/second to Graphiti
    │
    ▼
Batch Entity Upsert (50 per batch)
    │
    ▼
Batch Edge Creation (50 per batch)
```

---

## Implementation Plan

### Phase 1: CocoIndex Integration (Week 1)

| Task    | Description                                             | Estimate |
| ------- | ------------------------------------------------------- | -------- |
| **1.1** | Add CocoIndex Python dependency                         | 2h       |
| **1.2** | Create `ASTParser` service (Python subprocess)          | 6h       |
| **1.3** | Implement **function-only** extraction for JS/TS/Python | 6h       |
| **1.4** | Implement local AST cache (JSON file per project)       | 4h       |
| **1.5** | Unit tests for AST parsing                              | 4h       |

**Deliverable**: `ASTParser` service that extracts **functions** from files

### Phase 2: GraphitiClient Extension (Week 1)

| Task    | Description                               | Estimate |
| ------- | ----------------------------------------- | -------- |
| **2.1** | Add Function entity type                  | 2h       |
| **2.2** | Add File CONTAINS Function edge creation  | 2h       |
| **2.3** | Implement parallel bulk sync (10 workers) | 4h       |
| **2.4** | Add rate limiting for bulk sync           | 2h       |
| **2.5** | Unit tests for new GraphitiClient methods | 3h       |

**Deliverable**: Extended `GraphitiClient` supporting Function entities

### Phase 3: CodePerceptionWatcher Integration (Week 1-2)

| Task    | Description                                                       | Estimate |
| ------- | ----------------------------------------------------------------- | -------- |
| **3.1** | Integrate ASTParser into file processing flow                     | 6h       |
| **3.2** | Implement function diff detection using local cache               | 4h       |
| **3.3** | Implement deletion cascade (file deleted → all functions deleted) | 3h       |
| **3.4** | Add configuration options (enable/disable AST parsing)            | 2h       |
| **3.5** | Add graceful degradation metric (% files parsed successfully)     | 2h       |
| **3.6** | Integration tests                                                 | 4h       |

**Deliverable**: Full integration with incremental function sync

### Phase 4: Validation & Staged Rollout (Week 2)

| Task    | Description                                                                                | Estimate |
| ------- | ------------------------------------------------------------------------------------------ | -------- |
| **4.1** | Performance testing (memory, CPU, sync time)                                               | 3h       |
| **4.2** | **Stage 1**: Test with huly-vibe-sync project                                              | 2h       |
| **4.3** | **Stage 2**: Test with 5 projects (graphiti, letta, vibe-kanban, matrix-synapse, context7) | 3h       |
| **4.4** | **Stage 3**: Full rollout to all 50 projects                                               | 2h       |
| **4.5** | Documentation                                                                              | 3h       |

**Deliverable**: Production-ready feature with staged rollout complete

### Total Estimate: ~10-12 days (reduced from 3 weeks)

---

## Technical Decisions

### Decision 1: CocoIndex Integration Method

**Options**:
| Option | Pros | Cons |
|--------|------|------|
| **A: Python subprocess** | Simple, isolated, no Node native deps | IPC overhead, process management |
| **B: tree-sitter Node bindings** | Native performance, no subprocess | Different lib than CocoIndex, manual language setup |
| **C: CocoIndex as microservice** | Clean separation, reusable | Deployment complexity, network overhead |

**Recommendation**: **Option A (Python subprocess)** for Phase 1

- CocoIndex is Python-native
- Subprocess overhead acceptable for file-change-triggered parsing
- Can optimize to Option C if performance issues arise

### Decision 2: Symbol Granularity

**Options**:
| Option | Entities Created | Complexity |
|--------|------------------|------------|
| **A: File + Functions only** | File, Function | Low |
| **B: File + Functions + Classes** | File, Function, Class, Method | Medium |
| **C: Full AST** | All of above + Variables, Types, Decorators | High |

**Decision**: **Option A (Functions only)** for v1 ✅ (per PM feedback)

- Validates entire pipeline with minimal complexity
- Avoids nested entity relationships (Class CONTAINS Method complicates pruning)
- Ship in ~1.5 weeks instead of 3 weeks
- Expand to Classes/Methods/Imports in v1.1 once pipeline is proven

### Decision 3: Symbol Summary Content

**What to include in entity summary**:

```javascript
// Function entity summary
{
  name: "Function:project:src/auth.py:validate_token",
  summary: `
    def validate_token(token: str) -> bool

    Validates JWT token and returns True if valid.

    Lines: 45-62
    Parameters: token (str)
    Returns: bool
  `
}
```

**Include**:

- Signature (name, parameters, return type)
- Docstring (first paragraph)
- Line range (for IDE navigation)
- Decorators (e.g., @staticmethod, @async)

**Exclude**:

- Full function body (too large)
- Implementation details

---

## Risks & Mitigations

| Risk                                        | Likelihood | Impact | Mitigation                                                   |
| ------------------------------------------- | ---------- | ------ | ------------------------------------------------------------ |
| **CocoIndex parsing errors**                | Medium     | Medium | Fallback to file-only sync, log errors, track % success      |
| **Performance degradation (single file)**   | Low        | Medium | 500ms budget, async parsing, local cache                     |
| **Performance degradation (bulk sync)**     | Medium     | High   | Parallel workers (10), rate limiting (100 files/sec)         |
| **Memory usage with large files**           | Low        | Medium | Skip files > 1MB, top-level functions only                   |
| **Language coverage gaps**                  | Low        | Low    | Graceful fallback to text summary                            |
| **Entity explosion (too many nodes)**       | Medium     | High   | See mitigations below                                        |
| **Deletion cascade failure**                | Medium     | Medium | File deleted → explicitly delete all child Function entities |
| **Simultaneous bulk sync from 50 projects** | Medium     | High   | Queue/throttle, stagger project syncs                        |

### Entity Explosion Mitigations

**Problem**: 50 projects × 500 files × 10 functions = **250,000 Function nodes**

| Mitigation          | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| **Depth limit**     | Top-level functions only, skip nested/inner functions/lambdas      |
| **Size threshold**  | Skip files < 10 lines (likely config/init files with no functions) |
| **File size limit** | Skip files > 1MB (likely generated/minified)                       |
| **Monitoring**      | Track node count per project, alert if > 5K functions              |
| **Pruning job**     | Scheduled cleanup of orphaned entities (weekly)                    |

---

## Success Criteria

### Functional

- [ ] Functions extracted from JS/TS/Python files
- [ ] File CONTAINS Function edges created
- [ ] Incremental updates work (change function → only that node updated)
- [ ] Deleted functions are pruned when file changes
- [ ] All child functions deleted when file is deleted (cascade)

### Performance

- [ ] < 500ms additional latency per file for AST parsing (single file)
- [ ] < 30 seconds for initial sync of 500-file project (parallel bulk sync)
- [ ] < 10% increase in memory usage
- [ ] No degradation in existing file-level sync

### Quality

- [ ] 95%+ test coverage on new code
- [ ] Zero regressions in existing tests
- [ ] Documentation complete
- [ ] Graceful degradation: 95%+ files parsed successfully (tracked metric)

### Rollout

- [ ] Stage 1: huly-vibe-sync project working
- [ ] Stage 2: 5 test projects working
- [ ] Stage 3: All 50 projects working

---

## Open Questions (Resolved)

1. **Q1**: Should we parse vendored/node_modules files?
   - **Answer**: No, exclude by default (already in existing exclude patterns)

2. **Q2**: How to handle very large files (> 10K lines)?
   - **Answer**: Skip files > 1MB, extract top-level functions only

3. **Q3**: Should imports create edges to external modules?
   - **Answer**: Deferred to v1.1 - Functions only in v1

4. **Q4**: How to handle language detection for files without extensions?
   - **Answer**: Use shebang line, fallback to file-only sync (no AST)

5. **Q5**: How to handle deletion cascade?
   - **Answer**: When file is deleted, explicitly query and delete all Function entities for that file

6. **Q6**: How to prevent Graphiti overload during bulk sync?
   - **Answer**: Rate limit to 100 files/second, 10 parallel workers, stagger project syncs

---

## Appendix A: Entity Examples (v1 Scope)

### File Entity (Existing)

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "name": "File:graphiti:src/auth/handler.py",
  "group_id": "vibesync_graphiti",
  "summary": "Authentication handler module with OAuth2 support.\n\nFunctions: validate_token, create_session, revoke_token\nLines: 1-150"
}
```

### Function Entity (New in v1)

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Function:graphiti:src/auth/handler.py:validate_token",
  "group_id": "vibesync_graphiti",
  "summary": "def validate_token(token: str, secret: str = None) -> bool\n\nValidates a JWT token against the configured secret.\nRaises TokenExpiredError if token is expired.\n\nLines: 45-72"
}
```

### File CONTAINS Function Edge (New in v1)

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440010",
  "source_node_uuid": "550e8400-e29b-41d4-a716-446655440000",
  "target_node_uuid": "550e8400-e29b-41d4-a716-446655440001",
  "name": "CONTAINS",
  "group_id": "vibesync_graphiti",
  "fact": "File src/auth/handler.py contains function validate_token"
}
```

---

## Appendix A.1: Entity Examples (v1.1 Preview)

_These entity types are planned for v1.1, not included in v1 scope._

### Class Entity (v1.1)

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440002",
  "name": "Class:graphiti:src/auth/handler.py:AuthHandler",
  "group_id": "vibesync_graphiti",
  "summary": "class AuthHandler(BaseHandler)\n\nHandles OAuth2 authentication flow including login, logout, and token refresh.\n\nMethods: login, logout, refresh_token, validate_session\nLines: 15-120"
}
```

### Method Entity (v1.1)

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440003",
  "name": "Method:graphiti:src/auth/handler.py:AuthHandler.login",
  "group_id": "vibesync_graphiti",
  "summary": "def login(self, username: str, password: str) -> Session\n\nAuthenticates user and creates a new session.\n\nLines: 25-45"
}
```

### Import Entity (v1.1)

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440004",
  "name": "Import:graphiti:src/auth/handler.py:jwt",
  "group_id": "vibesync_graphiti",
  "summary": "import jwt\n\nJSON Web Token library for token encoding/decoding"
}
```

---

## Appendix B: CocoIndex Usage

### Installation

```bash
# Tree-sitter (RECOMMENDED - used in implementation)
pip install tree-sitter tree-sitter-python tree-sitter-javascript tree-sitter-typescript

# CocoIndex (NOT USED - only provides text chunking, not function extraction)
# pip install cocoindex[embeddings]
```

### Parsing Example

```python
import cocoindex

@cocoindex.flow_def(name="CodeParsing")
def parse_code(flow_builder, data_scope):
    # Source: single file (we'll call per-file)
    data_scope["file"] = flow_builder.add_source(
        cocoindex.sources.LocalFile(
            path=file_path,
            included_patterns=["*"],
        )
    )

    with data_scope["file"].row() as file:
        # Detect language
        file["language"] = file["filename"].transform(
            cocoindex.functions.DetectProgrammingLanguage()
        )

        # Split into semantic chunks (functions, classes)
        file["chunks"] = file["content"].transform(
            cocoindex.functions.SplitRecursively(),
            language=file["language"],
            chunk_size=2000,
            chunk_overlap=200,
        )
```

### Alternative: Direct Tree-sitter

```python
import tree_sitter_python as tspython
from tree_sitter import Language, Parser

parser = Parser(Language(tspython.language()))
tree = parser.parse(bytes(source_code, "utf8"))

# Walk AST to extract functions, classes
for node in tree.root_node.children:
    if node.type == "function_definition":
        name = node.child_by_field_name("name").text.decode()
        # Extract function details...
```

---

## Staged Rollout Plan

### Stage 1: Single Project Validation

- **Project**: huly-vibe-sync
- **Duration**: 1-2 days
- **Success criteria**: Functions extracted, edges created, incremental updates working
- **Rollback**: Feature flag OFF

### Stage 2: Multi-Project Validation

- **Projects**:
  - graphiti
  - letta
  - vibe-kanban
  - matrix-synapse-deployment
  - context7
- **Duration**: 2-3 days
- **Success criteria**: All 5 projects syncing, no performance issues, < 5K functions per project
- **Rollback**: Feature flag OFF for specific projects

### Stage 3: Full Rollout

- **Projects**: All 50 projects
- **Duration**: Ongoing
- **Success criteria**: 95%+ files parsed successfully, no Graphiti performance degradation
- **Monitoring**: Node count alerts, parse success rate, sync latency

---

## Changelog

| Version | Date       | Author          | Changes                                                                                                                                                       |
| ------- | ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-01-26 | Developer Agent | Initial draft                                                                                                                                                 |
| 1.1     | 2026-01-26 | Developer Agent | Revised per PM feedback: Functions-only scope, added entity explosion mitigations, parallel bulk sync, local AST cache, deletion cascade, staged rollout plan |
| 1.2     | 2026-01-26 | Developer Agent | Phase 1 complete: ASTParser, ASTCache, 36 tests passing                                                                                                       |
| 1.3     | 2026-01-26 | Developer Agent | Phases 1-3 complete: Full integration with CodePerceptionWatcher, 117 tests passing, benchmarks show 52ms/file avg, 100% success rate                         |
