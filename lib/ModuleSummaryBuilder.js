import path from 'path';

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'vendor',
  '__pycache__',
  '.venv',
  'coverage',
]);

const SUMMARY_MAX_LENGTH = 2000;
const KNOWN_EXTENSIONS = [
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.py',
  '.pyw',
];

/**
 * @typedef {{
 *   path: string,
 *   name: string,
 *   lineCount: number | null,
 *   functionCount: number
 * }} ModuleFile
 */

/**
 * @typedef {{
 *   files: ModuleFile[],
 *   functionCount: number,
 *   asyncFunctionCount: number,
 *   classCount: number,
 *   classNames: Set<string>,
 *   exportFrequency: Map<string, number>,
 *   languages: Set<string>
 * }} ModuleStats
 */

export class ModuleSummaryBuilder {
  /**
   * Build module-level summaries from AST cache file data.
   * @param {object} astCache AST cache instance with `cache.files` map.
   * @param {string} projectId Project identifier (for Graphiti entity naming).
   * @returns {Array<{
   *   name: string,
   *   summary: string,
   *   files: string[],
   *   functionCount: number,
   *   classCount: number,
   *   keyExports: string[],
   *   languages: string[]
   * }>} Module summary objects.
   */
  buildModuleSummaries(astCache, projectId) {
    const files = this._getFilesMap(astCache);
    /** @type {Map<string, ModuleStats>} */
    const moduleStats = new Map();

    for (const [rawFilePath, fileData] of Object.entries(files)) {
      const filePath = this._normalizePath(rawFilePath);
      if (this._isIgnoredPath(filePath)) {
        continue;
      }

      const moduleDir = this._getModuleDir(filePath);
      if (!moduleDir) {
        continue;
      }

      if (!moduleStats.has(moduleDir)) {
        moduleStats.set(moduleDir, this._createModuleStats());
      }

      const stats = moduleStats.get(moduleDir);
      const functionCount = this._toArray(fileData.functions).length;
      const asyncFunctionCount = this._toArray(fileData.functions).filter(fn =>
        Boolean(fn && fn.is_async)
      ).length;
      const classes = this._toArray(fileData.classes);
      const exports = this._toArray(fileData.exports);
      const language = this._detectLanguage(filePath);
      const lineCount = this._extractLineCount(fileData);

      stats.files.push({
        path: filePath,
        name: path.posix.basename(filePath),
        lineCount,
        functionCount,
      });
      stats.functionCount += functionCount;
      stats.asyncFunctionCount += asyncFunctionCount;
      stats.classCount += classes.length;
      stats.languages.add(language);

      for (const cls of classes) {
        if (cls && typeof cls.name === 'string' && cls.name.trim()) {
          stats.classNames.add(cls.name.trim());
        }
      }

      for (const exp of exports) {
        const exportName = this._extractExportName(exp);
        if (!exportName) {
          continue;
        }

        const prev = stats.exportFrequency.get(exportName) || 0;
        stats.exportFrequency.set(exportName, prev + 1);
      }
    }

    return Array.from(moduleStats.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([moduleDir, stats]) => {
        const files = stats.files.map(file => file.path).sort((a, b) => a.localeCompare(b));
        const keyExports = this._selectTopExports(stats.exportFrequency, 10);
        const languages = Array.from(stats.languages).sort((a, b) => a.localeCompare(b));
        const summary = this._truncateSummary(
          this._buildSummaryText(moduleDir, stats, keyExports, languages),
          SUMMARY_MAX_LENGTH
        );

        return {
          name: `Module:${projectId}:${moduleDir}`,
          summary,
          files,
          functionCount: stats.functionCount,
          classCount: stats.classCount,
          keyExports,
          languages,
        };
      });
  }

