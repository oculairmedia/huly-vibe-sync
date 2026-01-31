export class BookStackRepository {
  constructor(db) {
    this.db = db;
  }

  getBookStackLastExport(projectIdentifier) {
    const row = this.db
      .prepare('SELECT bookstack_last_export_at FROM projects WHERE identifier = ?')
      .get(projectIdentifier);
    return row?.bookstack_last_export_at || null;
  }

  setBookStackLastExport(projectIdentifier, timestamp) {
    this.db
      .prepare('UPDATE projects SET bookstack_last_export_at = ? WHERE identifier = ?')
      .run(timestamp, projectIdentifier);
  }

  upsertBookStackPage(page) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO bookstack_pages
        (bookstack_page_id, bookstack_book_id, bookstack_chapter_id, project_identifier,
         slug, title, local_path, content_hash, bookstack_modified_at,
         local_modified_at, last_export_at, last_import_at, sync_direction,
         bookstack_content_hash, sync_status, bookstack_revision_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bookstack_page_id) DO UPDATE SET
          title = excluded.title,
          local_path = excluded.local_path,
          content_hash = excluded.content_hash,
          bookstack_modified_at = excluded.bookstack_modified_at,
          local_modified_at = excluded.local_modified_at,
          last_export_at = excluded.last_export_at,
          last_import_at = excluded.last_import_at,
          sync_direction = excluded.sync_direction,
          bookstack_content_hash = excluded.bookstack_content_hash,
          sync_status = excluded.sync_status,
          bookstack_revision_count = excluded.bookstack_revision_count,
          updated_at = ?`
      )
      .run(
        page.bookstack_page_id,
        page.bookstack_book_id,
        page.bookstack_chapter_id || null,
        page.project_identifier || null,
        page.slug,
        page.title,
        page.local_path || null,
        page.content_hash || null,
        page.bookstack_modified_at || null,
        page.local_modified_at || null,
        page.last_export_at || null,
        page.last_import_at || null,
        page.sync_direction || 'export',
        page.bookstack_content_hash || null,
        page.sync_status || 'synced',
        page.bookstack_revision_count || null,
        now,
        now
      );
  }

  getBookStackPages(projectIdentifier) {
    return this.db
      .prepare('SELECT * FROM bookstack_pages WHERE project_identifier = ?')
      .all(projectIdentifier);
  }

  getBookStackPageByPath(localPath) {
    return this.db.prepare('SELECT * FROM bookstack_pages WHERE local_path = ?').get(localPath);
  }
}
