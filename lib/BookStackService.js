import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from './logger.js';
import { createBookStackExporter } from './BookStackExporter.js';
import { createBookStackApiClient } from './BookStackApiClient.js';

export class BookStackService {
  constructor(config, db) {
    this.config = config;
    this.db = db;
    this.exporter = createBookStackExporter(config);
    this.apiClient = createBookStackApiClient(config);
    this.initialized = false;
    this.apiConnected = false;
    this.stats = {
      exportsCompleted: 0,
      exportsFailed: 0,
      pagesTracked: 0,
      apiExports: 0,
      archiverExports: 0,
    };
  }

  async initialize() {
    const archiveExists = this.exporter.getLatestArchive() !== null;

    const connectionTest = await this.apiClient.testConnection();
    this.apiConnected = connectionTest.connected;
    this.initialized = true;

    logger.info(
      {
        url: this.config.url,
        mappings: this.config.projectBookMappings.length,
        archiveExists,
        apiConnected: this.apiConnected,
        bookCount: connectionTest.bookCount || 0,
      },
      'BookStackService initialized'
    );

    return { archiveExists, apiConnected: this.apiConnected, bookCount: connectionTest.bookCount };
  }

  getBookSlugForProject(projectIdentifier) {
    const mapping = this.config.projectBookMappings.find(
      m => m.projectIdentifier === projectIdentifier
    );
    return mapping?.bookSlug || null;
  }

  async syncExport(projectIdentifier, projectPath) {
    const bookSlug = this.getBookSlugForProject(projectIdentifier);
    if (!bookSlug) {
      return { skipped: true, reason: 'no_mapping' };
    }

    const lastExport = this.db.getBookStackLastExport(projectIdentifier);
    const exportDue = !lastExport || Date.now() - lastExport > this.config.syncInterval;

    if (!exportDue) {
      return { skipped: true, reason: 'not_due' };
    }

    if (this.apiConnected) {
      return this.syncExportViaApi(projectIdentifier, projectPath, bookSlug);
    }
    return this.syncExportViaArchive(projectIdentifier, projectPath, bookSlug);
  }

  async syncExportViaApi(projectIdentifier, projectPath, bookSlug) {
    const startTime = Date.now();

    try {
      const books = await this.apiClient.listBooks();
      const book = books.find(
        b => b.slug === bookSlug || b.name.toLowerCase().replace(/\s+/g, '-') === bookSlug
      );

      if (!book) {
        logger.debug(
          { bookSlug, available: books.map(b => b.slug).slice(0, 10) },
          'Book not found'
        );
        return { success: false, reason: 'book_not_found' };
      }

      const contents = await this.apiClient.getBookContents(book.id);
      const docsDir = path.join(projectPath, this.config.docsSubdir, bookSlug);
      fs.mkdirSync(docsDir, { recursive: true });

      const bookMeta = {
        id: book.id,
        name: book.name,
        slug: book.slug,
        description: book.description,
        updated_at: book.updated_at,
      };
      fs.writeFileSync(
        path.join(docsDir, '.book-metadata.json'),
        JSON.stringify(bookMeta, null, 2)
      );

      const chapterMap = new Map();
      for (const chapter of contents.chapters) {
        chapterMap.set(chapter.id, chapter);
        const chapterDir = path.join(docsDir, chapter.slug);
        fs.mkdirSync(chapterDir, { recursive: true });

        const chapterMeta = {
          id: chapter.id,
          name: chapter.name,
          slug: chapter.slug,
          description: chapter.description,
        };
        fs.writeFileSync(
          path.join(chapterDir, '.chapter-metadata.json'),
          JSON.stringify(chapterMeta, null, 2)
        );
      }

      const exportedPages = [];

      for (const page of contents.pages) {
        try {
          const markdown = String(await this.apiClient.exportPageMarkdown(page.id));
          const chapter = page.chapter_id ? chapterMap.get(page.chapter_id) : null;
          const pageDir = chapter ? path.join(docsDir, chapter.slug) : docsDir;
          const filePath = path.join(pageDir, `${page.slug}.md`);
          const contentHash = crypto.createHash('sha256').update(markdown).digest('hex');

          let shouldWrite = true;
          if (fs.existsSync(filePath)) {
            const existing = fs.readFileSync(filePath, 'utf-8');
            const existingHash = crypto.createHash('sha256').update(existing).digest('hex');
            shouldWrite = contentHash !== existingHash;
          }

          if (shouldWrite) {
            fs.writeFileSync(filePath, markdown, 'utf-8');
          }

          const relativePath = path.relative(
            path.join(projectPath, this.config.docsSubdir),
            filePath
          );

          const pageData = {
            bookstack_page_id: page.id,
            bookstack_book_id: book.id,
            bookstack_chapter_id: page.chapter_id || null,
            project_identifier: projectIdentifier,
            slug: page.slug,
            title: page.name,
            local_path: relativePath,
            content_hash: contentHash,
            bookstack_modified_at: page.updated_at,
            local_modified_at: Date.now(),
            last_export_at: Date.now(),
            sync_direction: 'export',
          };

          this.db.upsertBookStackPage(pageData);
          this.stats.pagesTracked++;

          exportedPages.push({
            relativePath,
            contentHash,
            modified: shouldWrite,
            meta: {
              id: page.id,
              book_id: book.id,
              chapter_id: page.chapter_id,
              name: page.name,
              updated_at: page.updated_at,
            },
          });
        } catch (pageError) {
          logger.warn(
            { err: pageError, pageId: page.id, pageSlug: page.slug },
            'Failed to export page'
          );
        }
      }

      const duration = Date.now() - startTime;
      this.db.setBookStackLastExport(projectIdentifier, Date.now());
      this.stats.exportsCompleted++;
      this.stats.apiExports++;

      logger.info(
        {
          bookSlug,
          bookId: book.id,
          totalPages: contents.pages.length,
          chapters: contents.chapters.length,
          exported: exportedPages.length,
          modified: exportedPages.filter(p => p.modified).length,
          durationMs: duration,
        },
        'BookStack API export completed'
      );

      return { success: true, pages: exportedPages, duration, method: 'api' };
    } catch (error) {
      this.stats.exportsFailed++;
      logger.error({ err: error, bookSlug }, 'BookStack API export failed');
      return { success: false, reason: 'api_error', error: error.message };
    }
  }