  /**
   * Build inter-module dependency edges based on file imports.
   * @param {object} astCache AST cache instance with `cache.files` map.
   * @param {string} projectId Project identifier (for Graphiti entity naming).
   * @returns {Array<{
   *   sourceModule: string,
   *   targetModule: string,
   *   fact: string
   * }>} Dependency edge facts between project modules.
   */
  buildDependencyEdges(astCache, projectId) {
    const files = this._getFilesMap(astCache);
    /** @type {Set<string>} */
    const knownFiles = new Set();

    for (const rawFilePath of Object.keys(files)) {
      const filePath = this._normalizePath(rawFilePath);
      if (!this._isIgnoredPath(filePath)) {
        knownFiles.add(filePath);
      }
    }

    const edges = new Map();

    for (const [rawFilePath, fileData] of Object.entries(files)) {
      const sourceFilePath = this._normalizePath(rawFilePath);
      if (this._isIgnoredPath(sourceFilePath)) {
        continue;
      }

      const sourceDir = this._getModuleDir(sourceFilePath);
      if (!sourceDir) {
        continue;
      }

      const imports = this._toArray(fileData.imports);
      for (const importEntry of imports) {
        const importSource =
          importEntry && typeof importEntry.source === 'string' ? importEntry.source : '';
        const targetFilePath = this._resolveInternalImport(
          importSource,
          sourceFilePath,
          knownFiles
        );
        if (!targetFilePath) {
          continue;
        }

        const targetDir = this._getModuleDir(targetFilePath);
        if (!targetDir || sourceDir === targetDir) {
          continue;
        }

        const key = `${sourceDir}=>${targetDir}`;
        if (!edges.has(key)) {
          edges.set(key, {
            sourceDir,
            targetDir,
            importNames: new Set(),
          });
        }

        const names = this._normalizeImportNames(importEntry && importEntry.names);
        const edge = edges.get(key);
        for (const name of names) {
          edge.importNames.add(name);
        }
      }
    }

    return Array.from(edges.values())
      .sort((a, b) => {
        const bySource = a.sourceDir.localeCompare(b.sourceDir);
        return bySource !== 0 ? bySource : a.targetDir.localeCompare(b.targetDir);
      })
      .map(edge => {
        const importNames = Array.from(edge.importNames).sort((a, b) => a.localeCompare(b));
        const importText = importNames.length > 0 ? importNames.join(', ') : 'unknown';
        return {
          sourceModule: `Module:${projectId}:${edge.sourceDir}`,
          targetModule: `Module:${projectId}:${edge.targetDir}`,
          fact: `Module ${edge.sourceDir} depends on module ${edge.targetDir} (imports: ${importText})`,
        };
      });
  }

  /**
   * @param {object} astCache
   * @returns {Record<string, any>}
   */
  _getFilesMap(astCache) {
    const files = astCache && astCache.cache && astCache.cache.files;
    return files && typeof files === 'object' ? files : {};
  }

  /**
   * @returns {ModuleStats}
   */
  _createModuleStats() {
    return {
      files: [],
      functionCount: 0,
      asyncFunctionCount: 0,
      classCount: 0,
      classNames: new Set(),
      exportFrequency: new Map(),
      languages: new Set(),
    };
  }

  /**
   * @param {string} filePath
   * @returns {string}
   */
  _normalizePath(filePath) {
    if (typeof filePath !== 'string') {
      return '';
    }

    const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    return path.posix.normalize(normalized);
  }

  /**
   * @param {string} filePath
   * @returns {boolean}
   */
  _isIgnoredPath(filePath) {
    if (!filePath) {
      return true;
    }

    const segments = filePath.split('/').filter(Boolean);
    return segments.some(segment => IGNORED_DIRECTORIES.has(segment));
  }

  /**
   * @param {string} filePath
   * @returns {string}
   */
  _getModuleDir(filePath) {
    const segments = filePath.split('/').filter(Boolean);
    if (segments.length < 2) {
      return '';
    }

    if (segments.length === 2) {
      return `${segments[0]}/`;
    }

    return `${segments[0]}/${segments[1]}/`;
  }

  /**
   * @param {any} value
   * @returns {any[]}
   */
  _toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  /**
   * @param {Record<string, any>} fileData
   * @returns {number | null}
   */
  _extractLineCount(fileData) {
    const candidateFields = ['lineCount', 'line_count', 'lines', 'totalLines'];
    for (const field of candidateFields) {
      const value = fileData && fileData[field];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
    }

    let maxLine = 0;
    for (const fn of this._toArray(fileData && fileData.functions)) {
      if (fn && typeof fn.end_line === 'number' && fn.end_line > maxLine) {
        maxLine = fn.end_line;
      }
    }

    for (const cls of this._toArray(fileData && fileData.classes)) {
      if (cls && typeof cls.end_line === 'number' && cls.end_line > maxLine) {
        maxLine = cls.end_line;
      }
    }

    return maxLine > 0 ? Math.floor(maxLine) : null;
  }

  /**
   * @param {any} exportEntry
   * @returns {string}
   */
  _extractExportName(exportEntry) {
    if (!exportEntry) {
      return '';
    }

    if (typeof exportEntry === 'string') {
      return exportEntry.trim();
    }

    if (typeof exportEntry.name === 'string') {
      return exportEntry.name.trim();
    }

    return '';
  }

  /**
   * @param {Map<string, number>} exportFrequency
   * @param {number} limit
   * @returns {string[]}
   */
  _selectTopExports(exportFrequency, limit) {
    return Array.from(exportFrequency.entries())
      .sort((a, b) => {
        const byCount = b[1] - a[1];
        return byCount !== 0 ? byCount : a[0].localeCompare(b[0]);
      })
      .slice(0, limit)
      .map(([name]) => name);
  }

