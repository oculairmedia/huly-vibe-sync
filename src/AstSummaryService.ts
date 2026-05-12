import path from 'path';
import { logger } from './logger';

const MIN_PUSH_INTERVAL = 15 * 60 * 1000;
const MAX_PUSH_INTERVAL = 60 * 60 * 1000;
const FILES_THRESHOLD = 5;
const FUNCTIONS_THRESHOLD = 10;

interface CachedFile {
  functions?: { name: string; docstring?: string | null; is_async?: boolean; end_line?: number }[];
  classes?: { name: string; end_line?: number }[];
  imports?: { source?: string; module?: string }[];
  exports?: { name: string; type: string; is_default?: boolean }[];
}

interface AstCache {
  cache?: { files?: Record<string, CachedFile> };
}

export class AstSummaryService {
  log = logger.child({ service: 'AstSummaryService' });
  recentChanges = new Map<string, { file: string; change: string; time: number; delta: string }[]>();
  lastPushTime = new Map<string, number>();

  generateSummary(astCache: AstCache | null | undefined, projectId: string, health: { syncStatus?: string; errors24h?: number; graphitiConnected?: boolean } = {}): Record<string, unknown> | null {
    if (!astCache?.cache?.files) {
      this.log.debug({ project: projectId }, 'No AST cache available');
      return null;
    }

    const files = Object.entries(astCache.cache.files);
    const relevant = files.filter(([p]) => this._isRelevantFile(p));

    const totalFiles = relevant.length;
    const totalFunctions = relevant.reduce((sum, [, d]) => sum + (d.functions?.length || 0), 0);
    const totalClasses = relevant.reduce((sum, [, d]) => sum + (d.classes?.length || 0), 0);
    const languages = this._detectLanguages(relevant);
    const structure = this._buildStructure(relevant);
    const qualitySignals = this._buildQualitySignals(relevant);
    const coupling = this._buildCoupling(relevant);

    return {
      updated: this._formatTimestamp(),
      summary: { files: totalFiles, functions: totalFunctions, classes: totalClasses, languages },
      health: { last_sync: this._formatTimestamp(), sync_status: health.syncStatus || 'green', errors_24h: health.errors24h ?? 0, graphiti_connected: health.graphitiConnected ?? false },
      structure, quality_signals: qualitySignals, coupling, last_sync: this._formatTimestamp(),
    };
  }

  recordChange(projectId: string, filePath: string, changeType: string, functionsDelta = 0): void {
    if (!this.recentChanges.has(projectId)) this.recentChanges.set(projectId, []);
    const changes = this.recentChanges.get(projectId)!;
    changes.unshift({ file: filePath, change: changeType, time: Date.now(), delta: functionsDelta > 0 ? `+${functionsDelta}` : `${functionsDelta}` });
    if (changes.length > 50) changes.length = 50;
  }

  shouldPush(projectId: string, { filesChanged = 0, functionsChanged = 0, hasError = false }: { filesChanged?: number; functionsChanged?: number; hasError?: boolean } = {}): boolean {
    const lastPush = this.lastPushTime.get(projectId) || 0;
    const elapsed = Date.now() - lastPush;
    if (elapsed >= MAX_PUSH_INTERVAL) return true;
    if (elapsed < MIN_PUSH_INTERVAL) return false;
    return filesChanged >= FILES_THRESHOLD || functionsChanged >= FUNCTIONS_THRESHOLD || hasError;
  }

  markPushed(projectId: string): void { this.lastPushTime.set(projectId, Date.now()); }

  private _isRelevantFile(filePath: string): boolean {
    return !filePath.includes('node_modules/') && !filePath.includes('.opencode/') && !filePath.includes('vibe-kanban-source/') && !filePath.includes('vendor/') && !filePath.includes('/dist/') && !filePath.includes('/build/') && !filePath.startsWith('.');
  }

