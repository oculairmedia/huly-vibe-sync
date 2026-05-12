import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from '../logger';
import type { BookStackApiClient } from '../BookStackApiClient';
import type { BookStackPage, BookStackChapter, BookStackBook } from '../BookStackApiClient';

interface TrackedPage {
  bookstack_page_id: number;
  bookstack_book_id?: number;
  bookstack_chapter_id?: number | null;
  slug: string;
  title: string;
  local_path: string;
  content_hash: string;
  bookstack_modified_at?: string;
  local_modified_at?: number;
  last_export_at?: number;
  last_import_at?: number;
  sync_direction: string;
  sync_status?: string;
  bookstack_content_hash?: string;
  bookstack_revision_count?: number;
  [key: string]: unknown;
}

interface PageContents {
  chapters: { data: (BookStackChapter & { pages?: BookStackPage[] })[] };
  pages: { data: BookStackPage[] };
}

interface ChangeResult {
  type: string;
  localPath: string;
  absolutePath: string;
  contentHash: string;
  content?: string;
  title?: string;
  tracked?: TrackedPage;
}

interface ImportResult {
  success: boolean;
  type?: string;
  pageId?: number;
  localPath: string;
  error?: string;
}

interface ServiceContext {
  config: { docsSubdir: string; enabled?: boolean };
  db: {
    getBookStackPages: (projectId: string) => TrackedPage[];
    upsertBookStackPage: (data: Record<string, unknown>) => void;
    getBookStackPageByPath: (path: string) => TrackedPage | null;
    setBookStackLastExport?: (projectId: string, ts: number) => void;
    getBookStackLastExport?: (projectId: string) => number | null;
  };
  stats: Record<string, number>;
  apiClient: BookStackApiClient;
  exporter?: { exportToProject: (projectPath: string, bookSlug: string) => Promise<{ success: boolean; pages?: Array<{ relativePath: string; contentHash: string; modified: boolean; meta: Record<string, unknown> | null }>; duration?: number; reason?: string; error?: string }> };
  getBookSlugForProject: (projectId: string) => string | null;
  importPage?: (projectId: string, change: ChangeResult) => Promise<ImportResult>;
}

function _flattenBookPages(contents: PageContents): BookStackPage[] {
  const pages: BookStackPage[] = [];
  for (const item of contents.chapters?.data || []) {
    if (item.pages) {
      pages.push(...item.pages);
    }
  }
  for (const item of contents.pages?.data || []) {
    pages.push(item);
  }
  return pages;
}

async function _exportRemotePage(
  this: ServiceContext,
  projectIdentifier: string,
  book: BookStackBook,
  remotePage: BookStackPage,
  docsDir: string,
): Promise<void> {
  const detail = await this.apiClient.getPage(remotePage.id);
  const markdown = detail.markdown || '';
  const contentHash = crypto.createHash('sha256').update(markdown).digest('hex');

  let chapterSlug: string | null = null;
  if (remotePage.chapter_id) {
    const contents = await this.apiClient.getBookContents(book.id);
    const chapter = contents.chapters.data.find(
      (c) => c.id === remotePage.chapter_id,
    );
    chapterSlug = chapter?.slug ?? null;
  }

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
    'Exported new remote page to local',
  );
}

function _walkMarkdownFiles(this: ServiceContext, dir: string): string[] {
  const results: string[] = [];
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

export { _flattenBookPages, _exportRemotePage, _walkMarkdownFiles };
