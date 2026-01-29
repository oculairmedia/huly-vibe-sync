import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from './logger.js';
import { recordApiLatency } from './HealthService.js';

export class BookStackExporter {
  constructor(config) {
    this.config = config;
    this.exporterOutputPath = config.exporterOutputPath;
    this.stats = {
      lastExportAt: null,
      lastExportDuration: null,
      totalExports: 0,
      errors: 0,
    };
  }

  getLatestArchive() {
    if (!fs.existsSync(this.exporterOutputPath)) {
      return null;
    }

    const files = fs
      .readdirSync(this.exporterOutputPath)
      .filter(f => f.startsWith('bookstack_export_') && f.endsWith('.tgz'))
      .sort()
      .reverse();

    return files.length > 0 ? path.join(this.exporterOutputPath, files[0]) : null;
  }

  extractArchive(archivePath, outputDir) {
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

  async exportToProject(projectPath, bookSlug) {
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
        'BookStack export completed'
      );

      return { success: true, pages, duration };
    } catch (error) {
      this.stats.errors++;
      const duration = Date.now() - startTime;
      recordApiLatency('bookstack', 'export', duration);
      logger.error({ err: error, bookSlug }, 'BookStack export failed');
      return { success: false, reason: 'error', error: error.message };
    }
  }

  findBookDir(extractDir, bookSlug) {
    const slugNormalized = bookSlug.toLowerCase().replace(/[^a-z0-9-]/g, '');

    const searchDirs = (dir, depth = 0) => {
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

  syncDirectory(sourceDir, targetDir) {
    const pages = [];
    this.walkAndSync(sourceDir, targetDir, sourceDir, pages);
    return pages;
  }

  walkAndSync(currentSource, targetRoot, sourceRoot, pages) {
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
          let meta = null;
          if (fs.existsSync(metaPath)) {
            try {
              meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
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

  cleanup(dir) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // cleanup failure is non-fatal
    }
  }

  getStats() {
    return { ...this.stats };
  }
}

export function createBookStackExporter(config) {
  return new BookStackExporter(config);
}
