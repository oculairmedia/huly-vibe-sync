import { describe, it, expect, beforeEach } from 'vitest';
import { AstSummaryService } from '../../lib/AstSummaryService.js';

/**
 * Helper to create mock AST cache objects
 */
function createMockCache(files) {
  return {
    cache: { files },
  };
}

describe('AstSummaryService', () => {
  let service;

  beforeEach(() => {
    service = new AstSummaryService();
  });

  describe('generateSummary', () => {
    it('returns null when no cache available', () => {
      const result = service.generateSummary(null, 'project-1');
      expect(result).toBeNull();
    });

    it('returns null when cache has no files', () => {
      const result = service.generateSummary({ cache: {} }, 'project-1');
      expect(result).toBeNull();
    });

    it('returns summary with correct file and function counts', () => {
      const mockFiles = {
        'lib/database.js': {
          functions: [
            {
              name: 'createDB',
              signature: 'function createDB()',
              docstring: 'Create DB',
              is_async: false,
            },
            { name: 'query', signature: 'function query()', docstring: '', is_async: true },
          ],
          imports: [],
          classes: [],
          exports: [],
        },
        'lib/service.js': {
          functions: [
            { name: 'run', signature: 'function run()', docstring: 'Run service', is_async: true },
          ],
          imports: [],
          classes: [],
          exports: [],
        },
        'lib/utils.js': {
          functions: [],
          imports: [],
          classes: [],
          exports: [],
        },
      };

      const cache = createMockCache(mockFiles);
      const result = service.generateSummary(cache, 'project-1');

      expect(result).not.toBeNull();
      expect(result.summary.files).toBe(3);
      expect(result.summary.functions).toBe(3);
    });

    it('includes classes count in summary', () => {
      const mockFiles = {
        'lib/service.js': {
          functions: [],
          imports: [],
          classes: [
            { name: 'Service', methods: [{ name: 'run' }], start_line: 5, end_line: 20 },
            { name: 'Config', methods: [], start_line: 22, end_line: 30 },
          ],
          exports: [],
        },
      };

      const cache = createMockCache(mockFiles);
      const result = service.generateSummary(cache, 'project-1');

      expect(result.summary.classes).toBe(2);
    });

    it('includes last_sync timestamp', () => {
      const mockFiles = {
        'lib/test.js': {
          functions: [],
          imports: [],
          classes: [],
          exports: [],
        },
      };

      const cache = createMockCache(mockFiles);
      const result = service.generateSummary(cache, 'project-1');

      expect(result.last_sync).toBeDefined();
      expect(typeof result.last_sync).toBe('string');
      expect(result.last_sync).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    });

    it('does NOT include recent_changes in output', () => {
      const mockFiles = {
        'lib/test.js': {
          functions: [],
          imports: [],
          classes: [],
          exports: [],
        },
      };

      const cache = createMockCache(mockFiles);
      const result = service.generateSummary(cache, 'project-1');

      expect(result.recent_changes).toBeUndefined();
    });

    it('detects languages from file extensions', () => {
      const mockFiles = {
        'lib/app.js': {
          functions: [],
          imports: [],
          classes: [],
          exports: [],
        },
        'lib/types.ts': {
          functions: [],
          imports: [],
          classes: [],
          exports: [],
        },
        'lib/component.tsx': {
          functions: [],
          imports: [],
          classes: [],
          exports: [],
        },
        'scripts/setup.py': {
          functions: [],
          imports: [],
          classes: [],
          exports: [],
        },
      };

      const cache = createMockCache(mockFiles);
      const result = service.generateSummary(cache, 'project-1');

      expect(result.summary.languages).toContain('JavaScript');
      expect(result.summary.languages).toContain('TypeScript');
      expect(result.summary.languages).toContain('React');
      expect(result.summary.languages).toContain('Python');
    });

    it('filters out vendor/node_modules files', () => {
      const mockFiles = {
        'lib/app.js': {
          functions: [
            { name: 'main', signature: 'function main()', docstring: '', is_async: false },
          ],
          imports: [],
          classes: [],
          exports: [],
        },
        'node_modules/foo.js': {
          functions: [{ name: 'foo', signature: 'function foo()', docstring: '', is_async: false }],
          imports: [],
          classes: [],
          exports: [],
        },
        'vendor/bar.js': {
          functions: [{ name: 'bar', signature: 'function bar()', docstring: '', is_async: false }],
          imports: [],
          classes: [],
          exports: [],
        },
      };

      const cache = createMockCache(mockFiles);
      const result = service.generateSummary(cache, 'project-1');

      expect(result.summary.files).toBe(1);
      expect(result.summary.functions).toBe(1);
    });

    it('includes health information in output', () => {
      const mockFiles = {
        'lib/test.js': {
          functions: [],
          imports: [],
          classes: [],
          exports: [],
        },
      };

      const cache = createMockCache(mockFiles);
      const health = { syncStatus: 'green', errors24h: 2, graphitiConnected: true };
      const result = service.generateSummary(cache, 'project-1', health);

      expect(result.health).toBeDefined();
      expect(result.health.sync_status).toBe('green');
      expect(result.health.errors_24h).toBe(2);
      expect(result.health.graphiti_connected).toBe(true);
    });
  });

  describe('_buildCoupling', () => {
    it('identifies most imported modules', () => {
      const mockFiles = [
        [
          'lib/database.js',
          {
            functions: [],
            imports: [{ source: './config.js', specifiers: ['getConfig'], default: null, line: 1 }],
            classes: [],
            exports: [],
          },
        ],
        [
          'lib/service.js',
          {
            functions: [],
            imports: [
              { source: './database.js', specifiers: ['createDB'], default: null, line: 1 },
              { source: './config.js', specifiers: ['getConfig'], default: null, line: 2 },
            ],
            classes: [],
            exports: [],
          },
        ],
        [
          'lib/utils.js',
          {
            functions: [],
            imports: [{ source: './config.js', specifiers: ['getConfig'], default: null, line: 1 }],
            classes: [],
            exports: [],
          },
        ],
      ];

      const result = service._buildCoupling(mockFiles);

      expect(result.most_imported).toBeDefined();
      expect(result.most_imported.length).toBeGreaterThan(0);
      const configImport = result.most_imported.find(m => m.file === 'config');
      expect(configImport).toBeDefined();
      expect(configImport.imported_by).toBe(3);
    });

    it('identifies files with most dependencies', () => {
      const mockFiles = [
        [
          'lib/service.js',
          {
            functions: [],
            imports: [
              { source: './database.js', specifiers: ['createDB'], default: null, line: 1 },
              { source: './config.js', specifiers: ['getConfig'], default: null, line: 2 },
              { source: './logger.js', specifiers: ['log'], default: null, line: 3 },
              { source: './utils.js', specifiers: ['format'], default: null, line: 4 },
              { source: './cache.js', specifiers: ['Cache'], default: null, line: 5 },
            ],
            classes: [],
            exports: [],
          },
        ],
        [
          'lib/utils.js',
          {
            functions: [],
            imports: [{ source: './logger.js', specifiers: ['log'], default: null, line: 1 }],
            classes: [],
            exports: [],
          },
        ],
      ];

      const result = service._buildCoupling(mockFiles);

      expect(result.most_dependencies).toBeDefined();
      const serviceFile = result.most_dependencies.find(m => m.file === 'lib/service.js');
      expect(serviceFile).toBeDefined();
      expect(serviceFile.imports).toBe(5);
    });

    it('handles files with no imports', () => {
      const mockFiles = [
        [
          'lib/constants.js',
          {
            functions: [],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
        [
          'lib/types.js',
          {
            functions: [],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
      ];

      const result = service._buildCoupling(mockFiles);

      expect(result.most_imported).toBeDefined();
      expect(result.most_dependencies).toBeDefined();
      expect(result.most_dependencies.length).toBe(0);
    });

    it('normalizes relative import paths', () => {
      const mockFiles = [
        [
          'lib/service.js',
          {
            functions: [],
            imports: [
              { source: './database.js', specifiers: ['createDB'], default: null, line: 1 },
              { source: './database', specifiers: ['query'], default: null, line: 2 },
              { source: './database.ts', specifiers: ['init'], default: null, line: 3 },
            ],
            classes: [],
            exports: [],
          },
        ],
      ];

      const result = service._buildCoupling(mockFiles);

      const databaseImport = result.most_imported.find(m => m.file === 'database');
      expect(databaseImport).toBeDefined();
      expect(databaseImport.imported_by).toBe(3);
    });

    it('limits most_imported to top 10', () => {
      const mockFiles = [];
      for (let i = 0; i < 15; i++) {
        mockFiles.push([
          `lib/file${i}.js`,
          {
            functions: [],
            imports: [{ source: './common.js', specifiers: ['util'], default: null, line: 1 }],
            classes: [],
            exports: [],
          },
        ]);
      }

      const result = service._buildCoupling(mockFiles);

      expect(result.most_imported.length).toBeLessThanOrEqual(10);
    });

    it('limits most_dependencies to top 10', () => {
      const mockFiles = [];
      for (let i = 0; i < 15; i++) {
        const imports = [];
        for (let j = 0; j < i + 1; j++) {
          imports.push({
            source: `./dep${j}.js`,
            specifiers: ['func'],
            default: null,
            line: j + 1,
          });
        }
        mockFiles.push([
          `lib/file${i}.js`,
          {
            functions: [],
            imports,
            classes: [],
            exports: [],
          },
        ]);
      }

      const result = service._buildCoupling(mockFiles);

      expect(result.most_dependencies.length).toBeLessThanOrEqual(10);
    });
  });

  describe('_buildStructure', () => {
    it('groups files by top-level directory', () => {
      const mockFiles = [
        [
          'lib/database.js',
          {
            functions: [
              {
                name: 'createDB',
                signature: 'function createDB()',
                docstring: '',
                is_async: false,
              },
            ],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
        [
          'lib/service.js',
          {
            functions: [
              { name: 'run', signature: 'function run()', docstring: '', is_async: false },
            ],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
        [
          'tests/unit/service.test.js',
          {
            functions: [],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
      ];

      const result = service._buildStructure(mockFiles);

      expect(result['lib/']).toBeDefined();
      expect(result['tests/']).toBeDefined();
      expect(result['lib/'].files).toBe(2);
      expect(result['tests/'].files).toBe(1);
    });

    it('includes classes count per directory', () => {
      const mockFiles = [
        [
          'lib/service.js',
          {
            functions: [],
            imports: [],
            classes: [
              { name: 'Service', methods: [], start_line: 1, end_line: 10 },
              { name: 'Config', methods: [], start_line: 12, end_line: 20 },
            ],
            exports: [],
          },
        ],
      ];

      const result = service._buildStructure(mockFiles);

      expect(result['lib/'].classes).toBe(2);
    });

    it('identifies key modules (5+ functions)', () => {
      const mockFiles = [
        [
          'lib/service.js',
          {
            functions: [
              { name: 'func1', signature: 'function func1()', docstring: '', is_async: false },
              { name: 'func2', signature: 'function func2()', docstring: '', is_async: false },
              { name: 'func3', signature: 'function func3()', docstring: '', is_async: false },
              { name: 'func4', signature: 'function func4()', docstring: '', is_async: false },
              { name: 'func5', signature: 'function func5()', docstring: '', is_async: false },
              { name: 'func6', signature: 'function func6()', docstring: '', is_async: false },
            ],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
        [
          'lib/utils.js',
          {
            functions: [
              { name: 'util1', signature: 'function util1()', docstring: '', is_async: false },
              { name: 'util2', signature: 'function util2()', docstring: '', is_async: false },
            ],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
      ];

      const result = service._buildStructure(mockFiles);

      expect(result['lib/'].key_modules).toBeDefined();
      expect(result['lib/'].key_modules).toContain('service');
      expect(result['lib/'].key_modules).not.toContain('utils');
    });

    it('limits structure to top 10 directories', () => {
      const mockFiles = [];
      for (let i = 0; i < 15; i++) {
        mockFiles.push([
          `dir${i}/file.js`,
          {
            functions: [
              { name: 'func', signature: 'function func()', docstring: '', is_async: false },
            ],
            imports: [],
            classes: [],
            exports: [],
          },
        ]);
      }

      const result = service._buildStructure(mockFiles);

      expect(Object.keys(result).length).toBeLessThanOrEqual(10);
    });
  });

  describe('quality signals', () => {
    it('identifies doc gaps (files <25% documented)', () => {
      const mockFiles = [
        [
          'lib/service.js',
          {
            functions: [
              { name: 'func1', signature: 'function func1()', docstring: '', is_async: false },
              { name: 'func2', signature: 'function func2()', docstring: '', is_async: false },
              { name: 'func3', signature: 'function func3()', docstring: '', is_async: false },
              { name: 'func4', signature: 'function func4()', docstring: '', is_async: false },
            ],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
      ];

      const result = service._buildQualitySignals(mockFiles);

      expect(result.doc_gaps).toBeDefined();
      expect(result.doc_gaps.length).toBeGreaterThan(0);
      const gap = result.doc_gaps.find(g => g.file === 'lib/service.js');
      expect(gap).toBeDefined();
      expect(gap.documented).toBe(0);
    });

    it('identifies well-documented files', () => {
      const mockFiles = [
        [
          'lib/service.js',
          {
            functions: [
              {
                name: 'func1',
                signature: 'function func1()',
                docstring: 'Does something',
                is_async: false,
              },
              {
                name: 'func2',
                signature: 'function func2()',
                docstring: 'Does another thing',
                is_async: false,
              },
              {
                name: 'func3',
                signature: 'function func3()',
                docstring: 'Does more',
                is_async: false,
              },
            ],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
      ];

      const result = service._buildQualitySignals(mockFiles);

      expect(result.well_documented).toBeDefined();
      expect(result.well_documented).toContain('lib/service.js');
    });

    it('identifies untested modules', () => {
      const mockFiles = [
        [
          'lib/service.js',
          {
            functions: [
              { name: 'run', signature: 'function run()', docstring: '', is_async: false },
            ],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
        [
          'lib/utils.js',
          {
            functions: [
              { name: 'format', signature: 'function format()', docstring: '', is_async: false },
            ],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
        [
          'tests/utils.test.js',
          {
            functions: [],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
      ];

      const result = service._buildQualitySignals(mockFiles);

      expect(result.untested_modules).toBeDefined();
      expect(result.untested_modules).toContain('lib/service.js');
      expect(result.untested_modules).not.toContain('lib/utils.js');
    });

    it('identifies complexity hotspots (5+ functions)', () => {
      const mockFiles = [
        [
          'lib/complex.js',
          {
            functions: [
              { name: 'func1', signature: 'function func1()', docstring: '', is_async: false },
              { name: 'func2', signature: 'function func2()', docstring: '', is_async: true },
              { name: 'func3', signature: 'function func3()', docstring: '', is_async: false },
              { name: 'func4', signature: 'function func4()', docstring: '', is_async: true },
              { name: 'func5', signature: 'function func5()', docstring: '', is_async: true },
            ],
            imports: [],
            classes: [],
            exports: [],
          },
        ],
      ];

      const result = service._buildQualitySignals(mockFiles);

      expect(result.complexity_hotspots).toBeDefined();
      const hotspot = result.complexity_hotspots.find(h => h.file === 'lib/complex.js');
      expect(hotspot).toBeDefined();
      expect(hotspot.functions).toBe(5);
      expect(hotspot.async).toBe(3);
    });
  });

  describe('shouldPush', () => {
    it('returns true after max interval (60 minutes)', () => {
      service.markPushed('project-1');
      const oldTime = Date.now() - 61 * 60 * 1000;
      service.lastPushTime.set('project-1', oldTime);

      const result = service.shouldPush('project-1');

      expect(result).toBe(true);
    });

    it('returns false within min interval (15 minutes)', () => {
      service.markPushed('project-1');

      const result = service.shouldPush('project-1');

      expect(result).toBe(false);
    });

    it('returns true for high file change count within interval', () => {
      service.markPushed('project-1');
      const midTime = Date.now() - 30 * 60 * 1000;
      service.lastPushTime.set('project-1', midTime);

      const result = service.shouldPush('project-1', { filesChanged: 5 });

      expect(result).toBe(true);
    });

    it('returns true for high function change count within interval', () => {
      service.markPushed('project-1');
      const midTime = Date.now() - 30 * 60 * 1000;
      service.lastPushTime.set('project-1', midTime);

      const result = service.shouldPush('project-1', { functionsChanged: 10 });

      expect(result).toBe(true);
    });

    it('returns true when hasError flag is set within interval', () => {
      service.markPushed('project-1');
      const midTime = Date.now() - 30 * 60 * 1000;
      service.lastPushTime.set('project-1', midTime);

      const result = service.shouldPush('project-1', { hasError: true });

      expect(result).toBe(true);
    });

    it('returns false for low changes within interval', () => {
      service.markPushed('project-1');
      const midTime = Date.now() - 30 * 60 * 1000;
      service.lastPushTime.set('project-1', midTime);

      const result = service.shouldPush('project-1', { filesChanged: 1, functionsChanged: 2 });

      expect(result).toBe(false);
    });
  });

  describe('recordChange', () => {
    it('records changes for a project', () => {
      service.recordChange('project-1', 'lib/service.js', 'modified', 2);

      expect(service.recentChanges.has('project-1')).toBe(true);
      const changes = service.recentChanges.get('project-1');
      expect(changes.length).toBe(1);
      expect(changes[0].file).toBe('lib/service.js');
      expect(changes[0].change).toBe('modified');
      expect(changes[0].delta).toBe('+2');
    });

    it('records negative delta correctly', () => {
      service.recordChange('project-1', 'lib/service.js', 'modified', -3);

      const changes = service.recentChanges.get('project-1');
      expect(changes[0].delta).toBe('-3');
    });

    it('prepends new changes to the front', () => {
      service.recordChange('project-1', 'lib/file1.js', 'added', 1);
      service.recordChange('project-1', 'lib/file2.js', 'modified', 2);

      const changes = service.recentChanges.get('project-1');
      expect(changes[0].file).toBe('lib/file2.js');
      expect(changes[1].file).toBe('lib/file1.js');
    });

    it('caps changes at 50', () => {
      for (let i = 0; i < 60; i++) {
        service.recordChange('project-1', `lib/file${i}.js`, 'modified', 1);
      }

      const changes = service.recentChanges.get('project-1');
      expect(changes.length).toBe(50);
    });

    it('includes timestamp in recorded change', () => {
      const beforeTime = Date.now();
      service.recordChange('project-1', 'lib/service.js', 'added', 1);
      const afterTime = Date.now();

      const changes = service.recentChanges.get('project-1');
      expect(changes[0].time).toBeGreaterThanOrEqual(beforeTime);
      expect(changes[0].time).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('markPushed', () => {
    it('records push time for a project', () => {
      const beforeTime = Date.now();
      service.markPushed('project-1');
      const afterTime = Date.now();

      const pushTime = service.lastPushTime.get('project-1');
      expect(pushTime).toBeGreaterThanOrEqual(beforeTime);
      expect(pushTime).toBeLessThanOrEqual(afterTime);
    });

    it('updates push time on subsequent calls', async () => {
      service.markPushed('project-1');
      const firstTime = service.lastPushTime.get('project-1');

      await new Promise(resolve => setTimeout(resolve, 10));
      service.markPushed('project-1');
      const secondTime = service.lastPushTime.get('project-1');

      expect(secondTime).toBeGreaterThan(firstTime);
    });
  });

  describe('_isRelevantFile', () => {
    it('filters out node_modules', () => {
      expect(service._isRelevantFile('node_modules/foo.js')).toBe(false);
    });

    it('filters out .opencode', () => {
      expect(service._isRelevantFile('.opencode/cache.json')).toBe(false);
    });

    it('filters out vibe-kanban-source', () => {
      expect(service._isRelevantFile('vibe-kanban-source/app.js')).toBe(false);
    });

    it('filters out vendor', () => {
      expect(service._isRelevantFile('vendor/lib.js')).toBe(false);
    });

    it('filters out dist', () => {
      expect(service._isRelevantFile('src/dist/bundle.js')).toBe(false);
    });

    it('filters out build', () => {
      expect(service._isRelevantFile('src/build/output.js')).toBe(false);
    });

    it('filters out dotfiles', () => {
      expect(service._isRelevantFile('.env')).toBe(false);
      expect(service._isRelevantFile('.gitignore')).toBe(false);
    });

    it('accepts relevant files', () => {
      expect(service._isRelevantFile('lib/service.js')).toBe(true);
      expect(service._isRelevantFile('src/app.ts')).toBe(true);
      expect(service._isRelevantFile('tests/unit.test.js')).toBe(true);
    });
  });

  describe('_detectLanguages', () => {
    it('detects JavaScript files', () => {
      const files = [
        ['app.js', { functions: [], imports: [], classes: [], exports: [] }],
        ['module.mjs', { functions: [], imports: [], classes: [], exports: [] }],
        ['compat.cjs', { functions: [], imports: [], classes: [], exports: [] }],
      ];

      const result = service._detectLanguages(files);

      expect(result).toContain('JavaScript');
    });

    it('detects TypeScript files', () => {
      const files = [
        ['types.ts', { functions: [], imports: [], classes: [], exports: [] }],
        ['module.mts', { functions: [], imports: [], classes: [], exports: [] }],
        ['compat.cts', { functions: [], imports: [], classes: [], exports: [] }],
      ];

      const result = service._detectLanguages(files);

      expect(result).toContain('TypeScript');
    });

    it('detects React files', () => {
      const files = [
        ['component.tsx', { functions: [], imports: [], classes: [], exports: [] }],
        ['button.jsx', { functions: [], imports: [], classes: [], exports: [] }],
      ];

      const result = service._detectLanguages(files);

      expect(result).toContain('React');
    });

    it('detects Python files', () => {
      const files = [
        ['script.py', { functions: [], imports: [], classes: [], exports: [] }],
        ['app.pyw', { functions: [], imports: [], classes: [], exports: [] }],
      ];

      const result = service._detectLanguages(files);

      expect(result).toContain('Python');
    });

    it('handles mixed file types', () => {
      const files = [
        ['app.js', { functions: [], imports: [], classes: [], exports: [] }],
        ['types.ts', { functions: [], imports: [], classes: [], exports: [] }],
        ['script.py', { functions: [], imports: [], classes: [], exports: [] }],
      ];

      const result = service._detectLanguages(files);

      expect(result).toContain('JavaScript');
      expect(result).toContain('TypeScript');
      expect(result).toContain('Python');
    });

    it('ignores unknown extensions', () => {
      const files = [
        ['readme.md', { functions: [], imports: [], classes: [], exports: [] }],
        ['config.json', { functions: [], imports: [], classes: [], exports: [] }],
      ];

      const result = service._detectLanguages(files);

      expect(result.length).toBe(0);
    });
  });

  describe('_formatTimestamp', () => {
    it('returns ISO format timestamp without seconds', () => {
      const result = service._formatTimestamp();

      expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
      expect(result.length).toBe(16);
    });

    it('uses current time', () => {
      const before = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const result = service._formatTimestamp();
      const after = new Date().toISOString().replace('T', ' ').slice(0, 16);

      expect(result).toMatch(new RegExp(`${before}|${after}`));
    });
  });
});
