/**
 * AstSummaryService - Generates codebase summaries for PM agent memory blocks
 *
 * Reads from ASTCache and produces structured summaries suitable for
 * injection into Letta memory blocks.
 */

import path from 'path';
import { logger } from './logger.js';

const MIN_PUSH_INTERVAL = 15 * 60 * 1000;
const MAX_PUSH_INTERVAL = 60 * 60 * 1000;
const FILES_THRESHOLD = 5;
const FUNCTIONS_THRESHOLD = 10;
const MAX_RECENT_CHANGES = 50;

export class AstSummaryService {
  constructor() {
    this.log = logger.child({ service: 'AstSummaryService' });
    this.recentChanges = new Map();
    this.lastPushTime = new Map();
  }

  /**
   * @param {Object} astCache - ASTCache instance with .cache property
   * @param {string} projectId
   * @param {Object} [health] - { syncStatus, errors24h, graphitiConnected }
   */
  generateSummary(astCache, projectId, health = {}) {
    if (!astCache?.cache?.files) {
      this.log.debug({ project: projectId }, 'No AST cache available');
      return null;
    }

    const files = Object.entries(astCache.cache.files);
    const relevant = files.filter(([p]) => this._isRelevantFile(p));

    const totalFiles = relevant.length;
    const totalFunctions = relevant.reduce((sum, [, d]) => sum + (d.functions?.length || 0), 0);
    const languages = this._detectLanguages(relevant);
    const structure = this._buildStructure(relevant);
    const recentChanges = this._formatRecentChanges(projectId);
    const qualitySignals = this._buildQualitySignals(relevant);

    return {
      updated: this._formatTimestamp(),
      summary: { files: totalFiles, functions: totalFunctions, languages },
      health: {
        last_sync: this._formatTimestamp(),
        sync_status: health.syncStatus || 'green',
        errors_24h: health.errors24h ?? 0,
        graphiti_connected: health.graphitiConnected ?? false,
      },
      structure,
      quality_signals: qualitySignals,
      recent_changes: recentChanges,
    };
  }

  recordChange(projectId, filePath, changeType, functionsDelta = 0) {
    if (!this.recentChanges.has(projectId)) {
      this.recentChanges.set(projectId, []);
    }
    const changes = this.recentChanges.get(projectId);
    changes.unshift({
      file: filePath,
      change: changeType,
      time: Date.now(),
      delta: functionsDelta > 0 ? `+${functionsDelta}` : `${functionsDelta}`,
    });
    if (changes.length > MAX_RECENT_CHANGES) changes.length = MAX_RECENT_CHANGES;
  }

  shouldPush(projectId, { filesChanged = 0, functionsChanged = 0, hasError = false } = {}) {
    const lastPush = this.lastPushTime.get(projectId) || 0;
    const elapsed = Date.now() - lastPush;

    if (elapsed >= MAX_PUSH_INTERVAL) return true;
    if (elapsed < MIN_PUSH_INTERVAL) return false;
    return filesChanged >= FILES_THRESHOLD || functionsChanged >= FUNCTIONS_THRESHOLD || hasError;
  }

  markPushed(projectId) {
    this.lastPushTime.set(projectId, Date.now());
  }

  _isRelevantFile(filePath) {
    return (
      !filePath.includes('node_modules/') &&
      !filePath.includes('.opencode/') &&
      !filePath.includes('vibe-kanban-source/') &&
      !filePath.includes('vendor/') &&
      !filePath.includes('/dist/') &&
      !filePath.includes('/build/') &&
      !filePath.startsWith('.')
    );
  }

  _detectLanguages(files) {
    const langs = new Set();
    const extMap = {
      '.js': 'JavaScript',
      '.mjs': 'JavaScript',
      '.cjs': 'JavaScript',
      '.ts': 'TypeScript',
      '.mts': 'TypeScript',
      '.cts': 'TypeScript',
      '.tsx': 'React',
      '.jsx': 'React',
      '.py': 'Python',
      '.pyw': 'Python',
    };
    for (const [filePath] of files) {
      const ext = path.extname(filePath).toLowerCase();
      if (extMap[ext]) langs.add(extMap[ext]);
    }
    return Array.from(langs);
  }

  _buildStructure(files) {
    const stats = {};
    for (const [filePath, data] of files) {
      const parts = filePath.split('/');
      const dir = parts.length > 1 ? parts[0] + '/' : '(root)';
      if (!stats[dir]) stats[dir] = { files: 0, functions: 0, modules: new Set() };
      stats[dir].files++;
      stats[dir].functions += data.functions?.length || 0;
      if (data.functions?.length >= 5) {
        stats[dir].modules.add(path.basename(filePath, path.extname(filePath)));
      }
    }

    const sorted = Object.entries(stats)
      .sort((a, b) => b[1].functions - a[1].functions)
      .slice(0, 10);
    const structure = {};
    for (const [dir, s] of sorted) {
      structure[dir] = { files: s.files, functions: s.functions };
      if (s.modules.size > 0) structure[dir].key_modules = Array.from(s.modules).slice(0, 5);
    }
    return structure;
  }

  _formatRecentChanges(projectId) {
    const changes = this.recentChanges.get(projectId) || [];
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    return changes
      .filter(c => now - c.time < dayMs)
      .slice(0, 10)
      .map(c => ({
        file: c.file,
        change: c.change,
        functions_delta: c.delta,
        when: this._relativeTime(now - c.time),
      }));
  }

  _relativeTime(ms) {
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  _formatTimestamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 16);
  }

  _buildQualitySignals(files) {
    const libFiles = files.filter(([p]) => p.startsWith('lib/') && !p.includes('.test.'));
    const testFiles = new Set(
      files.filter(([p]) => p.includes('.test.') || p.startsWith('tests/')).map(([p]) => p)
    );

    const fileStats = libFiles.map(([filePath, data]) => {
      const funcs = data.functions || [];
      const documented = funcs.filter(f => f.docstring).length;
      const total = funcs.length;
      const asyncCount = funcs.filter(f => f.is_async).length;
      const coverage = total > 0 ? documented / total : 1;
      return { file: filePath, functions: total, documented, asyncCount, coverage };
    });

    const docGaps = fileStats
      .filter(f => f.functions >= 3 && f.coverage < 0.25)
      .sort((a, b) => a.coverage - b.coverage || b.functions - a.functions)
      .slice(0, 5)
      .map(f => ({ file: f.file, functions: f.functions, documented: f.documented }));

    const wellDocumented = fileStats
      .filter(f => f.functions >= 3 && f.coverage === 1)
      .map(f => f.file);

    const untestedModules = libFiles
      .map(([p]) => p)
      .filter(p => {
        const base = path.basename(p, path.extname(p));
        const hasTest =
          testFiles.has(`tests/${base}.test.js`) ||
          testFiles.has(`tests/${base}.test.ts`) ||
          testFiles.has(p.replace('.js', '.test.js')) ||
          testFiles.has(p.replace('.ts', '.test.ts')) ||
          Array.from(testFiles).some(t => t.includes(base + '.test'));
        return !hasTest;
      })
      .slice(0, 10);

    const complexityHotspots = fileStats
      .filter(f => f.functions >= 5)
      .sort((a, b) => b.functions - a.functions || b.asyncCount - a.asyncCount)
      .slice(0, 5)
      .map(f => ({ file: f.file, functions: f.functions, async: f.asyncCount }));

    return {
      doc_gaps: docGaps,
      well_documented: wellDocumented,
      untested_modules: untestedModules,
      complexity_hotspots: complexityHotspots,
    };
  }
}

export default AstSummaryService;
