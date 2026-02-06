/**
 * BookStack Bidirectional Sync - Conflict resolution and reconciliation
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../logger.js';

export function createBidirectionalMethods(service) {
  return {
    syncBidirectional: syncBidirectional.bind(service),
  };
}

export async function syncBidirectional(projectIdentifier, projectPath) {
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

  // 1. Process each remote page
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

      // Both changed -> CONFLICT -> BookStack wins
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

  // 2. Detect remote deletions
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

  // 3. Detect new local files
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