  private _detectLanguages(files: [string, CachedFile][]): string[] {
    const langs = new Set<string>();
    const extMap: Record<string, string> = { '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.ts': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript', '.tsx': 'React', '.jsx': 'React', '.py': 'Python', '.pyw': 'Python' };
    for (const [fp] of files) { const ext = path.extname(fp).toLowerCase(); if (extMap[ext]) langs.add(extMap[ext]); }
    return Array.from(langs);
  }

  private _buildStructure(files: [string, CachedFile][]): Record<string, Record<string, number | string[]>> {
    const stats: Record<string, { files: number; functions: number; classes: number; modules: Set<string> }> = {};
    for (const [fp, data] of files) {
      const parts = fp.split('/');
      const dir = parts.length > 1 ? parts[0] + '/' : '(root)';
      if (!stats[dir]) stats[dir] = { files: 0, functions: 0, classes: 0, modules: new Set() };
      stats[dir].files++;
      stats[dir].functions += data.functions?.length || 0;
      stats[dir].classes += data.classes?.length || 0;
      if ((data.functions?.length || 0) >= 5) stats[dir].modules.add(path.basename(fp, path.extname(fp)));
    }
    const sorted = Object.entries(stats).sort((a, b) => b[1].functions - a[1].functions).slice(0, 10);
    const structure: Record<string, Record<string, number | string[]>> = {};
    for (const [dir, s] of sorted) {
      structure[dir] = { files: s.files, functions: s.functions, classes: s.classes };
      if (s.modules.size > 0) (structure[dir] as Record<string, unknown>).key_modules = Array.from(s.modules).slice(0, 5);
    }
    return structure;
  }

  private _buildCoupling(files: [string, CachedFile][]): { most_imported: { file: string; imported_by: number }[]; most_dependencies: { file: string; imports: number }[] } {
    const importedBy: Record<string, number> = {};
    const importCount: Record<string, number> = {};
    for (const [fp, data] of files) {
      const imports = data.imports || [];
      importCount[fp] = imports.length;
      for (const imp of imports) {
        const source = imp.source || imp.module || '';
        if (!source) continue;
        const key = source.replace(/^\.\//, '').replace(/\.(js|ts|mjs|cjs|jsx|tsx)$/, '');
        if (!importedBy[key]) importedBy[key] = 0;
        importedBy[key]++;
      }
    }
    const mostImported = Object.entries(importedBy).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([file, count]) => ({ file, imported_by: count }));
    const mostDependencies = Object.entries(importCount).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([file, count]) => ({ file, imports: count }));
    return { most_imported: mostImported, most_dependencies: mostDependencies };
  }

  private _formatTimestamp(): string { return new Date().toISOString().replace('T', ' ').slice(0, 16); }

  private _buildQualitySignals(files: [string, CachedFile][]): Record<string, unknown> {
    const libFiles = files.filter(([p]) => p.startsWith('lib/') && !p.includes('.test.'));
    const testFiles = new Set(files.filter(([p]) => p.includes('.test.') || p.startsWith('tests/')).map(([p]) => p));
    const fileStats = libFiles.map(([fp, data]) => {
      const funcs = data.functions || [];
      const documented = funcs.filter(f => f.docstring).length;
      const total = funcs.length;
      const asyncCount = funcs.filter(f => f.is_async).length;
      const coverage = total > 0 ? documented / total : 1;
      return { file: fp, functions: total, documented, asyncCount, coverage };
    });
    const docGaps = fileStats.filter(f => f.functions >= 3 && f.coverage < 0.25).sort((a, b) => a.coverage - b.coverage || b.functions - a.functions).slice(0, 5).map(f => ({ file: f.file, functions: f.functions, documented: f.documented }));
    const wellDocumented = fileStats.filter(f => f.functions >= 3 && f.coverage === 1).map(f => f.file);
    const untestedModules = libFiles.map(([p]) => p).filter(p => {
      const base = path.basename(p, path.extname(p));
      return !(testFiles.has(`tests/${base}.test.js`) || testFiles.has(`tests/${base}.test.ts`) || testFiles.has(p.replace('.js', '.test.js')) || testFiles.has(p.replace('.ts', '.test.ts')) || Array.from(testFiles).some(t => t.includes(base + '.test')));
    }).slice(0, 10);
    const complexityHotspots = fileStats.filter(f => f.functions >= 5).sort((a, b) => b.functions - a.functions || b.asyncCount - a.asyncCount).slice(0, 5).map(f => ({ file: f.file, functions: f.functions, async: f.asyncCount }));
    return { doc_gaps: docGaps, well_documented: wellDocumented, untested_modules: untestedModules, complexity_hotspots: complexityHotspots };
  }
}

export default AstSummaryService;
