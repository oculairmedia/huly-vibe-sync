# BookStack Sync Integration Design

**Status**: Approved (Phase 1) — Implementation In Progress
**Author**: Developer Agent
**Date**: 2026-01-28
**Project**: HVSYN
**Issues**: HVSYN-912 (parent), HVSYN-914 (Phase 1), HVSYN-913 (Phase 2), HVSYN-915 (Phase 3)

### PM Review Decisions (2026-01-29)

| Question             | Decision                                                         |
| -------------------- | ---------------------------------------------------------------- |
| Book→project mapping | Explicit config (env vars), no auto-discovery                    |
| Exporter deployment  | Docker sidecar (isolation, independent lifecycle)                |
| Export interval      | 1 hour                                                           |
| Image sync direction | One-way (BookStack → local) for Phase 1                          |
| Feature flag         | `USE_BOOKSTACK_SYNC=true/false` (consistent with Temporal flags) |
| Failure isolation    | Phase 4 errors must NOT affect Phases 1-3                        |
| Health endpoint      | Extend `/api/health` with BookStack status                       |
| Tests                | Unit tests required before merge                                 |
| Phases 2/3           | Require separate design reviews                                  |

---

## 1. Problem Statement

We maintain long-term project trajectory documentation in BookStack (https://docs.oculair.ca). Currently, there is no automated sync between BookStack content and the project filesystem. Agents cannot read/edit BookStack docs locally, and local edits don't flow back to BookStack.

We need the same **API → File Store → Sync Service** pattern we already use for Huly ↔ Vibe ↔ Beads, extended to BookStack.

## 2. Goals

1. **Pull**: Export BookStack books/chapters/pages to the project filesystem as markdown (with images + attachments)
2. **Push**: Import local filesystem changes back to BookStack
3. **Orchestrate**: Detect changes on both sides, resolve conflicts, sync bidirectionally
4. **Agent-friendly**: CLI agents can use to query/search/import/export BookStack content directly

## 3. Non-Goals (Phase 1)

- Real-time webhook-based sync from BookStack (BookStack lacks webhook support for page edits)
- Full shelf-level hierarchy management (start with book-level)
- PDF export/import

## 4. External Tools

Two external tools complement each other:

### 4.1 `bookstack-file-exporter` (Python — homeylab)

**Role**: Automated scheduled **export** (BookStack → filesystem)

| Capability     | Detail                                                 |
| -------------- | ------------------------------------------------------ |
| Direction      | Export only                                            |
| Formats        | Markdown, HTML, PDF, Plaintext                         |
| Images         | ✅ Exports + rewrites markdown links                   |
| Attachments    | ✅ Exports uploaded attachments                        |
| Metadata       | ✅ `_meta.json` per page (IDs, timestamps, owner)      |
| Daemon mode    | ✅ `run_interval` for scheduled exports                |
| File structure | Shelves → Books → Chapters → Pages (slug-based naming) |
| Docker         | ✅ `homeylab/bookstack-file-exporter`                  |

**Use for**: Automated periodic full export with images/attachments/metadata to the filesystem.

### 4.2 `@junovy/bookstack-cli` (TypeScript — Junovy)

**Role**: Interactive **bidirectional** CLI (import + export + search + list)

| Capability       | Detail                                        |
| ---------------- | --------------------------------------------- |
| Direction        | Bidirectional (import + export)               |
| Import           | Markdown/HTML/Plaintext → BookStack pages     |
| Export           | Single book/chapter/page to markdown/HTML/PDF |
| Search           | Full-text search across all content           |
| List             | Books, chapters, pages, shelves               |
| Config           | JSON/YAML/TOML/env vars/CLI flags             |
| Directory import | Subdirs → chapters, files → pages             |

**Use for**: Agent-driven imports, ad-hoc queries, single-page operations.

## 5. Architecture

```
┌────────────────────────────────────────────────────────┐
│                   BookStack Instance                    │
│              https://knowledge.oculair.ca                   │
│                    (Source of truth)                    │
└──────────┬────────────────────────────┬────────────────┘
           │                            │
    Export (pull)                 Import (push)
    bookstack-file-exporter      @junovy/bookstack-cli
           │                            │
           ▼                            ▲
┌──────────────────────────────────────────────────────────┐
│              Project Filesystem                          │
│  /opt/stacks/{project}/docs/bookstack/                  │
│                                                          │
│  {book-slug}/                                           │
│  ├── .book-metadata.json          (BookStack IDs, ts)   │
│  ├── chapter-slug/                                      │
│  │   ├── .chapter-metadata.json                         │
│  │   ├── page-slug.md                                   │
│  │   ├── page-slug_meta.json      (page ID, modified)   │
│  │   └── images/                                        │
│  │       └── page-slug/                                 │
│  │           └── diagram.png                            │
│  └── standalone-page.md                                 │
└──────────────────────┬───────────────────────────────────┘
                       │
                       │  File watcher (chokidar)
                       │  + Sync orchestrator
                       ▼
┌──────────────────────────────────────────────────────────┐
│              huly-vibe-sync                              │
│                                                          │
│  BookStackService.js      ← Service layer               │
│  BookStackWatcher.js      ← File watcher (chokidar)     │
│  SyncOrchestrator.js      ← Extended with Phase 4       │
│  database.js              ← New bookstack_pages table    │
│  config.js                ← BookStack config section     │
└──────────────────────────────────────────────────────────┘
```

## 6. Implementation Plan

### 6.1 New Files

| File                       | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `lib/BookStackService.js`  | Service layer wrapping both external tools       |
| `lib/BookStackWatcher.js`  | Watches `docs/bookstack/` dirs for local changes |
| `lib/BookStackExporter.js` | Wraps `bookstack-file-exporter` execution        |

### 6.2 Modified Files

| File                      | Change                                    |
| ------------------------- | ----------------------------------------- |
| `lib/config.js`           | Add `bookstack` config section            |
| `lib/database.js`         | Add `bookstack_pages` table               |
| `lib/SyncOrchestrator.js` | Add Phase 4: BookStack ↔ Filesystem sync |
| `index.js`                | Initialize BookStack watcher + service    |
| `package.json`            | Add `@junovy/bookstack-cli` dependency    |
| `.env.example`            | Add BookStack env vars                    |

### 6.3 Config Addition (`config.js`)

```javascript
bookstack: {
  enabled: process.env.BOOKSTACK_ENABLED === 'true',
  url: process.env.BOOKSTACK_URL || 'https://docs.oculair.ca',
  tokenId: process.env.BOOKSTACK_TOKEN_ID,
  tokenSecret: process.env.BOOKSTACK_TOKEN_SECRET,
  syncInterval: parseInt(process.env.BOOKSTACK_SYNC_INTERVAL || '3600000'), // 1 hour
  exportFormats: (process.env.BOOKSTACK_EXPORT_FORMATS || 'markdown').split(','),
  exportImages: process.env.BOOKSTACK_EXPORT_IMAGES !== 'false',
  exportAttachments: process.env.BOOKSTACK_EXPORT_ATTACHMENTS !== 'false',
  exportMeta: process.env.BOOKSTACK_EXPORT_META !== 'false',
  modifyMarkdownLinks: process.env.BOOKSTACK_MODIFY_LINKS !== 'false',
  docsSubdir: process.env.BOOKSTACK_DOCS_SUBDIR || 'docs/bookstack',
  // Mapping: which BookStack book(s) to sync per project
  // Format: "HVSYN:my-book-slug,GRAPH:graphiti-docs"
  projectBookMappings: process.env.BOOKSTACK_PROJECT_BOOKS || '',
},
```

### 6.4 Database Schema Addition

```sql
CREATE TABLE IF NOT EXISTS bookstack_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bookstack_page_id INTEGER NOT NULL,
  bookstack_book_id INTEGER NOT NULL,
  bookstack_chapter_id INTEGER,
  project_identifier TEXT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  local_path TEXT,           -- relative path on filesystem
  content_hash TEXT,         -- hash of local file content
  bookstack_modified_at TEXT,-- ISO timestamp from BookStack API
  local_modified_at INTEGER, -- epoch ms of local file mtime
  last_export_at INTEGER,    -- when we last pulled from BookStack
  last_import_at INTEGER,    -- when we last pushed to BookStack
  sync_direction TEXT,       -- 'export' | 'import' | 'conflict'
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (project_identifier) REFERENCES projects(identifier)
);

CREATE INDEX IF NOT EXISTS idx_bs_pages_project ON bookstack_pages(project_identifier);
CREATE INDEX IF NOT EXISTS idx_bs_pages_bookstack_id ON bookstack_pages(bookstack_page_id);
CREATE INDEX IF NOT EXISTS idx_bs_pages_slug ON bookstack_pages(slug);
CREATE INDEX IF NOT EXISTS idx_bs_pages_local_path ON bookstack_pages(local_path);
```

### 6.5 BookStackService.js (Service Layer)

The service wraps both external tools behind a unified interface:

```javascript
export class BookStackService {
  constructor(config) {
    this.config = config;
    this.cliAvailable = false;
    this.exporterAvailable = false;
  }

  async initialize() {
    // Check if bookstack CLI is available
    this.cliAvailable = await this.checkCli();
    // Check if exporter config exists
    this.exporterAvailable = await this.checkExporter();
  }

  // ── PULL (BookStack → filesystem) ──

  async exportBook(bookIdOrSlug, outputDir, options = {}) {
    // Uses bookstack-file-exporter for full export (images, attachments, meta)
    // Falls back to bookstack-cli for single-book export
  }

  async exportPage(pageIdOrSlug, outputPath, format = 'markdown') {
    // Uses: bookstack page export <id> --format markdown --out <path>
  }

  // ── PUSH (filesystem → BookStack) ──

  async importDirectory(dirPath, bookName, options = {}) {
    // Uses: bookstack import <dir> --book <name> --format markdown
    // Respects .book-metadata.json and .chapter-metadata.json
  }

  async importPage(filePath, bookName, options = {}) {
    // Uses: bookstack import <file> --book <name>
  }

  // ── QUERY ──

  async listBooks() {
    // Uses: bookstack books list --json
  }

  async searchPages(query, filters = {}) {
    // Uses: bookstack search <query> --type page --json
  }

  async getBookTree(bookIdOrSlug) {
    // Uses: bookstack book tree <id> --json
  }

  // ── SYNC HELPERS ──

  async getPageMetadata(pageIdOrSlug) {
    // Fetch page details including modified_at timestamp
  }

  async detectChanges(localDir, bookSlug, db) {
    // Compare local file hashes/mtimes with bookstack_pages DB records
    // Returns: { toExport: [], toImport: [], conflicts: [] }
  }
}
```

### 6.6 BookStackWatcher.js

Follows the exact same pattern as `BeadsWatcher.js`:

```javascript
export class BookStackWatcher {
  constructor({ db, onBookStackChange, debounceDelay = 5000 }) {
    this.db = db;
    this.onBookStackChange = onBookStackChange;
    this.debounceDelay = debounceDelay;
    this.watchers = new Map(); // projectId -> chokidar watcher
    this.pendingChanges = new Map(); // projectId -> Set<filePath>
    this.debounceTimers = new Map();
  }

  watchProject(projectIdentifier, projectPath, docsSubdir = 'docs/bookstack') {
    // Watch {projectPath}/{docsSubdir}/ for .md file changes
    // Use chokidar with same options as BeadsWatcher
    // Debounce 5s (longer than Beads since docs edits are less frequent)
  }

  handleChange(projectIdentifier, projectPath, filePath, eventType) {
    // Filter: only .md, .html files + images/
    // Ignore: _meta.json (read-only metadata from exporter)
    // Add to pending, schedule debounced sync
  }

  async triggerSync(projectIdentifier, projectPath) {
    // Call onBookStackChange callback with changed files list
    // Callback triggers BookStack import for changed files
  }
}
```

### 6.7 SyncOrchestrator.js — Phase 4

Add a new phase to the existing orchestration loop:

```javascript
// PHASE 4: BookStack ↔ Filesystem (documentation sync)
if (config.bookstack?.enabled) {
  const bookstackService = getBookStackService();
  const docsDir = path.join(gitRepoPath, config.bookstack.docsSubdir);

  // Get the book mapping for this project
  const bookSlug = getBookMapping(projectIdentifier, config);
  if (!bookSlug) {
    log.debug({ project: projectIdentifier }, 'No BookStack book mapping, skipping');
  } else {
    // Phase 4a: BookStack → Filesystem (export)
    // Check if enough time has passed since last export
    const lastExport = db.getBookStackLastExport(projectIdentifier);
    const exportDue = !lastExport || Date.now() - lastExport > config.bookstack.syncInterval;

    if (exportDue) {
      log.info(
        { project: projectIdentifier, book: bookSlug },
        'Exporting BookStack content to filesystem'
      );
      await bookstackService.exportBook(bookSlug, docsDir);
      db.setBookStackLastExport(projectIdentifier, Date.now());
    }

    // Phase 4b: Filesystem → BookStack (import local changes)
    const changes = await bookstackService.detectChanges(docsDir, bookSlug, db);

    if (changes.toImport.length > 0) {
      log.info(
        { project: projectIdentifier, count: changes.toImport.length },
        'Importing local changes to BookStack'
      );
      for (const file of changes.toImport) {
        await bookstackService.importPage(file.localPath, bookSlug);
        db.updateBookStackPage(file.pageId, { last_import_at: Date.now() });
      }
    }

    if (changes.conflicts.length > 0) {
      log.warn(
        { project: projectIdentifier, count: changes.conflicts.length },
        'BookStack sync conflicts detected (BookStack wins by default)'
      );
      // Default: BookStack wins conflicts (it's the source of truth for docs)
    }
  }
}
```

### 6.8 Filesystem Layout

For each project with BookStack sync enabled:

```
/opt/stacks/{project}/
├── docs/
│   └── bookstack/                    ← Synced content lives here
│       └── {book-slug}/
│           ├── .book-metadata.json   ← From bookstack-file-exporter
│           ├── chapter-one/
│           │   ├── .chapter-metadata.json
│           │   ├── page-one.md
│           │   ├── page-one_meta.json  ← BookStack page ID, timestamps
│           │   └── images/
│           │       └── page-one/
│           │           └── architecture.png
│           └── standalone-page.md
├── .beads/                           ← Existing beads data
└── ...
```

### 6.9 Conflict Resolution Strategy

| Scenario                  | Both modified | Resolution                                    |
| ------------------------- | ------------- | --------------------------------------------- |
| BookStack only changed    | N/A           | Export to filesystem (overwrite local)        |
| Local only changed        | N/A           | Import to BookStack                           |
| Both changed              | Yes           | **BookStack wins** (source of truth for docs) |
| Page deleted in BookStack | N/A           | Remove local file                             |
| Local file deleted        | N/A           | Log warning, do NOT delete from BookStack     |

**Rationale**: BookStack is the canonical documentation platform. Multiple humans edit there. Local edits are typically agent-generated and should not override human changes.

### 6.10 Environment Variables

```bash
# BookStack Sync Configuration
BOOKSTACK_ENABLED=true
BOOKSTACK_URL=https://docs.oculair.ca
BOOKSTACK_TOKEN_ID=your-token-id
BOOKSTACK_TOKEN_SECRET=your-token-secret
BOOKSTACK_SYNC_INTERVAL=3600000           # 1 hour between full exports
BOOKSTACK_EXPORT_FORMATS=markdown
BOOKSTACK_EXPORT_IMAGES=true
BOOKSTACK_EXPORT_ATTACHMENTS=true
BOOKSTACK_EXPORT_META=true
BOOKSTACK_MODIFY_LINKS=true               # Rewrite image links to local paths
BOOKSTACK_DOCS_SUBDIR=docs/bookstack      # Where to store exported content
BOOKSTACK_PROJECT_BOOKS=HVSYN:huly-vibe-sync-service,GRAPH:graphiti-knowledge-graph
```

## 7. Sync Flow Diagram

```
Every sync cycle (per project):
┌─────────────────────────────────────────────────────────┐
│ Phase 1: Huly → Vibe         (existing)                │
│ Phase 2: Vibe → Huly         (existing)                │
│ Phase 3: Beads ↔ Huly        (existing)                │
│ Phase 4: BookStack ↔ Files   (NEW)                     │
│   4a. Check if export is due (interval-based)          │
│       → Run bookstack-file-exporter                    │
│       → Extract archive to docs/bookstack/             │
│       → Update bookstack_pages DB with hashes/times    │
│   4b. Detect local changes (hash comparison)           │
│       → Import changed .md files via bookstack-cli     │
│       → Update DB with import timestamps               │
│   4c. Resolve conflicts (BookStack wins)               │
└─────────────────────────────────────────────────────────┘

File watcher (continuous):
┌─────────────────────────────────────────────────────────┐
│ BookStackWatcher detects .md file change                │
│   → Debounce 5 seconds                                 │
│   → Trigger Phase 4b import for changed files only     │
└─────────────────────────────────────────────────────────┘
```

## 8. Dependencies

| Dependency                | Type                 | Purpose                           |
| ------------------------- | -------------------- | --------------------------------- |
| `@junovy/bookstack-cli`   | npm (runtime)        | CLI for import/export/search      |
| `bookstack-file-exporter` | Docker/pip (sidecar) | Automated full export with images |
| `chokidar`                | npm (existing)       | File watching                     |
| `better-sqlite3`          | npm (existing)       | Sync state tracking               |

**Note**: `bookstack-file-exporter` runs as a sidecar container or cron job, not embedded in Node.js. It writes to a shared volume that `BookStackService.js` reads from.

## 9. Deployment

### Docker Compose Addition

```yaml
services:
  bookstack-exporter:
    image: homeylab/bookstack-file-exporter:latest
    volumes:
      - ./bookstack-export-config.yml:/export/config/config.yml:ro
      - bookstack-exports:/export/dump
    restart: unless-stopped
    environment:
      - BOOKSTACK_TOKEN_ID=${BOOKSTACK_TOKEN_ID}
      - BOOKSTACK_TOKEN_SECRET=${BOOKSTACK_TOKEN_SECRET}

  huly-vibe-sync:
    # ... existing config ...
    volumes:
      - bookstack-exports:/bookstack-exports:ro # Read exports
    environment:
      - BOOKSTACK_ENABLED=true
      - BOOKSTACK_URL=https://docs.oculair.ca
      - BOOKSTACK_TOKEN_ID=${BOOKSTACK_TOKEN_ID}
      - BOOKSTACK_TOKEN_SECRET=${BOOKSTACK_TOKEN_SECRET}

volumes:
  bookstack-exports:
```

## 10. Phased Rollout

### Phase 1: Export Only (Pull)

- Set up `bookstack-file-exporter` sidecar
- Implement `BookStackService.exportBook()`
- Add `bookstack_pages` table
- Phase 4a in SyncOrchestrator (export on interval)
- **Deliverable**: BookStack docs appear in project `docs/bookstack/` dirs

### Phase 2: Import Support (Push)

- Add `@junovy/bookstack-cli` dependency
- Implement `BookStackService.importPage()` / `importDirectory()`
- Implement `BookStackWatcher` for local file changes
- Phase 4b in SyncOrchestrator (import local changes)
- **Deliverable**: Local .md edits flow back to BookStack

### Phase 3: Full Bidirectional Sync

- Change detection with content hashing
- Conflict resolution (BookStack wins)
- Agent-friendly CLI wrapper for search/query
- Metrics and health reporting
- **Deliverable**: Complete bidirectional sync with conflict handling

## 11. Resolved Questions

All open questions resolved by PM review (2026-01-29). See PM Review Decisions table at top of document.
