import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from './logger';
import type { FunctionInfo, ImportInfo, ClassInfo, ExportInfo } from './ASTParser.js';

interface CachedFile {
  path: string;
  contentHash: string;
  mtime: number;
  functions: FunctionInfo[];
  imports: ImportInfo[];
  classes: ClassInfo[];
  exports: ExportInfo[];
  parsedAt: number;
}

interface ProjectCache {
  projectId: string;
  version: number;
  updatedAt: number;
  files: Record<string, CachedFile>;
}

interface DiffResult {
  added: FunctionInfo[];
  modified: { previous: FunctionInfo; current: FunctionInfo }[];
  removed: FunctionInfo[];
  unchanged: FunctionInfo[];
}

const CACHE_VERSION = 2;
const DEFAULT_CACHE_DIR = '.vibesync-cache';

export class ASTCache {
  projectId: string;
  projectPath: string;
  cacheDir: string;
  cachePath: string;
  log: ReturnType<typeof logger.child>;
  cache: ProjectCache | null = null;
  dirty = false;

  constructor(options: { projectId: string; projectPath: string; cacheDir?: string }) {
    this.projectId = options.projectId;
    this.projectPath = options.projectPath;
    this.cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
    this.cachePath = path.join(this.projectPath, this.cacheDir, 'ast-cache.json');
    this.log = logger.child({ service: 'ASTCache', project: this.projectId });
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.cachePath, 'utf-8');
      const parsed = JSON.parse(data) as ProjectCache;
      if (parsed.version !== CACHE_VERSION) {
        this.log.info({ oldVersion: parsed.version }, 'Cache version mismatch, starting fresh');
        this.cache = this._createEmptyCache();
        return;
      }
      this.cache = parsed;
      this.log.debug({ files: Object.keys(this.cache.files).length }, 'Loaded cache from disk');
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') {
        this.log.debug('No existing cache, starting fresh');
      } else {
        this.log.warn({ err }, 'Failed to load cache, starting fresh');
      }
      this.cache = this._createEmptyCache();
    }
  }

  async save(): Promise<void> {
    if (!this.dirty || !this.cache) return;
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

  get(filePath: string): CachedFile | null {
    if (!this.cache) return null;
    return this.cache.files[filePath] || null;
  }

  set(filePath: string, contentHash: string, mtime: number, functions: FunctionInfo[], imports: ImportInfo[] = [], classes: ClassInfo[] = [], exports: ExportInfo[] = []): void {
    if (!this.cache) this.cache = this._createEmptyCache();
    this.cache.files[filePath] = { path: filePath, contentHash, mtime, functions, imports, classes, exports, parsedAt: Date.now() };
    this.dirty = true;
  }

  remove(filePath: string): boolean {
    if (!this.cache || !this.cache.files[filePath]) return false;
    delete this.cache.files[filePath];
    this.dirty = true;
    return true;
  }

  needsReparse(filePath: string, contentHash: string): boolean {
    const cached = this.get(filePath);
    if (!cached) return true;
    return cached.contentHash !== contentHash;
  }

  getCachedFiles(): string[] {
    if (!this.cache) return [];
    return Object.keys(this.cache.files);
  }

  diff(filePath: string, currentFunctions: FunctionInfo[]): DiffResult {
    const cached = this.get(filePath);
    const previousFunctions = cached?.functions || [];
    const previousMap = new Map(previousFunctions.map(f => [f.name, f]));
    const currentMap = new Map(currentFunctions.map(f => [f.name, f]));

    const added: FunctionInfo[] = [];
    const modified: { previous: FunctionInfo; current: FunctionInfo }[] = [];
    const removed: FunctionInfo[] = [];
    const unchanged: FunctionInfo[] = [];

    for (const [name, func] of currentMap) {
      const prev = previousMap.get(name);
      if (!prev) { added.push(func); }
      else if (this._functionChanged(prev, func)) { modified.push({ previous: prev, current: func }); }
      else { unchanged.push(func); }
    }
    for (const [name, func] of previousMap) {
      if (!currentMap.has(name)) removed.push(func);
    }
    return { added, modified, removed, unchanged };
  }

  static computeHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private _createEmptyCache(): ProjectCache {
    return { projectId: this.projectId, version: CACHE_VERSION, updatedAt: Date.now(), files: {} };
  }

  private _functionChanged(prev: FunctionInfo, curr: FunctionInfo): boolean {
    return prev.signature !== curr.signature ||
      prev.docstring !== curr.docstring ||
      prev.start_line !== curr.start_line ||
      prev.end_line !== curr.end_line;
  }

  getStats(): { files: number; functions: number; updatedAt?: number } {
    if (!this.cache) return { files: 0, functions: 0 };
    const fileCount = Object.keys(this.cache.files).length;
    const functionCount = Object.values(this.cache.files).reduce((sum, f) => sum + (f.functions?.length || 0), 0);
    return { files: fileCount, functions: functionCount, updatedAt: this.cache.updatedAt };
  }
}

export default ASTCache;