  async syncExportViaArchive(projectIdentifier, projectPath, bookSlug) {
    const result = await this.exporter.exportToProject(projectPath, bookSlug);

    if (result.success) {
      this.db.setBookStackLastExport(projectIdentifier, Date.now());
      this.stats.exportsCompleted++;
      this.stats.archiverExports++;

      for (const page of result.pages) {
        const pageData = {
          bookstack_page_id: page.meta?.id || 0,
          bookstack_book_id: page.meta?.book_id || 0,
          bookstack_chapter_id: page.meta?.chapter_id || null,
          project_identifier: projectIdentifier,
          slug: path.basename(page.relativePath, path.extname(page.relativePath)),
          title:
            page.meta?.name || path.basename(page.relativePath, path.extname(page.relativePath)),
          local_path: page.relativePath,
          content_hash: page.contentHash,
          bookstack_modified_at: page.meta?.updated_at || null,
          local_modified_at: Date.now(),
          last_export_at: Date.now(),
          sync_direction: 'export',
        };

        if (pageData.bookstack_page_id) {
          this.db.upsertBookStackPage(pageData);
          this.stats.pagesTracked++;
        }
      }
    } else {
      this.stats.exportsFailed++;
    }

    return { ...result, method: 'archive' };
  }

  // ============================================================
  // IMPORT OPERATIONS (Phase 2 — Local → BookStack)
  // ============================================================

  async syncImport(projectIdentifier, projectPath) {
    const bookSlug = this.getBookSlugForProject(projectIdentifier);
    if (!bookSlug) {
      return { skipped: true, reason: 'no_mapping' };
    }

    if (!this.apiConnected) {
      return { skipped: true, reason: 'api_not_connected' };
    }

    const docsDir = path.join(projectPath, this.config.docsSubdir, bookSlug);
    if (!fs.existsSync(docsDir)) {
      return { skipped: true, reason: 'no_docs_dir' };
    }

    const changes = this.detectLocalChanges(projectIdentifier, docsDir);
    if (changes.length === 0) {
      return { skipped: true, reason: 'no_changes' };
    }

    const results = [];
    for (const change of changes) {
      try {
        const result = await this.importPage(projectIdentifier, change);
        results.push(result);
      } catch (err) {
        logger.warn({ err, file: change.localPath }, 'Failed to import page');
        results.push({ success: false, localPath: change.localPath, error: err.message });
      }
    }

    const imported = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    this.stats.importsCompleted = (this.stats.importsCompleted || 0) + imported;
    this.stats.importsFailed = (this.stats.importsFailed || 0) + failed;

    logger.info(
      { projectIdentifier, bookSlug, imported, failed, total: changes.length },
      'BookStack import completed'
    );

    return { success: failed === 0, results, imported, failed };
  }

