/**
 * FileWatcher Service
 *
 * Watches project directories for file changes and triggers incremental uploads to Letta.
 * Much more efficient than periodic full scans - only processes files that actually changed.
 */

import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { logger } from './logger.js';

export class FileWatcher {
  constructor(lettaService, db, options = {}) {
    this.lettaService = lettaService;
    this.db = db;

    // Configuration
    this.debounceMs = options.debounceMs || 1000;  // Wait 1s after last change before processing
    this.batchIntervalMs = options.batchIntervalMs || 5000;  // Process batch every 5s
    this.maxBatchSize = options.maxBatchSize || 50;  // Max files per batch

    // File extension filter (same as LettaService.discoverProjectFiles)
    this.allowedExtensions = new Set([
      '.md', '.txt', '.json', '.yaml', '.yml', '.toml',
      '.py', '.js', '.ts', '.tsx', '.jsx', '.rs', '.go',
      '.sql', '.sh', '.html', '.css', '.scss', '.vue', '.svelte', '.graphql',
    ]);

    // Ignore patterns
    this.ignorePatterns = [
      '**/node_modules/**',
      '**/.git/**',
      '**/target/**',
      '**/dist/**',
      '**/build/**',
      '**/__pycache__/**',
      '**/.venv/**',
      '**/venv/**',
      '**/*.log',
      '**/.DS_Store',
    ];

    // State
    this.watchers = new Map();  // projectIdentifier -> chokidar watcher
    this.pendingChanges = new Map();  // projectIdentifier -> Map<filePath, changeType>
    this.debounceTimers = new Map();  // projectIdentifier -> timer
    this.processing = new Set();  // projectIdentifiers currently being processed

    // Stats
    this.stats = {
      filesWatched: 0,
      changesDetected: 0,
      uploadsTriggered: 0,
      errors: 0,
    };

    this.log = logger.child({ service: 'FileWatcher' });
  }

  /**
   * Start watching a project directory
   */
  watchProject(projectIdentifier, projectPath, folderId) {
    if (this.watchers.has(projectIdentifier)) {
      this.log.debug({ project: projectIdentifier }, 'Already watching project');
      return;
    }

    if (!fs.existsSync(projectPath)) {
      this.log.warn({ project: projectIdentifier, path: projectPath }, 'Project path does not exist');
      return;
    }

    this.log.info({ project: projectIdentifier, path: projectPath }, 'Starting file watcher');

    const watcher = chokidar.watch(projectPath, {
      ignored: this.ignorePatterns,
      persistent: true,
      ignoreInitial: true,  // Don't fire events for existing files
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      depth: 10,  // Max directory depth
    });

    // Store project metadata with watcher
    watcher._projectMeta = {
      projectIdentifier,
      projectPath,
      folderId,
    };

    watcher
      .on('add', (filePath) => this.handleChange(projectIdentifier, filePath, 'add'))
      .on('change', (filePath) => this.handleChange(projectIdentifier, filePath, 'change'))
      .on('unlink', (filePath) => this.handleChange(projectIdentifier, filePath, 'unlink'))
      .on('error', (error) => {
        this.log.error({ err: error, project: projectIdentifier }, 'Watcher error');
        this.stats.errors++;
      })
      .on('ready', () => {
        const watched = watcher.getWatched();
        const fileCount = Object.values(watched).reduce((sum, files) => sum + files.length, 0);
        this.stats.filesWatched += fileCount;
        this.log.info({ project: projectIdentifier, files: fileCount }, 'Watcher ready');
      });

    this.watchers.set(projectIdentifier, watcher);
  }

  /**
   * Stop watching a project
   */
  async unwatchProject(projectIdentifier) {
    const watcher = this.watchers.get(projectIdentifier);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(projectIdentifier);
      this.pendingChanges.delete(projectIdentifier);

      const timer = this.debounceTimers.get(projectIdentifier);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(projectIdentifier);
      }

