import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { Blob } from 'buffer';
import { fetchWithPool } from './http';

interface LettaClient {
  sources: { files: { list: (id: string) => Promise<Record<string, unknown>[]>; upload: (...args: unknown[]) => Promise<Record<string, unknown>> } };
  agents: { files: { closeAll: (id: string) => Promise<void> } };
  folders: { files: { upload: (...args: unknown[]) => Promise<Record<string, unknown>> } };
}

export interface LettaServiceHost {
  client: LettaClient;
  apiURL: string;
  password: string;
}

export interface SyncDatabase {
  getProjectFiles: (projectId: string) => { relative_path: string; letta_file_id?: string; content_hash?: string }[];
  getOrphanedFiles: (projectId: string, currentFiles: string[]) => { relative_path: string; letta_file_id?: string }[];
  deleteProjectFile: (projectId: string, relativePath: string) => void;
  upsertProjectFile: (record: { project_identifier: string; relative_path: string; content_hash: string; letta_file_id: string; file_size: number }) => void;
}

export class LettaFileService {
  private _host: LettaServiceHost;

  constructor(host: LettaServiceHost) {
    this._host = host;
  }

  get client(): LettaServiceHost['client'] { return this._host.client; }
  get apiURL(): string { return this._host.apiURL; }
  get password(): string { return this._host.password; }

  async listFolderFiles(folderId: string): Promise<Record<string, unknown>[]> {
    try {
      const files = await this.client.sources.files.list(folderId);
      return files || [];
    } catch (error) {
      console.warn('[Letta] Error listing folder files:', (error as Error).message);
      return [];
    }
  }

  async closeAllFiles(agentId: string): Promise<void> {
    try {
      await this.client.agents.files.closeAll(agentId);
      console.log(`[Letta] Closed all files for agent ${agentId}`);
    } catch (error) {
      console.warn('[Letta] Error closing files for agent:', (error as Error).message);
    }
  }

