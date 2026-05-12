import type BetterSqlite3 from 'better-sqlite3';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface SqlMasterRow {
  name?: string;
  sql?: string;
}

export function migrateParentChildColumns(db: BetterSqlite3.Database): void {
  const columns = db.prepare('PRAGMA table_info(issues)').all() as ColumnInfo[];
  const columnNames = columns.map((c) => c.name);

  if (!columnNames.includes('parent_huly_id')) {
    console.log('[DB] Adding parent_huly_id column to issues table');
    db.exec('ALTER TABLE issues ADD COLUMN parent_huly_id TEXT');
  }

  if (!columnNames.includes('parent_vibe_id')) {
    console.log('[DB] Adding parent_vibe_id column to issues table');
    db.exec('ALTER TABLE issues ADD COLUMN parent_vibe_id TEXT');
  }

  if (!columnNames.includes('sub_issue_count')) {
    console.log('[DB] Adding sub_issue_count column to issues table');
    db.exec('ALTER TABLE issues ADD COLUMN sub_issue_count INTEGER DEFAULT 0');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_parent_huly ON issues(parent_huly_id);
    CREATE INDEX IF NOT EXISTS idx_issues_parent_vibe ON issues(parent_vibe_id);
  `);

  if (!columnNames.includes('content_hash')) {
    console.log('[DB] Adding content_hash column to issues table');
    db.exec('ALTER TABLE issues ADD COLUMN content_hash TEXT');
  }

  if (!columnNames.includes('huly_content_hash')) {
    console.log('[DB] Adding huly_content_hash column to issues table');
    db.exec('ALTER TABLE issues ADD COLUMN huly_content_hash TEXT');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_content_hash ON issues(content_hash);
  `);

  const projectColumns = db.prepare('PRAGMA table_info(projects)').all() as ColumnInfo[];
  const projectColumnNames = projectColumns.map((c) => c.name);

  if (!projectColumnNames.includes('huly_sync_cursor')) {
    console.log('[DB] Adding huly_sync_cursor column to projects table');
    db.exec('ALTER TABLE projects ADD COLUMN huly_sync_cursor TEXT');
  }
}

export function migrateDeletionColumns(db: BetterSqlite3.Database): void {
  const columns = db.prepare('PRAGMA table_info(issues)').all() as ColumnInfo[];
  const columnNames = columns.map((c) => c.name);

  if (!columnNames.includes('deleted_from_vibe')) {
    console.log('[DB] Adding deleted_from_vibe column to issues table');
    db.exec('ALTER TABLE issues ADD COLUMN deleted_from_vibe INTEGER DEFAULT 0');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_deleted_from_vibe ON issues(deleted_from_vibe);
  `);
}

export function migrateVibeIndexes(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_vibe_task_id ON issues(vibe_task_id);
    CREATE INDEX IF NOT EXISTS idx_issues_vibe_status ON issues(vibe_status);
  `);
}

