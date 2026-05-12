import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from './logger';
import { recordApiLatency } from './HealthService.js';

interface ExporterConfig {
  exporterOutputPath: string;
  docsSubdir: string;
}

interface ExporterStats {
  lastExportAt: number | null;
  lastExportDuration: number | null;
  totalExports: number;
  errors: number;
}

interface ExportResult {
  success: boolean;
  reason?: string;
  pages?: ExportPage[];
  duration?: number;
  error?: string;
}

interface ExportPage {
  relativePath: string;
  contentHash: string;
  modified: boolean;
  meta: Record<string, unknown> | null;
}

export class BookStackExporter {
  private config: ExporterConfig;
  private exporterOutputPath: string;
  private stats: ExporterStats;

  constructor(config: ExporterConfig) {
    this.config = config;
    this.exporterOutputPath = config.exporterOutputPath;
    this.stats = {
      lastExportAt: null,
      lastExportDuration: null,
      totalExports: 0,
      errors: 0,
    };
  }

  getLatestArchive(): string | null {
    if (!fs.existsSync(this.exporterOutputPath)) {
      return null;
    }

    const files = fs
      .readdirSync(this.exporterOutputPath)
      .filter((f) => f.startsWith('bookstack_export_') && f.endsWith('.tgz'))
      .sort()
      .reverse();

    return files.length > 0 ? path.join(this.exporterOutputPath, files[0]!) : null;
  }

  extractArchive(archivePath: string, outputDir: string): boolean {
    fs.mkdirSync(outputDir, { recursive: true });

    try {
      execSync(`tar -xzf "${archivePath}" -C "${outputDir}"`, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
      });
      return true;
    } catch (error) {
      logger.error({ err: error, archive: archivePath }, 'Failed to extract BookStack archive');
      return false;
    }
  }

  async exportToProject(projectPath: string, bookSlug: string): Promise<ExportResult> {
    const startTime = Date.now();
    const docsDir = path.join(projectPath, this.config.docsSubdir);

    try {
      const archivePath = this.getLatestArchive();
      if (!archivePath) {
        logger.debug('No BookStack export archive found');
        return { success: false, reason: 'no_archive' };
      }

      const tempDir = path.join(projectPath, '.bookstack-extract-tmp');
      const extracted = this.extractArchive(archivePath, tempDir);
      if (!extracted) {
        return { success: false, reason: 'extract_failed' };
      }

      const bookDir = this.findBookDir(tempDir, bookSlug);
      if (!bookDir) {
        this.cleanup(tempDir);
        logger.debug({ bookSlug }, 'Book not found in export archive');
        return { success: false, reason: 'book_not_found' };
      }

      const targetDir = path.join(docsDir, bookSlug);
      fs.mkdirSync(targetDir, { recursive: true });

      const pages = this.syncDirectory(bookDir, targetDir);

      this.cleanup(tempDir);

      const duration = Date.now() - startTime;
      recordApiLatency('bookstack', 'export', duration);

      this.stats.lastExportAt = Date.now();
      this.stats.lastExportDuration = duration;
      this.stats.totalExports++;

      logger.info(
        { bookSlug, pages: pages.length, durationMs: duration },
        'BookStack export completed',
      );

      return { success: true, pages, duration };
    } catch (error) {
      this.stats.errors++;
      const duration = Date.now() - startTime;
      recordApiLatency('bookstack', 'export', duration);
      logger.error({ err: error, bookSlug }, 'BookStack export failed');
      return { success: false, reason: 'error', error: (error as Error).message };
    }
  }

  private findBookDir(extractDir: string, bookSlug: string): string | null {
    const slugNormalized = bookSlug.toLowerCase().replace(/[^a-z0-9-]/g, '');

    const searchDirs = (dir: string, depth: number = 0): string | null => {
      if (depth > 3) return null;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const entryNormalized = entry.name.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (entryNormalized === slugNormalized) {
          return path.join(dir, entry.name);
        }
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        const found = searchDirs(path.join(dir, entry.name), depth + 1);
        if (found) return found;
      }

      return null;
    };

    return searchDirs(extractDir);
  }

  private syncDirectory(sourceDir: string, targetDir: string): ExportPage[] {
    const pages: ExportPage[] = [];
    this.walkAndSync(sourceDir, targetDir, sourceDir, pages);
    return pages;
  }

  private walkAndSync(
    currentSource: string,
    targetRoot: string,
    sourceRoot: string,
    pages: ExportPage[],
  ): void {
    const entries = fs.readdirSync(currentSource, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(currentSource, entry.name);
      const relativePath = path.relative(sourceRoot, sourcePath);
      const targetPath = path.join(targetRoot, relativePath);

      if (entry.isDirectory()) {
        fs.mkdirSync(targetPath, { recursive: true });
        this.walkAndSync(sourcePath, targetRoot, sourceRoot, pages);
      } else {
        const targetDir = path.dirname(targetPath);
        fs.mkdirSync(targetDir, { recursive: true });

        const sourceContent = fs.readFileSync(sourcePath);
        const sourceHash = crypto.createHash('sha256').update(sourceContent).digest('hex');

        let shouldWrite = true;
        if (fs.existsSync(targetPath)) {
          const existingContent = fs.readFileSync(targetPath);
          const existingHash = crypto.createHash('sha256').update(existingContent).digest('hex');
          shouldWrite = sourceHash !== existingHash;
        }

        if (shouldWrite) {
          fs.writeFileSync(targetPath, sourceContent);
        }

        if (
          entry.name.endsWith('.md') ||
          entry.name.endsWith('.html') ||
          entry.name.endsWith('.txt')
        ) {
          const metaPath = sourcePath.replace(/\.[^.]+$/, '_meta.json');
          let meta: Record<string, unknown> | null = null;
          if (fs.existsSync(metaPath)) {
            try {
              meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
            } catch {
              // meta parse failure is non-fatal
            }
          }

          pages.push({
            relativePath,
            contentHash: sourceHash,
            modified: shouldWrite,
            meta,
          });
        }
      }
    }
  }

  private cleanup(dir: string): void {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // cleanup failure is non-fatal
    }
  }

  getStats(): ExporterStats {
    return { ...this.stats };
  }
}

export function createBookStackExporter(config: ExporterConfig): BookStackExporter {
  return new BookStackExporter(config);
}
