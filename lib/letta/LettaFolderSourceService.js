/**
 * LettaFolderSourceService — folder, source, and file management.
 */

import { fetchWithPool } from '../http.js';
import { LettaFileService } from '../LettaFileService.js';

export class LettaFolderSourceService {
  constructor(config, host) {
    this.config = config;
    // host is the facade (LettaService), passed as-is so LettaFileService
    // picks up test mocks on `host.client`, `host.apiURL`, etc.
    this.fileService = new LettaFileService(host);
    this._folderCache = new Map();
    this._sourceCache = new Map();
  }

  clearCache() {
    this._folderCache.clear();
    this._sourceCache.clear();
  }

  async ensureFolder(projectIdentifier, filesystemPath = null) {
    const client = this.config.client;
    const folderName = `Huly-${projectIdentifier}`;

    if (this._folderCache.has(folderName)) {
      const cached = this._folderCache.get(folderName);
      console.log(`[Letta] Folder exists (cached): ${cached.id}`);
      return cached;
    }

    console.log(`[Letta] Ensuring folder exists: ${folderName}`);

    try {
      const folders = await client.folders.list({ name: folderName, limit: 1 });

      if (folders && folders.length > 0) {
        const existingFolder = folders[0];
        console.log(`[Letta] Folder already exists: ${existingFolder.id}`);
        this._folderCache.set(folderName, existingFolder);
        return existingFolder;
      }

      console.log(`[Letta] Creating new folder: ${folderName}`);
      const folderData = {
        name: folderName,
        description: filesystemPath
          ? `Filesystem folder for ${projectIdentifier} project at ${filesystemPath}`
          : `Documentation folder for ${projectIdentifier} project`,
        embedding: this.config.embedding,
      };

      if (filesystemPath) {
        folderData.metadata = { filesystem_path: filesystemPath };
      }

      const folder = await client.folders.create(folderData);
      console.log(`[Letta] Folder created successfully: ${folder.id}`);
      this._folderCache.set(folderName, folder);
      return folder;
    } catch (error) {
      console.error(`[Letta] Error ensuring folder:`, error.message);
      throw error;
    }
  }

  async attachFolderToAgent(agentId, folderId) {
    const client = this.config.client;
    console.log(`[Letta] Attaching folder ${folderId} to agent ${agentId}`);

    try {
      const attachedFolders = await client.agents.folders.list(agentId);
      const alreadyAttached = attachedFolders.some(f => f.id === folderId);

      if (alreadyAttached) {
        console.log(`[Letta] Folder ${folderId} already attached to agent`);
        return;
      }

      await client.agents.folders.attach(agentId, folderId);
      console.log(`[Letta] Folder ${folderId} attached to agent ${agentId}`);
    } catch (error) {
      console.error(`[Letta] Error attaching folder to agent:`, error.message);
      throw error;
    }
  }

  async listFolderFiles(folderId) {
    return this.fileService.listFolderFiles(folderId);
  }

  async closeAllFiles(agentId) {
    return this.fileService.closeAllFiles(agentId);
  }

  async ensureSource(sourceName, folderId = null) {
    const client = this.config.client;
    const { apiURL, password, embedding } = this.config;

    if (this._sourceCache.has(sourceName)) {
      const cached = this._sourceCache.get(sourceName);
      console.log(`[Letta] Source exists (cached): ${cached.id}`);
      return cached;
    }

    console.log(`[Letta] Ensuring source exists: ${sourceName}`);

    try {
      const sources = await client.sources.list();
      sources.forEach(s => this._sourceCache.set(s.name, s));

      const existingSource = sources.find(s => s.name === sourceName);

      if (existingSource) {
        console.log(`[Letta] Source already exists: ${existingSource.id}`);
        return existingSource;
      }

      console.log(`[Letta] Creating new source: ${sourceName}`);
      const source = await client.sources.create({
        name: sourceName,
        description: `Source for ${sourceName}`,
        embedding,
      });

      console.log(`[Letta] Source created: ${source.id}`);
      this._sourceCache.set(sourceName, source);
      return source;
    } catch (error) {
      if (error.message && error.message.includes('409')) {
        console.log(`[Letta] Source ${sourceName} already exists (409 conflict), fetching it...`);

        try {
          const response = await fetchWithPool(
            `${apiURL}/sources?name=${encodeURIComponent(sourceName)}&limit=10`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${password}`,
                'Content-Type': 'application/json',
              },
            }
          );

          if (response.ok) {
            const sources = await response.json();
            const existingSource = sources.find(s => s.name === sourceName);

            if (existingSource) {
              console.log(`[Letta] ✓ Found existing source via REST API: ${existingSource.id}`);
              this._sourceCache.set(sourceName, existingSource);
              return existingSource;
            }
          }

          const allSources = await client.sources.list({ limit: 200 });
          allSources.forEach(s => this._sourceCache.set(s.name, s));

          const foundSource = allSources.find(s => s.name === sourceName);
          if (foundSource) {
            console.log(`[Letta] ✓ Found existing source via SDK list: ${foundSource.id}`);
            return foundSource;
          }

          console.warn(
            `[Letta] ⚠️  Source ${sourceName} exists (409) but couldn't be found. Skipping upload.`
          );
          return { id: null, name: sourceName, _placeholder: true };
        } catch (refetchError) {
          console.error(`[Letta] Failed to refetch source after 409:`, refetchError.message);
          return { id: null, name: sourceName, _placeholder: true };
        }
      }

      console.error(`[Letta] Error ensuring source ${sourceName}:`, error.message);
      throw error;
    }
  }

  async discoverProjectFiles(projectPath, options = { docsOnly: true }) {
    return this.fileService.discoverProjectFiles(projectPath, options);
  }

  async discoverProjectFilesLegacy(projectPath) {
    return this.fileService.discoverProjectFilesLegacy(projectPath);
  }

  async uploadProjectFiles(folderId, projectPath, files, maxFiles = 50) {
    return this.fileService.uploadProjectFiles(folderId, projectPath, files, maxFiles);
  }

  computeFileHash(filePath) {
    return this.fileService.computeFileHash(filePath);
  }

  async deleteFile(folderId, fileId) {
    return this.fileService.deleteFile(folderId, fileId);
  }

  async syncProjectFilesIncremental(folderId, projectPath, files, db, projectIdentifier) {
    return this.fileService.syncProjectFilesIncremental(
      folderId,
      projectPath,
      files,
      db,
      projectIdentifier
    );
  }

  async uploadReadme(sourceId, readmePath, projectIdentifier) {
    return this.fileService.uploadReadme(sourceId, readmePath, projectIdentifier);
  }

  async attachSourceToAgent(agentId, sourceId) {
    const client = this.config.client;
    console.log(`[Letta] Attaching source ${sourceId} to agent ${agentId}`);

    try {
      const attachedSources = await client.agents.sources.list(agentId);
      const alreadyAttached = attachedSources.some(s => s.id === sourceId);

      if (alreadyAttached) {
        console.log(`[Letta] Source ${sourceId} already attached to agent`);
        return;
      }

      await client.agents.sources.attach(agentId, sourceId);
      console.log(`[Letta] Source ${sourceId} attached to agent ${agentId}`);
    } catch (error) {
      console.error(`[Letta] Error attaching source to agent:`, error.message);
      throw error;
    }
  }
}
