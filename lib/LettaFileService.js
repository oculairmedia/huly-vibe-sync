/**
 * Letta File Service
 * Handles file discovery, upload, sync, and management for Letta agent folders/sources.
 * Extracted from LettaService.js to reduce module complexity.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { Blob } from 'buffer';
import { fetchWithPool } from './http.js';

export class LettaFileService {
  /**
   * @param {Object} host - Host object providing client, apiURL, password properties.
   *   Properties are accessed dynamically so mutations on the host are reflected here.
   */
  constructor(host) {
    this._host = host;
  }

  /** @returns {import('@letta-ai/letta-client').LettaClient} */
  get client() {
    return this._host.client;
  }

  /** @returns {string} */
  get apiURL() {
    return this._host.apiURL;
  }

  /** @returns {string} */
  get password() {
    return this._host.password;
  }

  /**
   * List files in a folder/source
   *
   * @param {string} folderId - Folder/source ID
   * @returns {Promise<Array>} Array of file metadata
   */
  async listFolderFiles(folderId) {
    try {
      // Use sources.files API (folders are sources in Letta)
      const files = await this.client.sources.files.list(folderId);
      return files || [];
    } catch (error) {
      console.warn(`[Letta] Error listing folder files:`, error.message);
      return [];
    }
  }

  /**
   * Close all files for an agent (files remain attached but not in context)
   * Agent can still search via passages API
   *
   * @param {string} agentId - Agent ID
   */
  async closeAllFiles(agentId) {
    try {
      await this.client.agents.files.closeAll(agentId);
      console.log(`[Letta] Closed all files for agent ${agentId}`);
    } catch (error) {
      console.warn(`[Letta] Error closing files for agent:`, error.message);
    }
  }

  /**
   * Discover project files to upload (respects .gitignore)
   *
   * @param {string} projectPath - Filesystem path to project root
   * @param {Object} options - Discovery options
   * @param {boolean} options.docsOnly - Only discover documentation files (default: true)
   * @returns {Promise<Array<string>>} Array of file paths relative to project root
   */
  async discoverProjectFiles(projectPath, options = { docsOnly: true }) {
    console.log(`[Letta] Discovering files in ${projectPath}...`);

    try {
      if (!fs.existsSync(projectPath)) {
        console.warn(`[Letta] Project path does not exist: ${projectPath}`);
        return [];
      }

      // Priority files - these are always included if they exist
      const priorityFiles = [
        'README.md',
        'AGENTS.md',
        'CLAUDE.md',
        'CONTRIBUTING.md',
        'ARCHITECTURE.md',
        'CHANGELOG.md',
        'package.json',
        'Cargo.toml',
        'pyproject.toml',
        'go.mod',
      ];

      // Documentation directories to scan
      const docDirs = ['docs', 'doc', 'documentation', '.github'];

      const files = [];

      // Add priority files that exist
      for (const file of priorityFiles) {
        const filePath = path.join(projectPath, file);
        if (fs.existsSync(filePath)) {
          files.push(file);
        }
      }

      // Scan documentation directories for .md files
      for (const dir of docDirs) {
        const dirPath = path.join(projectPath, dir);
        if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
          const scanDir = (currentPath, relativePath = '') => {
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });
            for (const entry of entries) {
              const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
              const fullEntryPath = path.join(currentPath, entry.name);

              if (entry.isDirectory() && !entry.name.startsWith('.')) {
                scanDir(fullEntryPath, entryRelPath);
              } else if (entry.isFile() && entry.name.endsWith('.md')) {
                files.push(`${dir}/${entryRelPath}`);
              }
            }
          };
          scanDir(dirPath);
        }
      }

      // If not docs-only mode, also include source files (for full codebase search)
      if (!options.docsOnly) {
        try {
          const output = execSync('git ls-files', {
            cwd: projectPath,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
          });

          const allGitFiles = output
            .trim()
            .split('\n')
            .filter(f => f);

          // Source file extensions to include
          const sourceExtensions = [
            '.js',
            '.ts',
            '.tsx',
            '.jsx',
            '.mjs',
            '.cjs', // JavaScript/TypeScript
            '.py',
            '.pyx', // Python
            '.rs', // Rust
            '.go', // Go
            '.java',
            '.kt',
            '.scala', // JVM
            '.c',
            '.cpp',
            '.h',
            '.hpp', // C/C++
            '.rb', // Ruby
            '.php', // PHP
            '.swift', // Swift
            '.sql', // SQL
            '.sh',
            '.bash', // Shell
            '.yaml',
            '.yml',
            '.toml',
            '.json', // Config
            '.css',
            '.scss',
            '.sass',
            '.less', // Styles
            '.html',
            '.htm',
            '.vue',
            '.svelte', // Templates
          ];

          // Directories to exclude
          const excludeDirs = [
            'node_modules',
            'target',
            'dist',
            'build',
            '.git',
            'vendor',
            '__pycache__',
            '.next',
            '.nuxt',
            'coverage',
            '.venv',
            'venv',
            'env',
            '.tox',
            '.pytest_cache',
          ];

          const sourceFiles = allGitFiles
            .filter(f => sourceExtensions.some(ext => f.endsWith(ext)))
            .filter(f => !excludeDirs.some(dir => f.includes(`${dir}/`) || f.startsWith(`${dir}/`)))
            .slice(0, options.maxFiles || 500); // Configurable limit, default 500

          files.push(...sourceFiles);
          console.log(`[Letta] Added ${sourceFiles.length} source files for full codebase search`);
        } catch (gitError) {
          console.warn(`[Letta] Git ls-files failed, skipping source files`);
        }
      }

      // Remove duplicates
      const uniqueFiles = [...new Set(files)];

      console.log(`[Letta] Found ${uniqueFiles.length} files to upload`);
      return uniqueFiles;
    } catch (error) {
      console.error(`[Letta] Error discovering project files:`, error.message);
      return [];
    }
  }

  /**
   * Legacy discoverProjectFiles implementation (kept for compatibility)
   * @deprecated Use discoverProjectFiles with options.docsOnly = false for full scan
   */
  async discoverProjectFilesLegacy(projectPath) {
    console.log(`[Letta] Discovering files (legacy) in ${projectPath}...`);

    try {
      if (!fs.existsSync(projectPath)) {
        console.warn(`[Letta] Project path does not exist: ${projectPath}`);
        return [];
      }

      // Use git ls-files to respect .gitignore
      try {
        const output = execSync('git ls-files', {
          cwd: projectPath,
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });

        const allFiles = output
          .trim()
          .split('\n')
          .filter(f => f);

        // Filter for relevant files (code, docs, config)
        const relevantExtensions = [
          '.md',
          '.txt',
          '.json',
          '.yaml',
          '.yml',
          '.toml',
          '.js',
          '.ts',
          '.jsx',
          '.tsx',
          '.mjs',
          '.cjs',
          '.py',
          '.rb',
          '.go',
          '.rs',
          '.java',
          '.kt',
          '.c',
          '.cpp',
          '.h',
          '.hpp',
          '.cs',
          '.php',
          '.html',
          '.css',
          '.scss',
          '.less',
          '.vue',
          '.sh',
          '.bash',
          '.zsh',
          '.fish',
          '.sql',
          '.graphql',
          '.proto',
          '.env.example',
          '.gitignore',
          '.dockerignore',
          'Dockerfile',
          'Makefile',
          'package.json',
          'package-lock.json',
          'tsconfig.json',
          'go.mod',
          'Cargo.toml',
          'requirements.txt',
        ];

        const files = allFiles.filter(file => {
          const ext = path.extname(file).toLowerCase();
          const basename = path.basename(file);

          // Include if matches extension or is a common config file
          return relevantExtensions.includes(ext) || relevantExtensions.includes(basename);
        });

        console.log(
          `[Letta] Found ${files.length} relevant files (out of ${allFiles.length} total)`
        );
        return files;
      } catch (gitError) {
        console.warn(`[Letta] Not a git repo or git failed, using filesystem scan`);
        // Fallback: scan filesystem with basic ignore rules
        const files = [];
        const ignorePatterns = [
          'node_modules',
          '.git',
          'dist',
          'build',
          '.next',
          'target',
          'vendor',
        ];

        function scanDir(dir, baseDir) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });

          for (const entry of entries) {
            if (ignorePatterns.includes(entry.name)) continue;

            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath);

            if (entry.isDirectory()) {
              scanDir(fullPath, baseDir);
            } else {
              const ext = path.extname(entry.name).toLowerCase();
              if (['.md', '.txt', '.json', '.js', '.ts', '.py'].includes(ext)) {
                files.push(relativePath);
              }
            }
          }
        }

        scanDir(projectPath, projectPath);
        console.log(`[Letta] Found ${files.length} files via filesystem scan`);
        return files.slice(0, 100); // Limit to 100 files for safety
      }
    } catch (error) {
      console.error(`[Letta] Error discovering files:`, error.message);
      return [];
    }
  }

  /**
   * Upload project files to a folder
   *
   * @param {string} folderId - Folder ID
   * @param {string} projectPath - Filesystem path to project root
   * @param {Array<string>} files - Array of relative file paths to upload
   * @param {number} maxFiles - Maximum number of files to upload (default: 50)
   * @returns {Promise<Array>} Array of uploaded file metadata
   */
  async uploadProjectFiles(folderId, projectPath, files, maxFiles = 50) {
    console.log(`[Letta] Uploading up to ${maxFiles} files to folder ${folderId}...`);

    try {
      const uploadedFiles = [];
      const filesToUpload = files.slice(0, maxFiles);

      for (const file of filesToUpload) {
        try {
          const fullPath = path.join(projectPath, file);

          // Check file size (skip files > 1MB)
          const stats = fs.statSync(fullPath);
          if (stats.size > 1024 * 1024) {
            console.log(
              `[Letta] Skipping large file: ${file} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`
            );
            continue;
          }

          // Read file as buffer and convert to Blob (more reliable than streams with this SDK)
          const fileBuffer = fs.readFileSync(fullPath);

          // Determine MIME type based on extension
          const ext = path.extname(file).toLowerCase();
          const mimeTypes = {
            '.md': 'text/markdown',
            '.txt': 'text/plain',
            '.json': 'application/json',
            '.yaml': 'text/yaml',
            '.yml': 'text/yaml',
            '.toml': 'text/plain',
            '.py': 'text/x-python',
            '.js': 'text/javascript',
            '.ts': 'text/typescript',
            '.rs': 'text/x-rust',
            '.go': 'text/x-go',
            '.rb': 'text/x-ruby',
            '.sh': 'text/x-shellscript',
            '.html': 'text/html',
            '.css': 'text/css',
          };
          const mimeType = mimeTypes[ext] || 'text/plain';

          const fileBlob = new Blob([fileBuffer], { type: mimeType });
          const fileName = file.replace(/\//g, '_'); // Flatten path for naming

          // Upload file
          const fileMetadata = await this.client.folders.files.upload(fileBlob, folderId, {
            name: fileName,
            duplicateHandling: 'replace',
          });

          uploadedFiles.push(fileMetadata);
          console.log(`[Letta] Uploaded: ${file}`);
        } catch (fileError) {
          console.warn(`[Letta] Failed to upload ${file}:`, fileError.message);
        }
      }

      console.log(`[Letta] ✓ Uploaded ${uploadedFiles.length} files to folder`);
      return uploadedFiles;
    } catch (error) {
      console.error(`[Letta] Error uploading project files:`, error.message);
      throw error;
    }
  }

  /**
   * Compute MD5 hash of a file
   * @param {string} filePath - Full path to file
   * @returns {string} MD5 hash hex string
   */
  computeFileHash(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Delete a file from a Letta folder/source
   * @param {string} folderId - The folder/source ID
   * @param {string} fileId - The file ID to delete
   */
  async deleteFile(folderId, fileId) {
    await fetchWithPool(`${this.apiURL}/sources/${folderId}/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.password}` },
    });
  }

  /**
   * Incrementally sync project files to Letta folder
   * Only uploads files that have changed since last sync
   *
   * @param {string} folderId - Letta folder/source ID
   * @param {string} projectPath - Filesystem path to project
   * @param {Array<string>} files - Array of relative file paths
   * @param {Object} db - Database instance for tracking
   * @param {string} projectIdentifier - Project identifier
   * @returns {Promise<Object>} Sync stats {uploaded, deleted, skipped, errors}
   */
  async syncProjectFilesIncremental(folderId, projectPath, files, db, projectIdentifier) {
    console.log(`[Letta] Starting incremental file sync for ${projectIdentifier}...`);

    const stats = { uploaded: 0, deleted: 0, skipped: 0, errors: 0 };

    try {
      // Get currently tracked files from database
      const trackedFiles = db.getProjectFiles(projectIdentifier);
      const trackedMap = new Map(trackedFiles.map(f => [f.relative_path, f]));

      // Find files to delete (in DB but not in current file list)
      const orphanedFiles = db.getOrphanedFiles(projectIdentifier, files);

      // Delete orphaned files from Letta
      for (const orphan of orphanedFiles) {
        if (orphan.letta_file_id) {
          try {
            await fetchWithPool(`${this.apiURL}/sources/${folderId}/${orphan.letta_file_id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${this.password}` },
            });
            console.log(`[Letta] Deleted removed file: ${orphan.relative_path}`);
            stats.deleted++;
          } catch (e) {
            console.warn(`[Letta] Failed to delete ${orphan.relative_path}: ${e.message}`);
          }
        }
        db.deleteProjectFile(projectIdentifier, orphan.relative_path);
      }

      // Process each file
      for (const relativePath of files) {
        try {
          const fullPath = path.join(projectPath, relativePath);

          // Skip if file doesn't exist
          if (!fs.existsSync(fullPath)) {
            continue;
          }

          // Skip large files (> 500KB)
          const fileStats = fs.statSync(fullPath);
          if (fileStats.size > 512000) {
            continue;
          }

          // Compute current hash
          const currentHash = this.computeFileHash(fullPath);
          const tracked = trackedMap.get(relativePath);

          // Skip if hash unchanged
          if (tracked && tracked.content_hash === currentHash) {
            stats.skipped++;
            continue;
          }

          // Delete old version if exists
          if (tracked && tracked.letta_file_id) {
            try {
              await fetchWithPool(`${this.apiURL}/sources/${folderId}/${tracked.letta_file_id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${this.password}` },
              });
            } catch (e) {
              // Ignore delete errors
            }
          }

          // Upload new version using native fetch with FormData (SDK has issues with some file types)
          const fileBuffer = fs.readFileSync(fullPath);
          const ext = path.extname(relativePath).toLowerCase();
          const mimeTypes = {
            '.md': 'text/markdown',
            '.txt': 'text/plain',
            '.json': 'application/json',
            '.yaml': 'text/yaml',
            '.yml': 'text/yaml',
            '.toml': 'text/plain',
            '.py': 'text/x-python',
            '.js': 'text/javascript',
            '.ts': 'text/typescript',
            '.tsx': 'text/typescript',
            '.jsx': 'text/javascript',
            '.rs': 'text/x-rust',
            '.go': 'text/x-go',
            '.sql': 'text/x-sql',
            '.sh': 'text/x-shellscript',
            '.html': 'text/html',
            '.css': 'text/css',
            '.scss': 'text/x-scss',
            '.vue': 'text/plain',
            '.svelte': 'text/plain',
            '.graphql': 'text/plain',
          };
          const mimeType = mimeTypes[ext] || 'text/plain';
          const fileName = relativePath.replace(/\//g, '_');

          // Use native FormData with Blob for reliable file uploads
          const formData = new FormData();
          const blob = new Blob([fileBuffer], { type: mimeType });
          formData.append('file', blob, fileName);

          const uploadResponse = await fetch(`${this.apiURL}/sources/${folderId}/upload`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.password}`,
            },
            body: formData,
          });

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Status code: ${uploadResponse.status}\nBody: ${errorText}`);
          }

          const fileMetadata = await uploadResponse.json();

          // Update tracking in database
          db.upsertProjectFile({
            project_identifier: projectIdentifier,
            relative_path: relativePath,
            content_hash: currentHash,
            letta_file_id: fileMetadata.id,
            file_size: fileStats.size,
          });

          console.log(`[Letta] ${tracked ? 'Updated' : 'Uploaded'}: ${relativePath}`);
          stats.uploaded++;
        } catch (fileError) {
          console.warn(`[Letta] Failed to sync ${relativePath}: ${fileError.message}`);
          stats.errors++;
        }
      }

      console.log(
        `[Letta] ✓ Incremental sync complete: ${stats.uploaded} uploaded, ${stats.deleted} deleted, ${stats.skipped} unchanged, ${stats.errors} errors`
      );
      return stats;
    } catch (error) {
      console.error(`[Letta] Error in incremental file sync:`, error.message);
      throw error;
    }
  }

  /**
   * Upload README file to a source (idempotent - replaces existing)
   *
   * @param {string} sourceId - Source ID
   * @param {string} readmePath - Filesystem path to README.md
   * @param {string} projectIdentifier - Project identifier for naming
   * @returns {Promise<Object>} File metadata object
   */
  async uploadReadme(sourceId, readmePath, projectIdentifier) {
    // Skip upload if sourceId is null (placeholder from 409 conflict)
    if (!sourceId) {
      console.warn(`[Letta] Source ID is null, skipping README upload for ${projectIdentifier}`);
      return null;
    }

    console.log(`[Letta] Uploading README from ${readmePath} to source ${sourceId}`);

    try {
      // Check if file exists
      if (!fs.existsSync(readmePath)) {
        console.warn(`[Letta] README not found at ${readmePath}, skipping upload`);
        return null;
      }

      // Create read stream for file
      const fileStream = fs.createReadStream(readmePath);
      const fileName = `${projectIdentifier}-README.md`;

      // Upload file (use 'replace' to overwrite existing)
      const fileMetadata = await this.client.sources.files.upload(fileStream, sourceId, {
        name: fileName,
        duplicateHandling: 'replace', // Replace existing file with same name
      });

      console.log(`[Letta] README uploaded successfully: ${fileMetadata.id}`);
      return fileMetadata;
    } catch (error) {
      console.error(`[Letta] Error uploading README:`, error.message);
      throw error;
    }
  }
}