  async discoverProjectFiles(projectPath: string, options: { docsOnly?: boolean; maxFiles?: number } = { docsOnly: true }): Promise<string[]> {
    console.log(`[Letta] Discovering files in ${projectPath}...`);

    try {
      if (!fs.existsSync(projectPath)) {
        console.warn(`[Letta] Project path does not exist: ${projectPath}`);
        return [];
      }

      const priorityFiles = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md', 'CHANGELOG.md', 'package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod'];
      const docDirs = ['docs', 'doc', 'documentation', '.github'];
      const files: string[] = [];

      for (const file of priorityFiles) {
        const filePath = path.join(projectPath, file);
        if (fs.existsSync(filePath)) files.push(file);
      }

      for (const dir of docDirs) {
        const dirPath = path.join(projectPath, dir);
        if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
          const scanDir = (currentPath: string, relativePath = '') => {
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });
            for (const entry of entries) {
              const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
              const fullEntryPath = path.join(currentPath, entry.name);
              if (entry.isDirectory() && !entry.name.startsWith('.')) scanDir(fullEntryPath, entryRelPath);
              else if (entry.isFile() && entry.name.endsWith('.md')) files.push(`${dir}/${entryRelPath}`);
            }
          };
          scanDir(dirPath);
        }
      }

      if (!options.docsOnly) {
        try {
          const output = execSync('git ls-files', { cwd: projectPath, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
          const allGitFiles = output.trim().split('\n').filter(f => f);
          const sourceExtensions = ['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.py', '.pyx', '.rs', '.go', '.java', '.kt', '.scala', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.sql', '.sh', '.bash', '.yaml', '.yml', '.toml', '.json', '.css', '.scss', '.sass', '.less', '.html', '.htm', '.vue', '.svelte'];
          const excludeDirs = ['node_modules', 'target', 'dist', 'build', '.git', 'vendor', '__pycache__', '.next', '.nuxt', 'coverage', '.venv', 'venv', 'env', '.tox', '.pytest_cache'];
          const sourceFiles = allGitFiles.filter(f => sourceExtensions.some(ext => f.endsWith(ext))).filter(f => !excludeDirs.some(dir => f.includes(`${dir}/`) || f.startsWith(`${dir}/`))).slice(0, options.maxFiles || 500);
          files.push(...sourceFiles);
          console.log(`[Letta] Added ${sourceFiles.length} source files for full codebase search`);
        } catch {
          console.warn('[Letta] Git ls-files failed, skipping source files');
        }
      }

      const uniqueFiles = [...new Set(files)];
      console.log(`[Letta] Found ${uniqueFiles.length} files to upload`);
      return uniqueFiles;
    } catch (error) {
      console.error('[Letta] Error discovering project files:', (error as Error).message);
      return [];
    }
  }

  async discoverProjectFilesLegacy(projectPath: string): Promise<string[]> {
    console.log(`[Letta] Discovering files (legacy) in ${projectPath}...`);

    try {
      if (!fs.existsSync(projectPath)) {
        console.warn(`[Letta] Project path does not exist: ${projectPath}`);
        return [];
      }

      try {
        const output = execSync('git ls-files', { cwd: projectPath, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        const allFiles = output.trim().split('\n').filter(f => f);
        const relevantExtensions = ['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.html', '.css', '.scss', '.less', '.vue', '.sh', '.bash', '.zsh', '.fish', '.sql', '.graphql', '.proto', '.env.example', '.gitignore', '.dockerignore', 'Dockerfile', 'Makefile', 'package.json', 'package-lock.json', 'tsconfig.json', 'go.mod', 'Cargo.toml', 'requirements.txt'];
        const files = allFiles.filter(file => {
          const ext = path.extname(file).toLowerCase();
          const basename = path.basename(file);
          return relevantExtensions.includes(ext) || relevantExtensions.includes(basename);
        });
        console.log(`[Letta] Found ${files.length} relevant files (out of ${allFiles.length} total)`);
        return files;
      } catch {
        console.warn('[Letta] Not a git repo or git failed, using filesystem scan');
        const files: string[] = [];
        const ignorePatterns = ['node_modules', '.git', 'dist', 'build', '.next', 'target', 'vendor'];

        function scanDir(dir: string, baseDir: string): void {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (ignorePatterns.includes(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath);
            if (entry.isDirectory()) scanDir(fullPath, baseDir);
            else {
              const ext = path.extname(entry.name).toLowerCase();
              if (['.md', '.txt', '.json', '.js', '.ts', '.py'].includes(ext)) files.push(relativePath);
            }
          }
        }

        scanDir(projectPath, projectPath);
        console.log(`[Letta] Found ${files.length} files via filesystem scan`);
        return files.slice(0, 100);
      }
    } catch (error) {
      console.error('[Letta] Error discovering files:', (error as Error).message);
      return [];
    }
  }

  async uploadProjectFiles(folderId: string, projectPath: string, files: string[], maxFiles = 50): Promise<Record<string, unknown>[]> {
    console.log(`[Letta] Uploading up to ${maxFiles} files to folder ${folderId}...`);

    try {
      const uploadedFiles: Record<string, unknown>[] = [];
      const filesToUpload = files.slice(0, maxFiles);

      for (const file of filesToUpload) {
        try {
          const fullPath = path.join(projectPath, file);
          const stats = fs.statSync(fullPath);
          if (stats.size > 1024 * 1024) { console.log(`[Letta] Skipping large file: ${file} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`); continue; }

          const fileBuffer = fs.readFileSync(fullPath);
          const ext = path.extname(file).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/plain',
            '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/typescript', '.rs': 'text/x-rust', '.go': 'text/x-go', '.rb': 'text/x-ruby',
            '.sh': 'text/x-shellscript', '.html': 'text/html', '.css': 'text/css',
          };
          const mimeType = mimeTypes[ext] || 'text/plain';
          const fileBlob = new Blob([fileBuffer], { type: mimeType });
          const fileName = file.replace(/\//g, '_');

          const fileMetadata = await this.client.folders.files.upload(fileBlob, folderId, { name: fileName, duplicateHandling: 'replace' });
          uploadedFiles.push(fileMetadata as Record<string, unknown>);
          console.log(`[Letta] Uploaded: ${file}`);
        } catch (fileError) {
          console.warn(`[Letta] Failed to upload ${file}:`, (fileError as Error).message);
        }
      }

      console.log(`[Letta] Uploaded ${uploadedFiles.length} files to folder`);
      return uploadedFiles;
    } catch (error) {
      console.error('[Letta] Error uploading project files:', (error as Error).message);
      throw error;
    }
  }

  computeFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  async deleteFile(folderId: string, fileId: string): Promise<void> {
    await fetchWithPool(`${this.apiURL}/sources/${folderId}/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${this.password}` } });
  }

  async syncProjectFilesIncremental(folderId: string, projectPath: string, files: string[], db: SyncDatabase, projectIdentifier: string): Promise<{ uploaded: number; deleted: number; skipped: number; errors: number }> {
    console.log(`[Letta] Starting incremental file sync for ${projectIdentifier}...`);

    const stats = { uploaded: 0, deleted: 0, skipped: 0, errors: 0 };

    try {
      const trackedFiles = db.getProjectFiles(projectIdentifier) as { relative_path: string; letta_file_id?: string; content_hash?: string }[];
      const trackedMap = new Map(trackedFiles.map(f => [f.relative_path, f]));

      const orphanedFiles = db.getOrphanedFiles(projectIdentifier, files) as { relative_path: string; letta_file_id?: string }[];

      for (const orphan of orphanedFiles) {
        if (orphan.letta_file_id) {
          try {
            await fetchWithPool(`${this.apiURL}/sources/${folderId}/${orphan.letta_file_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${this.password}` } });
            console.log(`[Letta] Deleted removed file: ${orphan.relative_path}`);
            stats.deleted++;
          } catch (e) { console.warn(`[Letta] Failed to delete ${orphan.relative_path}: ${(e as Error).message}`); }
        }
        db.deleteProjectFile(projectIdentifier, orphan.relative_path);
      }

      for (const relativePath of files) {
        try {
          const fullPath = path.join(projectPath, relativePath);
          if (!fs.existsSync(fullPath)) continue;
          const fileStats = fs.statSync(fullPath);
          if (fileStats.size > 512000) continue;

          const currentHash = this.computeFileHash(fullPath);
          const tracked = trackedMap.get(relativePath);

          if (tracked && tracked.content_hash === currentHash) { stats.skipped++; continue; }

          if (tracked?.letta_file_id) {
            try { await fetchWithPool(`${this.apiURL}/sources/${folderId}/${tracked.letta_file_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${this.password}` } }); } catch { /* ignore */ }
          }

          const fileBuffer = fs.readFileSync(fullPath);
          const ext = path.extname(relativePath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/plain',
            '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/typescript', '.tsx': 'text/typescript', '.jsx': 'text/javascript',
            '.rs': 'text/x-rust', '.go': 'text/x-go', '.sql': 'text/x-sql', '.sh': 'text/x-shellscript',
            '.html': 'text/html', '.css': 'text/css', '.scss': 'text/x-scss', '.vue': 'text/plain', '.svelte': 'text/plain', '.graphql': 'text/plain',
          };
          const mimeType = mimeTypes[ext] || 'text/plain';
          const fileName = relativePath.replace(/\//g, '_');

          const formData = new FormData();
          const blob = new Blob([fileBuffer], { type: mimeType });
          formData.append('file', blob, fileName);

          const uploadResponse = await fetch(`${this.apiURL}/sources/${folderId}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${this.password}` }, body: formData });

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Status code: ${uploadResponse.status}\nBody: ${errorText}`);
          }

          const fileMetadata = await uploadResponse.json() as { id: string };
          db.upsertProjectFile({ project_identifier: projectIdentifier, relative_path: relativePath, content_hash: currentHash, letta_file_id: fileMetadata.id, file_size: fileStats.size });

          console.log(`[Letta] ${tracked ? 'Updated' : 'Uploaded'}: ${relativePath}`);
          stats.uploaded++;
        } catch (fileError) {
          console.warn(`[Letta] Failed to sync ${relativePath}: ${(fileError as Error).message}`);
          stats.errors++;
        }
      }

      console.log(`[Letta] Incremental sync complete: ${stats.uploaded} uploaded, ${stats.deleted} deleted, ${stats.skipped} unchanged, ${stats.errors} errors`);
      return stats;
    } catch (error) {
      console.error('[Letta] Error in incremental file sync:', (error as Error).message);
      throw error;
    }
  }

  async uploadReadme(sourceId: string, readmePath: string, projectIdentifier: string): Promise<Record<string, unknown> | null> {
    if (!sourceId) {
      console.warn(`[Letta] Source ID is null, skipping README upload for ${projectIdentifier}`);
      return null;
    }

    console.log(`[Letta] Uploading README from ${readmePath} to source ${sourceId}`);

    try {
      if (!fs.existsSync(readmePath)) {
        console.warn(`[Letta] README not found at ${readmePath}, skipping upload`);
        return null;
      }

      const fileStream = fs.createReadStream(readmePath);
      const fileName = `${projectIdentifier}-README.md`;
      const fileMetadata = await this.client.sources.files.upload(fileStream, sourceId, { name: fileName, duplicateHandling: 'replace' } as unknown as Parameters<LettaClient['sources']['files']['upload']>[0]);
      console.log(`[Letta] README uploaded successfully: ${fileMetadata.id}`);
      return fileMetadata;
    } catch (error) {
      console.error('[Letta] Error uploading README:', (error as Error).message);
      throw error;
    }
  }
}