      this.log.info({ project: projectIdentifier }, 'Stopped watching project');
    }
  }

  /**
   * Handle a file change event
   */
  handleChange(projectIdentifier, filePath, changeType) {
    // Filter by extension
    const ext = path.extname(filePath).toLowerCase();
    if (!this.allowedExtensions.has(ext)) {
      return;
    }

    // Check file size for add/change (skip large files)
    if (changeType !== 'unlink') {
      try {
        const stats = fs.statSync(filePath);
        if (stats.size > 512000) {  // 500KB limit
          return;
        }
      } catch (e) {
        // File might have been deleted between event and stat
        return;
      }
    }

    this.stats.changesDetected++;

    // Add to pending changes
    if (!this.pendingChanges.has(projectIdentifier)) {
      this.pendingChanges.set(projectIdentifier, new Map());
    }
    this.pendingChanges.get(projectIdentifier).set(filePath, changeType);

    this.log.debug({ project: projectIdentifier, file: filePath, type: changeType }, 'File change detected');

    // Debounce processing
    this.scheduleProcessing(projectIdentifier);
  }

  /**
   * Schedule batch processing with debounce
   */
  scheduleProcessing(projectIdentifier) {
    // Clear existing timer
    const existingTimer = this.debounceTimers.get(projectIdentifier);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.processPendingChanges(projectIdentifier);
    }, this.debounceMs);

    this.debounceTimers.set(projectIdentifier, timer);
  }

  /**
   * Process pending changes for a project
   */
  async processPendingChanges(projectIdentifier) {
    // Prevent concurrent processing for same project
    if (this.processing.has(projectIdentifier)) {
      // Reschedule
      this.scheduleProcessing(projectIdentifier);
      return;
    }

    const changes = this.pendingChanges.get(projectIdentifier);
    if (!changes || changes.size === 0) {
      return;
    }

    const watcher = this.watchers.get(projectIdentifier);
    if (!watcher || !watcher._projectMeta) {
      return;
    }

    const { projectPath, folderId } = watcher._projectMeta;

    // Take a snapshot of changes and clear pending
    const changesToProcess = new Map(changes);
    changes.clear();

    this.processing.add(projectIdentifier);

    try {
      this.log.info({
        project: projectIdentifier,
        changeCount: changesToProcess.size,
      }, 'Processing file changes');

      let uploaded = 0;
      let deleted = 0;
      let skipped = 0;
      let errors = 0;

      for (const [filePath, changeType] of changesToProcess) {
        try {
          const relativePath = path.relative(projectPath, filePath);

          if (changeType === 'unlink') {
            // File deleted - remove from Letta
            await this.handleFileDelete(projectIdentifier, relativePath, folderId);
            deleted++;
          } else {
            // File added or changed - check hash and upload if needed
            const result = await this.handleFileUpdate(projectIdentifier, relativePath, filePath, folderId);
            if (result === 'uploaded') {
              uploaded++;
            } else if (result === 'skipped') {
              skipped++;
            }
          }
        } catch (err) {
          this.log.warn({ err, file: filePath }, 'Failed to process file change');
          errors++;
        }
      }

      this.stats.uploadsTriggered += uploaded;

      this.log.info({
        project: projectIdentifier,
        uploaded,
        deleted,
        skipped,
        errors,
      }, 'File changes processed');

    } finally {
      this.processing.delete(projectIdentifier);
    }
  }

  /**
   * Handle file deletion
   */
  async handleFileDelete(projectIdentifier, relativePath, folderId) {
    // Get tracked file info
    const tracked = this.db.getProjectFile(projectIdentifier, relativePath);

    if (tracked && tracked.letta_file_id) {
      try {
        // Delete from Letta
        await this.lettaService.deleteFile(folderId, tracked.letta_file_id);
        this.log.debug({ project: projectIdentifier, file: relativePath }, 'Deleted file from Letta');
      } catch (e) {
        // Ignore delete errors (file might already be gone)
      }

      // Remove from tracking DB
      this.db.deleteProjectFile(projectIdentifier, relativePath);
    }
  }

  /**
   * Handle file update (add or change)
   */
  async handleFileUpdate(projectIdentifier, relativePath, fullPath, folderId) {
    // Compute current hash
    const currentHash = this.computeFileHash(fullPath);
    if (!currentHash) {
      return 'skipped';
    }

    // Get tracked file info
    const tracked = this.db.getProjectFile(projectIdentifier, relativePath);

    // Skip if hash unchanged
    if (tracked && tracked.content_hash === currentHash) {
      return 'skipped';
    }

    // Delete old version if exists
    if (tracked && tracked.letta_file_id) {
      try {
        await this.lettaService.deleteFile(folderId, tracked.letta_file_id);
      } catch (e) {
        // Ignore delete errors
      }
    }

    // Upload new version
    const fileBuffer = fs.readFileSync(fullPath);
    const ext = path.extname(relativePath).toLowerCase();
    const mimeTypes = {
      '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
      '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/plain',
      '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/typescript',
      '.tsx': 'text/typescript', '.jsx': 'text/javascript', '.rs': 'text/x-rust',
      '.go': 'text/x-go', '.sql': 'text/x-sql', '.sh': 'text/x-shellscript',
      '.html': 'text/html', '.css': 'text/css', '.scss': 'text/x-scss',
      '.vue': 'text/plain', '.svelte': 'text/plain', '.graphql': 'text/plain',
    };
    const mimeType = mimeTypes[ext] || 'text/plain';
    const fileName = relativePath.replace(/\//g, '_');

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);

    const uploadResponse = await fetch(`${this.lettaService.apiURL}/sources/${folderId}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.lettaService.password}`,
      },
      body: formData,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.status}`);
    }

    const fileMetadata = await uploadResponse.json();

    // Update tracking DB
    const fileStats = fs.statSync(fullPath);
    this.db.upsertProjectFile({
      project_identifier: projectIdentifier,
      relative_path: relativePath,
      content_hash: currentHash,
      letta_file_id: fileMetadata.id,
      file_size: fileStats.size,
    });

    this.log.debug({ project: projectIdentifier, file: relativePath }, 'Uploaded file to Letta');

    return 'uploaded';
  }

  /**
   * Compute MD5 hash of file
   */
  computeFileHash(filePath) {
    try {
      const content = fs.readFileSync(filePath);
      return crypto.createHash('md5').update(content).digest('hex');
    } catch (e) {
      return null;
    }
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      ...this.stats,
      projectsWatched: this.watchers.size,
      pendingChanges: Array.from(this.pendingChanges.values())
        .reduce((sum, m) => sum + m.size, 0),
    };
  }

  /**
   * Sync watched projects from database
   * Call this after sync cycles to pick up new projects with Letta folders
   */
  async syncWatchedProjects() {
    try {
      // Get all projects with Letta folders from DB
      const projectsWithFolders = this.db.getProjectsWithLettaFolders();

      for (const project of projectsWithFolders) {
        const { identifier, filesystem_path, letta_folder_id } = project;

        // Skip if already watching
        if (this.watchers.has(identifier)) {
          continue;
        }

        // Skip if no filesystem path or folder ID
        if (!filesystem_path || !letta_folder_id) {
          continue;
        }

        // Start watching
        this.watchProject(identifier, filesystem_path, letta_folder_id);
      }

      // Remove watchers for projects no longer in DB
      const activeProjectIds = new Set(projectsWithFolders.map(p => p.identifier));
      for (const [projectIdentifier] of this.watchers) {
        if (!activeProjectIds.has(projectIdentifier)) {
          await this.unwatchProject(projectIdentifier);
        }
      }

      this.log.info({
        watching: this.watchers.size,
        available: projectsWithFolders.length,
      }, 'Synced watched projects');

    } catch (error) {
      this.log.error({ err: error }, 'Failed to sync watched projects');
    }
  }

  /**
   * Stop all watchers
   */
  async shutdown() {
    this.log.info('Shutting down file watchers');

    for (const [projectIdentifier] of this.watchers) {
      await this.unwatchProject(projectIdentifier);
    }

    // Clear all timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
