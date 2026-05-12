import chokidar from 'chokidar';
import type { FSWatcher, ChokidarOptions } from 'chokidar';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { logger } from './logger';

interface ProjectFileWatcher extends FSWatcher {
  _projectMeta?: {
    projectIdentifier: string;
    projectPath: string;
    folderId: string;
  };
}

type ChangeType = 'add' | 'change' | 'unlink';

const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
  '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/plain',
  '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/typescript',
  '.tsx': 'text/typescript', '.jsx': 'text/javascript', '.rs': 'text/x-rust',
  '.go': 'text/x-go', '.sql': 'text/x-sql', '.sh': 'text/x-shellscript',
  '.html': 'text/html', '.css': 'text/css', '.scss': 'text/x-scss',
  '.vue': 'text/plain', '.svelte': 'text/plain', '.graphql': 'text/plain',
};

export class FileWatcher {
  lettaService: { apiURL: string; password: string; deleteFile: (folderId: string, fileId: string) => Promise<void> };
  db: {
    getProjectFile: (identifier: string, relativePath: string) => { letta_file_id?: string; content_hash?: string } | null;
    deleteProjectFile: (identifier: string, relativePath: string) => void;
    upsertProjectFile: (record: { project_identifier: string; relative_path: string; content_hash: string; letta_file_id: string; file_size: number }) => void;
    getProjectsWithLettaFolders: () => { identifier: string; filesystem_path: string | null; letta_folder_id: string | null }[];
  };
  debounceMs: number;
  batchIntervalMs: number;
  maxBatchSize: number;

  allowedExtensions = new Set<string>([
    '.md', '.txt', '.json', '.yaml', '.yml', '.toml',
    '.py', '.js', '.ts', '.tsx', '.jsx', '.rs', '.go',
    '.sql', '.sh', '.html', '.css', '.scss', '.vue', '.svelte', '.graphql',
  ]);

  ignorePatterns: string[] = [
    '**/node_modules/**', '**/.git/**', '**/target/**', '**/dist/**',
    '**/build/**', '**/__pycache__/**', '**/.venv/**', '**/venv/**',
    '**/*.log', '**/.DS_Store',
  ];

  watchers = new Map<string, ProjectFileWatcher>();
  pendingChanges = new Map<string, Map<string, ChangeType>>();
  debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  processing = new Set<string>();

  stats = {
    filesWatched: 0,
    changesDetected: 0,
    uploadsTriggered: 0,
    errors: 0,
  };

  log = logger.child({ service: 'FileWatcher' });

  constructor(lettaService: FileWatcher['lettaService'], db: FileWatcher['db'], options: { debounceMs?: number; batchIntervalMs?: number; maxBatchSize?: number } = {}) {
    this.lettaService = lettaService;
    this.db = db;
    this.debounceMs = options.debounceMs || 1000;
    this.batchIntervalMs = options.batchIntervalMs || 5000;
    this.maxBatchSize = options.maxBatchSize || 50;
  }

