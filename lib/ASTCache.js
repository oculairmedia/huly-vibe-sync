/**
 * ASTCache - Local cache for AST parse results
 *
 * Stores previous parse results to enable diff detection.
 * Cache is stored as JSON files per project in the data directory.
 *
 * @module ASTCache
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from './logger.js';

/**
 * @typedef {import('./ASTParser.js').FunctionInfo} FunctionInfo
 */

/**
 * @typedef {Object} CachedFile
 * @property {string} path - File path
 * @property {string} contentHash - MD5 hash of file content
 * @property {number} mtime - File modification time
 * @property {FunctionInfo[]} functions - Extracted functions
 * @property {number} parsedAt - Timestamp when parsed
 */

/**
 * @typedef {Object} ProjectCache
 * @property {string} projectId - Project identifier
 * @property {number} version - Cache format version
 * @property {number} updatedAt - Last update timestamp
 * @property {Object<string, CachedFile>} files - Map of file path to cached data
 */

const CACHE_VERSION = 1;
const DEFAULT_CACHE_DIR = '.vibesync-cache';

export class ASTCache {
  /**
   * Create a new ASTCache instance
   *
   * @param {Object} options - Options
   * @param {string} options.projectId - Project identifier
   * @param {string} options.projectPath - Project root path
   * @param {string} [options.cacheDir] - Cache directory (relative to project)
   */
  constructor(options) {
    this.projectId = options.projectId;
    this.projectPath = options.projectPath;
    this.cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
    this.cachePath = path.join(this.projectPath, this.cacheDir, 'ast-cache.json');
    this.log = logger.child({ service: 'ASTCache', project: this.projectId });

    /** @type {ProjectCache|null} */
    this.cache = null;
    this.dirty = false;
  }

  /**
   * Load cache from disk
   *
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const data = await fs.readFile(this.cachePath, 'utf-8');
      const parsed = JSON.parse(data);

      if (parsed.version !== CACHE_VERSION) {
        this.log.info({ oldVersion: parsed.version }, 'Cache version mismatch, starting fresh');
        this.cache = this._createEmptyCache();
        return;
      }

      this.cache = parsed;
      this.log.debug({ files: Object.keys(this.cache.files).length }, 'Loaded cache from disk');
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.log.debug('No existing cache, starting fresh');
      } else {
        this.log.warn({ err }, 'Failed to load cache, starting fresh');
      }
      this.cache = this._createEmptyCache();
    }
  }

  /**
   * Save cache to disk
   *
   * @returns {Promise<void>}
   */
  async save() {
    if (!this.dirty || !this.cache) {
      return;
    }

    try {
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      this.cache.updatedAt = Date.now();
      await fs.writeFile(this.cachePath, JSON.stringify(this.cache, null, 2));
      this.dirty = false;
      this.log.debug({ files: Object.keys(this.cache.files).length }, 'Saved cache to disk');
    } catch (err) {
      this.log.error({ err }, 'Failed to save cache');
    }
  }

  /**
   * Get cached data for a file
   *
   * @param {string} filePath - Relative file path
   * @returns {CachedFile|null} Cached file data or null
   */
  get(filePath) {
    if (!this.cache) {
      return null;
    }
    return this.cache.files[filePath] || null;
  }

  /**
   * Set cached data for a file
   *
   * @param {string} filePath - Relative file path
   * @param {string} contentHash - MD5 hash of file content
   * @param {number} mtime - File modification time
   * @param {FunctionInfo[]} functions - Extracted functions
   */
  set(filePath, contentHash, mtime, functions) {
    if (!this.cache) {
      this.cache = this._createEmptyCache();
    }

    this.cache.files[filePath] = {
      path: filePath,
      contentHash,
      mtime,
      functions,
      parsedAt: Date.now(),
    };
    this.dirty = true;
  }

  /**
   * Remove a file from cache
   *
   * @param {string} filePath - Relative file path
   * @returns {boolean} True if file was in cache
   */
  remove(filePath) {
    if (!this.cache || !this.cache.files[filePath]) {
      return false;
    }

    delete this.cache.files[filePath];
    this.dirty = true;
    return true;
  }

  /**
   * Check if a file needs re-parsing based on content hash
   *
   * @param {string} filePath - Relative file path
   * @param {string} contentHash - Current content hash
   * @returns {boolean} True if file needs re-parsing
   */
  needsReparse(filePath, contentHash) {
    const cached = this.get(filePath);
    if (!cached) {
      return true;
    }
    return cached.contentHash !== contentHash;
  }

  /**
   * Get all cached file paths
   *
   * @returns {string[]} Array of cached file paths
   */
  getCachedFiles() {
    if (!this.cache) {
      return [];
    }
    return Object.keys(this.cache.files);
  }

  /**
   * Get diff between cached and current functions
   *
   * @param {string} filePath - Relative file path
   * @param {FunctionInfo[]} currentFunctions - Currently extracted functions
   * @returns {Object} Diff result with added, modified, removed functions
   */
  diff(filePath, currentFunctions) {
    const cached = this.get(filePath);
    const previousFunctions = cached?.functions || [];

    const previousMap = new Map(previousFunctions.map(f => [f.name, f]));
    const currentMap = new Map(currentFunctions.map(f => [f.name, f]));

    const added = [];
    const modified = [];
    const removed = [];
    const unchanged = [];

    for (const [name, func] of currentMap) {
      const prev = previousMap.get(name);
      if (!prev) {
        added.push(func);
      } else if (this._functionChanged(prev, func)) {
        modified.push({ previous: prev, current: func });
      } else {
        unchanged.push(func);
      }
    }

    for (const [name, func] of previousMap) {
      if (!currentMap.has(name)) {
        removed.push(func);
      }
    }

    return { added, modified, removed, unchanged };
  }

  /**
   * Compute MD5 hash of content
   *
   * @param {string} content - File content
   * @returns {string} MD5 hash
   */
  static computeHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Create empty cache structure
   *
   * @private
   * @returns {ProjectCache}
   */
  _createEmptyCache() {
    return {
      projectId: this.projectId,
      version: CACHE_VERSION,
      updatedAt: Date.now(),
      files: {},
    };
  }

  /**
   * Check if two functions are different
   *
   * @private
   * @param {FunctionInfo} prev - Previous function
   * @param {FunctionInfo} curr - Current function
   * @returns {boolean} True if function changed
   */
  _functionChanged(prev, curr) {
    return (
      prev.signature !== curr.signature ||
      prev.docstring !== curr.docstring ||
      prev.start_line !== curr.start_line ||
      prev.end_line !== curr.end_line
    );
  }

  /**
   * Get statistics about the cache
   *
   * @returns {Object} Cache statistics
   */
  getStats() {
    if (!this.cache) {
      return { files: 0, functions: 0 };
    }

    const files = Object.keys(this.cache.files).length;
    const functions = Object.values(this.cache.files).reduce(
      (sum, f) => sum + (f.functions?.length || 0),
      0
    );

    return { files, functions, updatedAt: this.cache.updatedAt };
  }
}

export default ASTCache;