  /**
   * @param {string} filePath
   * @returns {string}
   */
  _detectLanguage(filePath) {
    const extension = path.posix.extname(filePath).toLowerCase();
    if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
      return 'JavaScript';
    }

    if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
      return 'TypeScript';
    }

    if (extension === '.tsx' || extension === '.jsx') {
      return 'React';
    }

    if (extension === '.py' || extension === '.pyw') {
      return 'Python';
    }

    return extension ? extension.slice(1).toUpperCase() : 'Unknown';
  }

  /**
   * @param {string} moduleDir
   * @param {ModuleStats} stats
   * @param {string[]} keyExports
   * @param {string[]} languages
   * @returns {string}
   */
  _buildSummaryText(moduleDir, stats, keyExports, languages) {
    const filesLine = stats.files
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(file => {
        const details = [];
        if (typeof file.lineCount === 'number') {
          details.push(`${file.lineCount} lines`);
        }

        if (file.functionCount > 0) {
          details.push(`${file.functionCount} function${file.functionCount === 1 ? '' : 's'}`);
        }

        return details.length > 0 ? `${file.name} (${details.join(', ')})` : file.name;
      })
      .join(', ');

    const classes = Array.from(stats.classNames).sort((a, b) => a.localeCompare(b));
    const exportsText = keyExports.length > 0 ? keyExports.join(', ') : 'None';
    const languagesText = languages.length > 0 ? languages.join(', ') : 'Unknown';

    return [
      `Code module: ${moduleDir}`,
      `Files: ${filesLine || 'None'}`,
      `Functions: ${stats.functionCount} total (${stats.asyncFunctionCount} async)`,
      `Classes: ${stats.classCount}${classes.length > 0 ? ` (${classes.join(', ')})` : ''}`,
      `Key exports: ${exportsText}`,
      `Languages: ${languagesText}`,
    ].join('\n');
  }

  /**
   * @param {string} summary
   * @param {number} maxLength
   * @returns {string}
   */
  _truncateSummary(summary, maxLength) {
    if (summary.length <= maxLength) {
      return summary;
    }

    return `${summary.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  /**
   * @param {any} names
   * @returns {string[]}
   */
  _normalizeImportNames(names) {
    const input = Array.isArray(names) ? names : [];
    const result = new Set();

    for (const name of input) {
      if (typeof name !== 'string') {
        continue;
      }

      const cleaned = name.trim();
      if (!cleaned) {
        continue;
      }

      result.add(cleaned);
    }

    return Array.from(result);
  }

  /**
   * @param {string} importSource
   * @param {string} sourceFilePath
   * @param {Set<string>} knownFiles
   * @returns {string | null}
   */
  _resolveInternalImport(importSource, sourceFilePath, knownFiles) {
    if (!importSource || typeof importSource !== 'string') {
      return null;
    }

    const source = importSource.trim();
    if (!source) {
      return null;
    }

    if (source.startsWith('.') || source.startsWith('/')) {
      const baseDir = source.startsWith('.') ? path.posix.dirname(sourceFilePath) : '';
      const resolvedBase = source.startsWith('.')
        ? path.posix.normalize(path.posix.join(baseDir, source))
        : path.posix.normalize(source.replace(/^\//, ''));
      return this._resolveFromBasePath(resolvedBase, knownFiles);
    }

    if (source.startsWith('@')) {
      return null;
    }

    if (!source.includes('/')) {
      return null;
    }

    return this._resolveFromBasePath(this._normalizePath(source), knownFiles);
  }

  /**
   * @param {string} basePath
   * @param {Set<string>} knownFiles
   * @returns {string | null}
   */
  _resolveFromBasePath(basePath, knownFiles) {
    const normalizedBase = this._normalizePath(basePath);
    const candidates = this._buildImportCandidates(normalizedBase);

    for (const candidate of candidates) {
      if (knownFiles.has(candidate) && !this._isIgnoredPath(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * @param {string} basePath
   * @returns {string[]}
   */
  _buildImportCandidates(basePath) {
    const candidates = new Set();
    candidates.add(basePath);

    const ext = path.posix.extname(basePath);
    if (!ext) {
      for (const knownExt of KNOWN_EXTENSIONS) {
        candidates.add(`${basePath}${knownExt}`);
        candidates.add(path.posix.join(basePath, `index${knownExt}`));
      }
    } else {
      for (const knownExt of KNOWN_EXTENSIONS) {
        candidates.add(path.posix.join(basePath.slice(0, -ext.length), `index${knownExt}`));
      }
    }

    return Array.from(candidates);
  }
}