  watchProject(projectIdentifier: string, projectPath: string, folderId: string): void {
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
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 1000 },
      depth: 10,
    } as ChokidarOptions) as ProjectFileWatcher;

    watcher._projectMeta = { projectIdentifier, projectPath, folderId };

    watcher
      .on('add', (filePath) => { this.handleChange(projectIdentifier, filePath as string, 'add'); })
      .on('change', (filePath) => { this.handleChange(projectIdentifier, filePath as string, 'change'); })
      .on('unlink', (filePath) => { this.handleChange(projectIdentifier, filePath as string, 'unlink'); })
      .on('error', (error) => {
        this.log.error({ err: error, project: projectIdentifier }, 'Watcher error');
        this.stats.errors++;
      })
      .on('ready', () => {
        const watched = watcher.getWatched();
        const fileCount = Object.values(watched).reduce((sum: number, files: string[]) => sum + files.length, 0);
        this.stats.filesWatched += fileCount;
        this.log.info({ project: projectIdentifier, files: fileCount }, 'Watcher ready');
      });

    this.watchers.set(projectIdentifier, watcher);
  }

  async unwatchProject(projectIdentifier: string): Promise<void> {
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

  handleChange(projectIdentifier: string, filePath: string, changeType: ChangeType): void {
    const ext = path.extname(filePath).toLowerCase();
    if (!this.allowedExtensions.has(ext)) return;

    if (changeType !== 'unlink') {
      try {
        if (fs.statSync(filePath).size > 512000) return;
      } catch {
        return;
      }
    }

    this.stats.changesDetected++;

    if (!this.pendingChanges.has(projectIdentifier)) {
      this.pendingChanges.set(projectIdentifier, new Map());
    }
    this.pendingChanges.get(projectIdentifier)!.set(filePath, changeType);

    this.log.debug({ project: projectIdentifier, file: filePath, type: changeType }, 'File change detected');
    this.scheduleProcessing(projectIdentifier);
  }

  scheduleProcessing(projectIdentifier: string): void {
    const existing = this.debounceTimers.get(projectIdentifier);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      void this.processPendingChanges(projectIdentifier);
    }, this.debounceMs);

    this.debounceTimers.set(projectIdentifier, timer);
  }

  async processPendingChanges(projectIdentifier: string): Promise<void> {
    if (this.processing.has(projectIdentifier)) {
      this.scheduleProcessing(projectIdentifier);
      return;
    }

    const changes = this.pendingChanges.get(projectIdentifier);
    if (!changes || changes.size === 0) return;

    const watcher = this.watchers.get(projectIdentifier);
    if (!watcher?._projectMeta) return;

    const { projectPath, folderId } = watcher._projectMeta;
    const changesToProcess = new Map(changes);
    changes.clear();

    this.processing.add(projectIdentifier);

    try {
      this.log.info({ project: projectIdentifier, changeCount: changesToProcess.size }, 'Processing file changes');
      let uploaded = 0, deleted = 0, skipped = 0, errors = 0;

      for (const [fp, ct] of changesToProcess) {
        try {
          const relativePath = path.relative(projectPath, fp);
          if (ct === 'unlink') {
            await this.handleFileDelete(projectIdentifier, relativePath, folderId);
            deleted++;
          } else {
            const result = await this.handleFileUpdate(projectIdentifier, relativePath, fp, folderId);
            if (result === 'uploaded') uploaded++;
            else if (result === 'skipped') skipped++;
          }
        } catch (err) {
          this.log.warn({ err, file: fp }, 'Failed to process file change');
          errors++;
        }
      }

      this.stats.uploadsTriggered += uploaded;
      this.log.info({ project: projectIdentifier, uploaded, deleted, skipped, errors }, 'File changes processed');
    } finally {
      this.processing.delete(projectIdentifier);
    }
  }

  async handleFileDelete(projectIdentifier: string, relativePath: string, folderId: string): Promise<void> {
    const tracked = this.db.getProjectFile(projectIdentifier, relativePath);
    if (tracked?.letta_file_id) {
      try {
        await this.lettaService.deleteFile(folderId, tracked.letta_file_id);
        this.log.debug({ project: projectIdentifier, file: relativePath }, 'Deleted file from Letta');
      } catch { /* delete errors are expected — file may already be gone */ }
      this.db.deleteProjectFile(projectIdentifier, relativePath);
    }
  }

  async handleFileUpdate(projectIdentifier: string, relativePath: string, fullPath: string, folderId: string): Promise<'uploaded' | 'skipped'> {
    const currentHash = this.computeFileHash(fullPath);
    if (!currentHash) return 'skipped';

    const tracked = this.db.getProjectFile(projectIdentifier, relativePath);
    if (tracked?.content_hash === currentHash) return 'skipped';

    if (tracked?.letta_file_id) {
      try { await this.lettaService.deleteFile(folderId, tracked.letta_file_id); } catch { /* delete errors are expected */ }
    }

    const fileBuffer = fs.readFileSync(fullPath);
    const ext = path.extname(relativePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'text/plain';
    const fileName = relativePath.replace(/\//g, '_');

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);

    const uploadResponse = await fetch(`${this.lettaService.apiURL}/sources/${folderId}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.lettaService.password}` },
      body: formData,
    });

    if (!uploadResponse.ok) throw new Error(`Upload failed: ${uploadResponse.status}`);

    const fileMetadata = await uploadResponse.json() as { id: string };
    const fileStats = fs.statSync(fullPath);

    this.db.upsertProjectFile({
      project_identifier: projectIdentifier, relative_path: relativePath,
      content_hash: currentHash, letta_file_id: fileMetadata.id, file_size: fileStats.size,
    });

    this.log.debug({ project: projectIdentifier, file: relativePath }, 'Uploaded file to Letta');
    return 'uploaded';
  }

  computeFileHash(filePath: string): string | null {
    try {
      const content = fs.readFileSync(filePath);
      return crypto.createHash('md5').update(content).digest('hex');
    } catch {
      return null;
    }
  }

  getStats(): { filesWatched: number; changesDetected: number; uploadsTriggered: number; errors: number; projectsWatched: number; pendingChanges: number } {
    return {
      ...this.stats,
      projectsWatched: this.watchers.size,
      pendingChanges: Array.from(this.pendingChanges.values()).reduce((sum, m) => sum + m.size, 0),
    };
  }

  async syncWatchedProjects(): Promise<void> {
    try {
      const projectsWithFolders = this.db.getProjectsWithLettaFolders();
      for (const project of projectsWithFolders) {
        const { identifier, filesystem_path, letta_folder_id } = project;
        if (this.watchers.has(identifier)) continue;
        if (!filesystem_path || !letta_folder_id) continue;
        this.watchProject(identifier, filesystem_path, letta_folder_id);
      }

      const activeProjectIds = new Set(projectsWithFolders.map(p => p.identifier));
      for (const [projectIdentifier] of this.watchers) {
        if (!activeProjectIds.has(projectIdentifier)) {
          await this.unwatchProject(projectIdentifier);
        }
      }

      this.log.info({ watching: this.watchers.size, available: projectsWithFolders.length }, 'Synced watched projects');
    } catch (error) {
      this.log.error({ err: error }, 'Failed to sync watched projects');
    }
  }

  async shutdown(): Promise<void> {
    this.log.info('Shutting down file watchers');
    for (const [projectIdentifier] of this.watchers) {
      await this.unwatchProject(projectIdentifier);
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
