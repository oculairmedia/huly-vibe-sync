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
