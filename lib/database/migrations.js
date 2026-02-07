/**
 * Database Migrations
 *
 * Schema migrations for the sync state SQLite database.
 * Each migration is idempotent (checks before adding columns/tables).
 */

/**
 * Add parent-child columns, content hash columns, and huly_sync_cursor to issues/projects.
 * @param {import('better-sqlite3').Database} db
 */
export function migrateParentChildColumns(db) {
  const columns = db.prepare('PRAGMA table_info(issues)').all();
  const columnNames = columns.map(c => c.name);

  if (!columnNames.includes('parent_huly_id')) {
    console.log('[DB] Adding parent_huly_id column to issues table');
    db.exec(`ALTER TABLE issues ADD COLUMN parent_huly_id TEXT`);
  }

  if (!columnNames.includes('parent_vibe_id')) {
    console.log('[DB] Adding parent_vibe_id column to issues table');
    db.exec(`ALTER TABLE issues ADD COLUMN parent_vibe_id TEXT`);
  }

  if (!columnNames.includes('parent_beads_id')) {
    console.log('[DB] Adding parent_beads_id column to issues table');
    db.exec(`ALTER TABLE issues ADD COLUMN parent_beads_id TEXT`);
  }

  if (!columnNames.includes('sub_issue_count')) {
    console.log('[DB] Adding sub_issue_count column to issues table');
    db.exec(`ALTER TABLE issues ADD COLUMN sub_issue_count INTEGER DEFAULT 0`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_parent_huly ON issues(parent_huly_id);
    CREATE INDEX IF NOT EXISTS idx_issues_parent_vibe ON issues(parent_vibe_id);
    CREATE INDEX IF NOT EXISTS idx_issues_parent_beads ON issues(parent_beads_id);
  `);

  if (!columnNames.includes('content_hash')) {
    console.log('[DB] Adding content_hash column to issues table');
    db.exec(`ALTER TABLE issues ADD COLUMN content_hash TEXT`);
  }

  if (!columnNames.includes('huly_content_hash')) {
    console.log('[DB] Adding huly_content_hash column to issues table');
    db.exec(`ALTER TABLE issues ADD COLUMN huly_content_hash TEXT`);
  }

  if (!columnNames.includes('beads_content_hash')) {
    console.log('[DB] Adding beads_content_hash column to issues table');
    db.exec(`ALTER TABLE issues ADD COLUMN beads_content_hash TEXT`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_content_hash ON issues(content_hash);
  `);

  const projectColumns = db.prepare('PRAGMA table_info(projects)').all();
  const projectColumnNames = projectColumns.map(c => c.name);

  if (!projectColumnNames.includes('huly_sync_cursor')) {
    console.log('[DB] Adding huly_sync_cursor column to projects table');
    db.exec(`ALTER TABLE projects ADD COLUMN huly_sync_cursor TEXT`);
  }
}

/**
 * Add deletion tracking columns to issues table.
 * @param {import('better-sqlite3').Database} db
 */
export function migrateDeletionColumns(db) {
  const columns = db.prepare('PRAGMA table_info(issues)').all();
  const columnNames = columns.map(c => c.name);

  if (!columnNames.includes('deleted_from_vibe')) {
    console.log('[DB] Adding deleted_from_vibe column to issues table');
    db.exec(`ALTER TABLE issues ADD COLUMN deleted_from_vibe INTEGER DEFAULT 0`);
  }

  if (!columnNames.includes('deleted_from_beads')) {
    console.log('[DB] Adding deleted_from_beads column to issues table');
    db.exec(`ALTER TABLE issues ADD COLUMN deleted_from_beads INTEGER DEFAULT 0`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_deleted_from_vibe ON issues(deleted_from_vibe);
    CREATE INDEX IF NOT EXISTS idx_issues_deleted_from_beads ON issues(deleted_from_beads);
  `);
}

/**
 * Add indexes used by Vibe task/status lookups.
 * @param {import('better-sqlite3').Database} db
 */
export function migrateVibeIndexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_vibe_task_id ON issues(vibe_task_id);
    CREATE INDEX IF NOT EXISTS idx_issues_vibe_status ON issues(vibe_status);
  `);
}

/**
 * Create or migrate BookStack tables and columns.
 * @param {import('better-sqlite3').Database} db
 */
export function migrateBookStackTables(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bookstack_pages'")
    .all();

  if (tables.length > 0) {
    const fkCheck = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bookstack_pages'")
      .get();
    if (fkCheck?.sql?.includes('FOREIGN KEY')) {
      console.log('[DB] Recreating bookstack_pages without FK constraint');
      db.exec('DROP TABLE bookstack_pages');
    }
  }

  const tablesAfter = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bookstack_pages'")
    .all();
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

  const projectColumns = db.prepare('PRAGMA table_info(projects)').all();
  const colNames = projectColumns.map(c => c.name);

  if (!colNames.includes('bookstack_last_export_at')) {
    console.log('[DB] Adding bookstack_last_export_at column to projects table');
    db.exec('ALTER TABLE projects ADD COLUMN bookstack_last_export_at INTEGER');
  }
  if (!colNames.includes('bookstack_book_slug')) {
    console.log('[DB] Adding bookstack_book_slug column to projects table');
    db.exec('ALTER TABLE projects ADD COLUMN bookstack_book_slug TEXT');
  }

  const bsColumns = db.prepare('PRAGMA table_info(bookstack_pages)').all();
  const bsColNames = bsColumns.map(c => c.name);

  if (!bsColNames.includes('bookstack_content_hash')) {
    console.log('[DB] Adding bookstack_content_hash column to bookstack_pages table');
    db.exec('ALTER TABLE bookstack_pages ADD COLUMN bookstack_content_hash TEXT');
  }
  if (!bsColNames.includes('sync_status')) {
    console.log('[DB] Adding sync_status column to bookstack_pages table');
    db.exec("ALTER TABLE bookstack_pages ADD COLUMN sync_status TEXT DEFAULT 'synced'");
  }
  if (!bsColNames.includes('bookstack_revision_count')) {
    console.log('[DB] Adding bookstack_revision_count column to bookstack_pages table');
    db.exec('ALTER TABLE bookstack_pages ADD COLUMN bookstack_revision_count INTEGER');
  }
}

/**
 * Run all migrations in order.
 * @param {import('better-sqlite3').Database} db
 */
export function runAllMigrations(db) {
  migrateParentChildColumns(db);
  migrateBookStackTables(db);
  migrateDeletionColumns(db);
  migrateVibeIndexes(db);
}
