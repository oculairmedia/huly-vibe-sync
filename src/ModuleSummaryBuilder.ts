import path from 'path';

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '__pycache__', '.venv', 'coverage']);
const SUMMARY_MAX_LENGTH = 2000;
const KNOWN_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx', '.py', '.pyw'];

interface ModuleFile { path: string; name: string; lineCount: number | null; functionCount: number }
interface ModuleStats { files: ModuleFile[]; functionCount: number; asyncFunctionCount: number; classCount: number; classNames: Set<string>; exportFrequency: Map<string, number>; languages: Set<string> }
export interface AstCacheInput { cache?: { files?: Record<string, object> } | null }

export class ModuleSummaryBuilder {
  buildModuleSummaries(astCache: AstCacheInput | null | undefined, projectId: string): { name: string; summary: string; files: string[]; functionCount: number; classCount: number; keyExports: string[]; languages: string[] }[] {
    const files = this._getFilesMap(astCache);
    const moduleStats = new Map<string, ModuleStats>();

    for (const [rawFilePath, fileData] of Object.entries(files)) {
      const filePath = this._normalizePath(rawFilePath);
      if (this._isIgnoredPath(filePath)) continue;
      const moduleDir = this._getModuleDir(filePath);
      if (!moduleDir) continue;

      if (!moduleStats.has(moduleDir)) moduleStats.set(moduleDir, this._createModuleStats());
      const stats = moduleStats.get(moduleDir)!;
      const fnArr = (Array.isArray(fileData.functions) ? fileData.functions : []) as Record<string, unknown>[];
      const functionCount = fnArr.length;
      const asyncCount = fnArr.filter((fn: Record<string, unknown>) => fn.is_async).length;
      const classes = (Array.isArray(fileData.classes) ? fileData.classes : []) as Record<string, unknown>[];
      const exports = (Array.isArray(fileData.exports) ? fileData.exports : []) as Record<string, unknown>[];
      const language = this._detectLanguage(filePath);
      const lineCount = this._extractLineCount(fileData);

      stats.files.push({ path: filePath, name: path.posix.basename(filePath), lineCount, functionCount });
      stats.functionCount += functionCount;
      stats.asyncFunctionCount += asyncCount;
      stats.classCount += classes.length;
      stats.languages.add(language);

      for (const cls of classes) {
        if (typeof cls.name === 'string' && cls.name.trim()) stats.classNames.add(cls.name.trim());
      }
      for (const exp of exports) {
        const name = this._extractExportName(exp);
        if (name) stats.exportFrequency.set(name, (stats.exportFrequency.get(name) || 0) + 1);
      }
    }

    return Array.from(moduleStats.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([moduleDir, stats]) => {
      const files = stats.files.map(f => f.path).sort((a, b) => a.localeCompare(b));
      const keyExports = this._selectTopExports(stats.exportFrequency, 10);
      const langs = Array.from(stats.languages).sort();
      const summary = this._truncateSummary(this._buildSummaryText(moduleDir, stats, keyExports, langs), SUMMARY_MAX_LENGTH);
      return { name: `Module:${projectId}:${moduleDir}`, summary, files, functionCount: stats.functionCount, classCount: stats.classCount, keyExports, languages: langs };
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildDependencyEdges(astCache: AstCacheInput | null | undefined, projectId: string): { sourceModule: string; targetModule: string; fact: string }[] {
    const files = this._getFilesMap(astCache);
    const knownFiles = new Set<string>();
    for (const rawFilePath of Object.keys(files)) {
      const fp = this._normalizePath(rawFilePath);
      if (!this._isIgnoredPath(fp)) knownFiles.add(fp);
    }
    const edges = new Map<string, { sourceDir: string; targetDir: string; importNames: Set<string> }>();
    for (const [rawFilePath, fileData] of Object.entries(files)) {
      const sourceFilePath = this._normalizePath(rawFilePath);
      if (this._isIgnoredPath(sourceFilePath)) continue;
      const sourceDir = this._getModuleDir(sourceFilePath);
      if (!sourceDir) continue;
      const imports = (Array.isArray(fileData.imports) ? fileData.imports : []) as Record<string, unknown>[];
      for (const imp of imports) {
        const importSource = typeof imp.source === 'string' ? imp.source : '';
        const targetFilePath = this._resolveInternalImport(importSource, sourceFilePath, knownFiles);
        if (!targetFilePath) continue;
        const targetDir = this._getModuleDir(targetFilePath);
        if (!targetDir || sourceDir === targetDir) continue;
        const key = `${sourceDir}=>${targetDir}`;
        if (!edges.has(key)) edges.set(key, { sourceDir, targetDir, importNames: new Set() });
        const edge = edges.get(key)!;
        for (const name of this._normalizeImportNames(imp.names)) edge.importNames.add(name);
      }
    }
    return Array.from(edges.values()).sort((a, b) => {
      const bySource = a.sourceDir.localeCompare(b.sourceDir);
      return bySource !== 0 ? bySource : a.targetDir.localeCompare(b.targetDir);
    }).map(edge => {
      const importNames = Array.from(edge.importNames).sort();
      return { sourceModule: `Module:${projectId}:${edge.sourceDir}`, targetModule: `Module:${projectId}:${edge.targetDir}`, fact: `Module ${edge.sourceDir} depends on module ${edge.targetDir} (imports: ${importNames.length > 0 ? importNames.join(', ') : 'unknown'})` };
    });
  }

  private _getFilesMap(astCache: AstCacheInput | null | undefined): Record<string, Record<string, unknown>> {
    const files = (astCache as Record<string, Record<string, Record<string, Record<string, unknown>>>>)?.cache?.files;
    return files && typeof files === 'object' ? files as Record<string, Record<string, unknown>> : {};
  }

  private _createModuleStats(): ModuleStats { return { files: [], functionCount: 0, asyncFunctionCount: 0, classCount: 0, classNames: new Set(), exportFrequency: new Map(), languages: new Set() }; }
  private _normalizePath(filePath: string): string { if (typeof filePath !== 'string') return ''; return path.posix.normalize(filePath.replace(/\\/g, '/').replace(/^\.\//, '')); }
  private _isIgnoredPath(filePath: string): boolean { if (!filePath) return true; return filePath.split('/').filter(Boolean).some(segment => IGNORED_DIRECTORIES.has(segment)); }
  private _getModuleDir(filePath: string): string { const segments = filePath.split('/').filter(Boolean); if (segments.length < 2) return ''; return segments.length === 2 ? `${segments[0]}/` : `${segments[0]}/${segments[1]}/`; }

  private _extractLineCount(fileData: Record<string, unknown> | undefined): number | null {
    for (const field of ['lineCount', 'line_count', 'lines', 'totalLines']) { const v = fileData?.[field]; if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v); }
    let maxLine = 0;
    for (const fn of (Array.isArray(fileData?.functions) ? fileData!.functions : []) as Record<string, unknown>[]) {
      if (typeof fn.end_line === 'number' && fn.end_line > maxLine) maxLine = fn.end_line;
    }
    for (const cls of (Array.isArray(fileData?.classes) ? fileData!.classes : []) as Record<string, unknown>[]) {
      if (typeof cls.end_line === 'number' && cls.end_line > maxLine) maxLine = cls.end_line;
    }
    return maxLine > 0 ? Math.floor(maxLine) : null;
  }

  private _extractExportName(exportEntry: unknown): string {
    if (!exportEntry) return '';
    if (typeof exportEntry === 'string') return exportEntry.trim();
    if (typeof (exportEntry as { name?: unknown }).name === 'string') return ((exportEntry as { name: string }).name).trim();
    return '';
  }

  private _selectTopExports(exportFrequency: Map<string, number>, limit: number): string[] {
    return Array.from(exportFrequency.entries()).sort((a, b) => { const byCount = b[1] - a[1]; return byCount !== 0 ? byCount : a[0].localeCompare(b[0]); }).slice(0, limit).map(([name]) => name);
  }

  private _detectLanguage(filePath: string): string {
    const ext = path.posix.extname(filePath).toLowerCase();
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'JavaScript';
    if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'TypeScript';
    if (ext === '.tsx' || ext === '.jsx') return 'React';
    if (ext === '.py' || ext === '.pyw') return 'Python';
    return ext ? ext.slice(1).toUpperCase() : 'Unknown';
  }

  private _buildSummaryText(moduleDir: string, stats: ModuleStats, keyExports: string[], languages: string[]): string {
    const filesLine = stats.files.slice().sort((a, b) => a.name.localeCompare(b.name)).map(file => {
      const details: string[] = [];
      if (typeof file.lineCount === 'number') details.push(`${file.lineCount} lines`);
      if (file.functionCount > 0) details.push(`${file.functionCount} function${file.functionCount === 1 ? '' : 's'}`);
      return details.length > 0 ? `${file.name} (${details.join(', ')})` : file.name;
    }).join(', ');
    const classes = Array.from(stats.classNames).sort();
    return [`Code module: ${moduleDir}`, `Files: ${filesLine || 'None'}`, `Functions: ${stats.functionCount} total (${stats.asyncFunctionCount} async)`, `Classes: ${stats.classCount}${classes.length > 0 ? ` (${classes.join(', ')})` : ''}`, `Key exports: ${keyExports.length > 0 ? keyExports.join(', ') : 'None'}`, `Languages: ${languages.length > 0 ? languages.join(', ') : 'Unknown'}`].join('\n');
  }

  private _truncateSummary(summary: string, maxLength: number): string { return summary.length <= maxLength ? summary : `${summary.slice(0, Math.max(0, maxLength - 3))}...`; }

  private _normalizeImportNames(names: unknown): string[] {
    const input = Array.isArray(names) ? names as string[] : [];
    const result = new Set<string>();
    for (const name of input) { if (typeof name === 'string') { const cleaned = name.trim(); if (cleaned) result.add(cleaned); } }
    return Array.from(result);
  }

  private _resolveInternalImport(importSource: string, sourceFilePath: string, knownFiles: Set<string>): string | null {
    if (!importSource || typeof importSource !== 'string') return null;
    const source = importSource.trim();
    if (!source) return null;
    if (source.startsWith('@') || (!source.includes('/') && !source.startsWith('.'))) return null;
    if (source.startsWith('.') || source.startsWith('/')) {
      const baseDir = source.startsWith('.') ? path.posix.dirname(sourceFilePath) : '';
      const resolvedBase = source.startsWith('.') ? path.posix.normalize(path.posix.join(baseDir, source)) : path.posix.normalize(source.replace(/^\//, ''));
      return this._resolveFromBasePath(resolvedBase, knownFiles);
    }
    return this._resolveFromBasePath(this._normalizePath(source), knownFiles);
  }

  private _resolveFromBasePath(basePath: string, knownFiles: Set<string>): string | null {
    const normalizedBase = this._normalizePath(basePath);
    for (const candidate of this._buildImportCandidates(normalizedBase)) { if (knownFiles.has(candidate) && !this._isIgnoredPath(candidate)) return candidate; }
    return null;
  }

  private _buildImportCandidates(basePath: string): string[] {
    const candidates = new Set<string>();
    candidates.add(basePath);
    const ext = path.posix.extname(basePath);
    if (!ext) { for (const knownExt of KNOWN_EXTENSIONS) { candidates.add(`${basePath}${knownExt}`); candidates.add(path.posix.join(basePath, `index${knownExt}`)); } }
    else { for (const knownExt of KNOWN_EXTENSIONS) { candidates.add(path.posix.join(basePath.slice(0, -ext.length), `index${knownExt}`)); } }
    return Array.from(candidates);
  }
}