export function migrateBookStackTables(db: BetterSqlite3.Database): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bookstack_pages'")
    .all() as SqlMasterRow[];

  if (tables.length > 0) {
    const fkCheck = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bookstack_pages'")
      .get() as SqlMasterRow | undefined;
    if (fkCheck?.sql?.includes('FOREIGN KEY')) {
      console.log('[DB] Recreating bookstack_pages without FK constraint');
      db.exec('DROP TABLE bookstack_pages');
    }
  }

  const tablesAfter = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bookstack_pages'")
    .all() as SqlMasterRow[];
  if (tablesAfter.length === 0) {
    console.log('[DB] Creating bookstack_pages table');
    db.exec(`
      CREATE TABLE bookstack_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bookstack_page_id INTEGER NOT NULL UNIQUE,
        bookstack_book_id INTEGER NOT NULL,
        bookstack_chapter_id INTEGER,
        project_identifier TEXT,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        local_path TEXT,
        content_hash TEXT,
        bookstack_modified_at TEXT,
        local_modified_at INTEGER,
        last_export_at INTEGER,
        last_import_at INTEGER,
        sync_direction TEXT,
        created_at INTEGER DEFAULT (unixepoch('now') * 1000),
        updated_at INTEGER DEFAULT (unixepoch('now') * 1000)
      );

      CREATE INDEX idx_bs_pages_project ON bookstack_pages(project_identifier);
      CREATE INDEX idx_bs_pages_bookstack_id ON bookstack_pages(bookstack_page_id);
      CREATE INDEX idx_bs_pages_slug ON bookstack_pages(slug);
      CREATE INDEX idx_bs_pages_local_path ON bookstack_pages(local_path);
    `);
  }

  const projectColumns = db.prepare('PRAGMA table_info(projects)').all() as ColumnInfo[];
  const colNames = projectColumns.map((c) => c.name);

  if (!colNames.includes('bookstack_last_export_at')) {
    db.exec('ALTER TABLE projects ADD COLUMN bookstack_last_export_at INTEGER');
  }
  if (!colNames.includes('bookstack_book_slug')) {
    db.exec('ALTER TABLE projects ADD COLUMN bookstack_book_slug TEXT');
  }

  const bsColumns = db.prepare('PRAGMA table_info(bookstack_pages)').all() as ColumnInfo[];
  const bsColNames = bsColumns.map((c) => c.name);

  if (!bsColNames.includes('bookstack_content_hash')) {
    db.exec('ALTER TABLE bookstack_pages ADD COLUMN bookstack_content_hash TEXT');
  }
  if (!bsColNames.includes('sync_status')) {
    db.exec("ALTER TABLE bookstack_pages ADD COLUMN sync_status TEXT DEFAULT 'synced'");
  }
  if (!bsColNames.includes('bookstack_revision_count')) {
    db.exec('ALTER TABLE bookstack_pages ADD COLUMN bookstack_revision_count INTEGER');
  }
}

export function migrateProjectRegistryColumns(db: BetterSqlite3.Database): void {
  const columns = db.prepare('PRAGMA table_info(projects)').all() as ColumnInfo[];
  const columnNames = columns.map((c) => c.name);

  if (!columnNames.includes('tech_stack')) {
    db.exec('ALTER TABLE projects ADD COLUMN tech_stack TEXT');
  }

  if (!columnNames.includes('last_scan_at')) {
    db.exec('ALTER TABLE projects ADD COLUMN last_scan_at INTEGER');
  }

  if (!columnNames.includes('mcp_enabled')) {
    db.exec('ALTER TABLE projects ADD COLUMN mcp_enabled INTEGER DEFAULT 1');
  }
}

export function migrateProjectBeadsRemoteColumns(db: BetterSqlite3.Database): void {
  const columns = db.prepare('PRAGMA table_info(projects)').all() as ColumnInfo[];
  const columnNames = columns.map((c) => c.name);

  const addColumn = (name: string, definition: string) => {
    if (!columnNames.includes(name)) {
      db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`);
    }
  };

  addColumn('beads_remote_owner', 'TEXT');
  addColumn('beads_remote_repo', 'TEXT');
  addColumn('beads_remote_url', 'TEXT');
  addColumn('beads_remote_name', 'TEXT');
  addColumn('beads_remote_status', 'TEXT');
  addColumn('beads_remote_visibility', 'TEXT');
  addColumn('beads_remote_provisioned_at', 'INTEGER');
  addColumn('beads_remote_last_push_at', 'INTEGER');
  addColumn('beads_remote_last_error', 'TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_projects_beads_remote_status ON projects(beads_remote_status);
  `);
}

export function migrateIssueMutationIdempotencyTable(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS issue_mutation_idempotency (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL,
      issue_identifier TEXT NOT NULL,
      action TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(idempotency_key, issue_identifier, action)
    );

    CREATE INDEX IF NOT EXISTS idx_issue_mutation_idempotency_issue
      ON issue_mutation_idempotency(issue_identifier);
  `);
}

export function runAllMigrations(db: BetterSqlite3.Database): void {
  migrateParentChildColumns(db);
  migrateBookStackTables(db);
  migrateDeletionColumns(db);
  migrateVibeIndexes(db);
  migrateProjectRegistryColumns(db);
  migrateProjectBeadsRemoteColumns(db);
  migrateIssueMutationIdempotencyTable(db);
}
