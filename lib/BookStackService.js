/**
 * BookStack Service — Facade
 *
 * Delegates export, import, and bidirectional sync to sub-modules.
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { createBookStackExporter } from './BookStackExporter.js';
import { createBookStackApiClient } from './BookStackApiClient.js';
import { createExportMethods } from './bookstack/BookStackSyncExporter.js';
import { createImportMethods } from './bookstack/BookStackSyncImporter.js';
import { createBidirectionalMethods } from './bookstack/BookStackBidirectional.js';

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

    // Mix in methods from sub-modules
    const exportMethods = createExportMethods(this);
    this.syncExportViaApi = exportMethods.syncExportViaApi;
    this.syncExportViaArchive = exportMethods.syncExportViaArchive;
    this._flattenBookPages = exportMethods._flattenBookPages;
    this._exportRemotePage = exportMethods._exportRemotePage;

    const importMethods = createImportMethods(this);
    this.detectLocalChanges = importMethods.detectLocalChanges;
    this.importPage = importMethods.importPage;
    this.importSingleFile = importMethods.importSingleFile;
    this._walkMarkdownFiles = importMethods._walkMarkdownFiles;

    const bidirectionalMethods = createBidirectionalMethods(this);
    this.syncBidirectional = bidirectionalMethods.syncBidirectional;
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
