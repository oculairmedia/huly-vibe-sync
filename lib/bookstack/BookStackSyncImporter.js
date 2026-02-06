/**
 * BookStack Sync Importer - Import operations (local -> BookStack)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../logger.js';

export function createImportMethods(service) {
  return {
    detectLocalChanges: detectLocalChanges.bind(service),
    importPage: importPage.bind(service),
    importSingleFile: importSingleFile.bind(service),
    _walkMarkdownFiles: _walkMarkdownFiles.bind(service),
  };
}

export function detectLocalChanges(projectIdentifier, docsDir) {
  const changes = [];
  const trackedPages = this.db.getBookStackPages(projectIdentifier);
  const pagesByPath = new Map(trackedPages.map(p => [p.local_path, p]));

  const files = _walkMarkdownFiles.call(this, docsDir);
  const now = Date.now();

  for (const filePath of files) {
    const relFromDocsDir = path.relative(path.resolve(docsDir, '..'), filePath);

    const content = fs.readFileSync(filePath, 'utf-8');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const tracked = pagesByPath.get(relFromDocsDir);

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

export async function importPage(projectIdentifier, change) {
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
    const bookSlug = this.getBookSlugForProject(projectIdentifier);
    const books = await this.apiClient.listBooks();
    const book = books.find(
      b => b.slug === bookSlug || b.name.toLowerCase().replace(/\s+/g, '-') === bookSlug
    );

    if (!book) {
      return { success: false, localPath: change.localPath, error: 'book_not_found' };
    }

    const pathParts = change.localPath.split(path.sep);
    let chapterId = null;

    if (pathParts.length >= 3) {
      const chapterSlug = pathParts[pathParts.length - 2];
      if (chapterSlug !== bookSlug) {
        const contents = await this.apiClient.getBookContents(book.id);
        const chapter = contents.chapters.find(c => c.slug === chapterSlug);

        if (chapter) {
          chapterId = chapter.id;
        } else {
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

export async function importSingleFile(projectIdentifier, filePath) {
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

  if (tracked?.last_export_at && tracked.sync_direction === 'export') {
    const timeSinceExport = now - tracked.last_export_at;
    if (timeSinceExport < 60000) {
      return { skipped: true, reason: 'echo_loop_guard', timeSinceExport };
    }
  }

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

  return importPage.call(this, projectIdentifier, change);
}

export function _walkMarkdownFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      results.push(..._walkMarkdownFiles.call(this, fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}