  detectLocalChanges(projectIdentifier, docsDir) {
    const changes = [];
    const trackedPages = this.db.getBookStackPages(projectIdentifier);
    const pagesByPath = new Map(trackedPages.map(p => [p.local_path, p]));

    const files = this._walkMarkdownFiles(docsDir);
    const now = Date.now();

    for (const filePath of files) {
      const relFromDocsDir = path.relative(path.resolve(docsDir, '..'), filePath);

      const content = fs.readFileSync(filePath, 'utf-8');
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');

      const tracked = pagesByPath.get(relFromDocsDir);

      // Echo loop guard: skip files modified within 60s of last export
      if (tracked?.last_export_at && tracked.sync_direction === 'export') {
        const timeSinceExport = now - tracked.last_export_at;
        if (timeSinceExport < 60000) {
          logger.debug(
            { file: relFromDocsDir, timeSinceExport },
            'Skipping import - within 60s of last export (echo loop guard)'
          );
          continue;
        }
      }

      if (tracked) {
        // Existing page — check if content changed
        if (contentHash !== tracked.content_hash) {
          changes.push({
            type: 'update',
            localPath: relFromDocsDir,
            absolutePath: filePath,
            contentHash,
            content,
            tracked,
          });
        }
      } else {
        // New file — extract title from first heading
        const titleMatch = content.match(/^#\s+(.+)$/m);
        if (!titleMatch) {
          logger.warn({ file: relFromDocsDir }, 'Skipping new file - no # Title heading on line 1');
          continue;
        }

        changes.push({
          type: 'create',
          localPath: relFromDocsDir,
          absolutePath: filePath,
          contentHash,
          content,
          title: titleMatch[1].trim(),
        });
      }
    }

    return changes;
  }

  async importPage(projectIdentifier, change) {
    if (change.type === 'update' && change.tracked?.bookstack_page_id) {
      const result = await this.apiClient.updatePage(change.tracked.bookstack_page_id, {
        markdown: change.content,
      });

      this.db.upsertBookStackPage({
        ...change.tracked,
        content_hash: change.contentHash,
        local_modified_at: Date.now(),
        last_import_at: Date.now(),
        sync_direction: 'import',
      });

      logger.info(
        { pageId: result.id, slug: result.slug, path: change.localPath },
        'Updated page in BookStack'
      );

      return { success: true, type: 'update', pageId: result.id, localPath: change.localPath };
    }

    if (change.type === 'create') {
      // Determine book_id and chapter_id from directory structure
      const bookSlug = this.getBookSlugForProject(projectIdentifier);
      const books = await this.apiClient.listBooks();
      const book = books.find(
        b => b.slug === bookSlug || b.name.toLowerCase().replace(/\s+/g, '-') === bookSlug
      );

      if (!book) {
        return { success: false, localPath: change.localPath, error: 'book_not_found' };
      }

      // Check if file is inside a chapter directory
      const pathParts = change.localPath.split(path.sep);
      let chapterId = null;

      if (pathParts.length >= 3) {
        // Structure: bookSlug/chapterSlug/page.md
        const chapterSlug = pathParts[pathParts.length - 2];
        if (chapterSlug !== bookSlug) {
          const contents = await this.apiClient.getBookContents(book.id);
          const chapter = contents.chapters.find(c => c.slug === chapterSlug);

          if (chapter) {
            chapterId = chapter.id;
          } else {
            // Auto-create chapter
            const newChapter = await this.apiClient.createChapter({
              book_id: book.id,
              name: chapterSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            });
            chapterId = newChapter.id;
            logger.info(
              { chapterId: newChapter.id, name: newChapter.name },
              'Auto-created chapter in BookStack'
            );
          }
        }
      }

      const createData = {
        name: change.title,
        markdown: change.content,
      };

      if (chapterId) {
        createData.chapter_id = chapterId;
      } else {
        createData.book_id = book.id;
      }

      const result = await this.apiClient.createPage(createData);

      this.db.upsertBookStackPage({
        bookstack_page_id: result.id,
        bookstack_book_id: book.id,
        bookstack_chapter_id: chapterId,
        project_identifier: projectIdentifier,
        slug: result.slug,
        title: result.name,
        local_path: change.localPath,
        content_hash: change.contentHash,
        bookstack_modified_at: result.updated_at,
        local_modified_at: Date.now(),
        last_import_at: Date.now(),
        sync_direction: 'import',
      });

      logger.info(
        { pageId: result.id, slug: result.slug, title: result.name, path: change.localPath },
        'Created page in BookStack'
      );

      return { success: true, type: 'create', pageId: result.id, localPath: change.localPath };
    }

    return { success: false, localPath: change.localPath, error: 'unknown_change_type' };
  }

  async importSingleFile(projectIdentifier, filePath) {
    const bookSlug = this.getBookSlugForProject(projectIdentifier);
    if (!bookSlug) {
      return { skipped: true, reason: 'no_mapping' };
    }

    if (!this.apiConnected) {
      return { skipped: true, reason: 'api_not_connected' };
    }

    if (!fs.existsSync(filePath) || !filePath.endsWith('.md')) {
      return { skipped: true, reason: 'invalid_file' };
    }

    const docsDir = path.join(
      path.dirname(filePath).split(this.config.docsSubdir)[0],
      this.config.docsSubdir
    );

    const relFromDocsDir = path.relative(path.resolve(docsDir), filePath);

    const content = fs.readFileSync(filePath, 'utf-8');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const tracked = this.db.getBookStackPageByPath(relFromDocsDir);
    const now = Date.now();

    // Echo loop guard
    if (tracked?.last_export_at && tracked.sync_direction === 'export') {
      const timeSinceExport = now - tracked.last_export_at;
      if (timeSinceExport < 60000) {
        return { skipped: true, reason: 'echo_loop_guard', timeSinceExport };
      }
    }

    // No change
    if (tracked && contentHash === tracked.content_hash) {
      return { skipped: true, reason: 'no_change' };
    }

    const change = tracked
      ? {
          type: 'update',
          localPath: relFromDocsDir,
          absolutePath: filePath,
          contentHash,
          content,
          tracked,
        }
      : (() => {
          const titleMatch = content.match(/^#\s+(.+)$/m);
          if (!titleMatch) return null;
          return {
            type: 'create',
            localPath: relFromDocsDir,
            absolutePath: filePath,
            contentHash,
            content,
            title: titleMatch[1].trim(),
          };
        })();

    if (!change) {
      return { skipped: true, reason: 'no_title_heading' };
    }

    return this.importPage(projectIdentifier, change);
  }

  // ============================================================
  // BIDIRECTIONAL SYNC (Phase 3 — Conflict Resolution)
  // ============================================================

  async syncBidirectional(projectIdentifier, projectPath) {
    const bookSlug = this.getBookSlugForProject(projectIdentifier);
    if (!bookSlug) {
      return { skipped: true, reason: 'no_mapping' };
    }

    if (!this.apiConnected) {
      return { skipped: true, reason: 'api_not_connected' };
    }

    const docsDir = path.join(projectPath, this.config.docsSubdir, bookSlug);
    const trackedPages = this.db.getBookStackPages(projectIdentifier);
    const pagesByRemoteId = new Map(trackedPages.map(p => [p.bookstack_page_id, p]));
    const pagesByPath = new Map(trackedPages.map(p => [p.local_path, p]));

    const books = await this.apiClient.listBooks();
    const book = books.find(
      b => b.slug === bookSlug || b.name.toLowerCase().replace(/\s+/g, '-') === bookSlug
    );
    if (!book) {
      return { skipped: true, reason: 'book_not_found' };
    }

    const contents = await this.apiClient.getBookContents(book.id);
    const allRemotePages = this._flattenBookPages(contents);
    const remotePageIds = new Set(allRemotePages.map(p => p.id));

    const results = {
      exported: 0,
      imported: 0,
      conflicts: 0,
      remoteDeleted: 0,
      newRemote: 0,
      newLocal: 0,
      unchanged: 0,
      errors: 0,
    };

    // 1. Process each remote page — detect remote changes and conflicts
    for (const remotePage of allRemotePages) {
      try {
        const tracked = pagesByRemoteId.get(remotePage.id);

        if (!tracked) {
          await this._exportRemotePage(projectIdentifier, book, remotePage, docsDir);
          results.newRemote++;
          continue;
        }

        const remoteDetail = await this.apiClient.getPage(remotePage.id);
        const remoteMarkdown = remoteDetail.markdown || '';
        const remoteHash = crypto.createHash('sha256').update(remoteMarkdown).digest('hex');

        const localFilePath = path.join(path.resolve(docsDir, '..'), tracked.local_path);

        const localExists = fs.existsSync(localFilePath);
        let localHash = null;

        if (localExists) {
          const localContent = fs.readFileSync(localFilePath, 'utf-8');
          localHash = crypto.createHash('sha256').update(localContent).digest('hex');
        }

        const remoteChanged =
          remoteHash !== (tracked.bookstack_content_hash || tracked.content_hash);
        const localChanged = localExists && localHash !== tracked.content_hash;
        const localDeleted = !localExists;

        if (localDeleted && remoteChanged) {
          // Local deleted + remote exists → re-export from BookStack
          fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
          fs.writeFileSync(localFilePath, remoteMarkdown, 'utf-8');
          this.db.upsertBookStackPage({
            ...tracked,
            content_hash: remoteHash,
            bookstack_content_hash: remoteHash,
            bookstack_modified_at: remoteDetail.updated_at,
            bookstack_revision_count: remoteDetail.revision_count,
            local_modified_at: Date.now(),
            last_export_at: Date.now(),
            sync_direction: 'export',
            sync_status: 'synced',
          });
          results.exported++;
          logger.info(
            { pageId: remotePage.id, path: tracked.local_path },
            'Re-exported page (local was deleted)'
          );
          continue;
        }

        if (localDeleted && !remoteChanged) {
          // Local deleted + remote unchanged → leave deleted, warn
          logger.warn(
            { pageId: remotePage.id, path: tracked.local_path },
            'Local file deleted but remote unchanged - not deleting from BookStack'
          );
          results.unchanged++;
          continue;
        }

        if (!remoteChanged && !localChanged) {
          results.unchanged++;
          continue;
        }

        if (remoteChanged && !localChanged) {
          fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
          fs.writeFileSync(localFilePath, remoteMarkdown, 'utf-8');
          this.db.upsertBookStackPage({
            ...tracked,
            content_hash: remoteHash,
            bookstack_content_hash: remoteHash,
            bookstack_modified_at: remoteDetail.updated_at,
            bookstack_revision_count: remoteDetail.revision_count,
            local_modified_at: Date.now(),
            last_export_at: Date.now(),
            sync_direction: 'export',
            sync_status: 'synced',
          });
          results.exported++;
          continue;
        }

        if (localChanged && !remoteChanged) {
          const localContent = fs.readFileSync(localFilePath, 'utf-8');
          await this.apiClient.updatePage(tracked.bookstack_page_id, {
            markdown: localContent,
          });
          this.db.upsertBookStackPage({
            ...tracked,
            content_hash: localHash,
            bookstack_content_hash: localHash,
            local_modified_at: Date.now(),
            last_import_at: Date.now(),
            sync_direction: 'import',
            sync_status: 'synced',
          });
          results.imported++;
          continue;
        }

        // Both changed → CONFLICT → BookStack wins
        logger.warn(
          {
            pageId: remotePage.id,
            path: tracked.local_path,
            localHash,
            remoteHash,
            storedHash: tracked.content_hash,
          },
          'Conflict detected - both local and remote changed. BookStack wins.'
        );

        fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
        fs.writeFileSync(localFilePath, remoteMarkdown, 'utf-8');
        this.db.upsertBookStackPage({
          ...tracked,
          content_hash: remoteHash,
          bookstack_content_hash: remoteHash,
          bookstack_modified_at: remoteDetail.updated_at,
          bookstack_revision_count: remoteDetail.revision_count,
          local_modified_at: Date.now(),
          last_export_at: Date.now(),
          sync_direction: 'export',
          sync_status: 'synced',
        });
        results.conflicts++;
        this.stats.conflictsDetected = (this.stats.conflictsDetected || 0) + 1;
        this.stats.conflictsResolved = (this.stats.conflictsResolved || 0) + 1;
      } catch (err) {
        logger.error({ err, pageId: remotePage.id }, 'Error processing page in bidirectional sync');
        results.errors++;
      }
    }

    // 2. Detect remote deletions — pages in DB but not in BookStack
    for (const tracked of trackedPages) {
      if (!remotePageIds.has(tracked.bookstack_page_id)) {
        const localFilePath = path.join(path.resolve(docsDir, '..'), tracked.local_path);
        if (fs.existsSync(localFilePath)) {
          fs.unlinkSync(localFilePath);
          logger.info(
            { pageId: tracked.bookstack_page_id, path: tracked.local_path },
            'Removed local file - page deleted from BookStack'
          );
        }
        this.db.upsertBookStackPage({
          ...tracked,
          sync_status: 'deleted_remote',
          sync_direction: 'export',
        });
        results.remoteDeleted++;
        this.stats.remoteDeleted = (this.stats.remoteDeleted || 0) + 1;
      }
    }

    // 3. Detect new local files — on disk but not tracked
    if (fs.existsSync(docsDir)) {
      const localFiles = this._walkMarkdownFiles(docsDir);
      for (const filePath of localFiles) {
        const relFromDocsDir = path.relative(path.resolve(docsDir, '..'), filePath);
        if (!pagesByPath.has(relFromDocsDir)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          const titleMatch = content.match(/^#\s+(.+)$/m);
          if (!titleMatch) {
            logger.warn({ file: relFromDocsDir }, 'Skipping new local file - no # Title heading');
            continue;
          }
          try {
            await this.importPage(projectIdentifier, {
              type: 'create',
              localPath: relFromDocsDir,
              absolutePath: filePath,
              contentHash: crypto.createHash('sha256').update(content).digest('hex'),
              content,
              title: titleMatch[1].trim(),
            });
            results.newLocal++;
          } catch (err) {
            logger.error({ err, file: relFromDocsDir }, 'Failed to import new local file');
            results.errors++;
          }
        }
      }
    }

    this.stats.bidirectionalSyncs = (this.stats.bidirectionalSyncs || 0) + 1;

    logger.info({ projectIdentifier, bookSlug, ...results }, 'Bidirectional sync completed');

    return { success: results.errors === 0, ...results };
  }

  _flattenBookPages(contents) {
    const pages = [];
    for (const item of contents.chapters || []) {
      if (item.pages) {
        pages.push(...item.pages);
      }
    }
    for (const item of contents.pages || []) {
      pages.push(item);
    }
    return pages;
  }

  async _exportRemotePage(projectIdentifier, book, remotePage, docsDir) {
    const detail = await this.apiClient.getPage(remotePage.id);
    const markdown = detail.markdown || '';
    const contentHash = crypto.createHash('sha256').update(markdown).digest('hex');

    const chapterSlug = remotePage.chapter_id
      ? (await this.apiClient.getBookContents(book.id)).chapters.find(
          c => c.id === remotePage.chapter_id
        )?.slug
      : null;

    const localDir = chapterSlug ? path.join(docsDir, chapterSlug) : docsDir;

    fs.mkdirSync(localDir, { recursive: true });
    const localFilePath = path.join(localDir, `${detail.slug}.md`);
    fs.writeFileSync(localFilePath, markdown, 'utf-8');

    const relFromDocsDir = path.relative(path.resolve(docsDir, '..'), localFilePath);

    this.db.upsertBookStackPage({
      bookstack_page_id: detail.id,
      bookstack_book_id: book.id,
      bookstack_chapter_id: remotePage.chapter_id || null,
      project_identifier: projectIdentifier,
      slug: detail.slug,
      title: detail.name,
      local_path: relFromDocsDir,
      content_hash: contentHash,
      bookstack_content_hash: contentHash,
      bookstack_modified_at: detail.updated_at,
      bookstack_revision_count: detail.revision_count,
      local_modified_at: Date.now(),
      last_export_at: Date.now(),
      sync_direction: 'export',
      sync_status: 'synced',
    });

    logger.info(
      { pageId: detail.id, slug: detail.slug, path: relFromDocsDir },
      'Exported new remote page to local'
    );
  }

  _walkMarkdownFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        results.push(...this._walkMarkdownFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  getHealthInfo() {
    return {
      enabled: this.config.enabled,
      initialized: this.initialized,
      apiConnected: this.apiConnected,
      url: this.config.url,
      mappings: this.config.projectBookMappings.length,
      syncInterval: `${this.config.syncInterval / 1000}s`,
      exporterStats: this.exporter.getStats(),
      serviceStats: { ...this.stats },
      bidirectionalSync: this.config.bidirectionalSync || false,
      conflictsDetected: this.stats.conflictsDetected || 0,
      conflictsResolved: this.stats.conflictsResolved || 0,
      remoteDeleted: this.stats.remoteDeleted || 0,
      bidirectionalSyncs: this.stats.bidirectionalSyncs || 0,
    };
  }

  getStats() {
    return {
      ...this.stats,
      exporter: this.exporter.getStats(),
    };
  }
}

export function createBookStackService(config, db) {
  return new BookStackService(config, db);
}
