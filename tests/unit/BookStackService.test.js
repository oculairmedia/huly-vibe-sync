import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

vi.mock('fs');
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));
vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../../lib/HealthService.js', () => ({
  recordApiLatency: vi.fn(),
}));

const { BookStackExporter } = await import('../../lib/BookStackExporter.js');
const { BookStackService } = await import('../../lib/BookStackService.js');

function createTestConfig(overrides = {}) {
  return {
    enabled: true,
    url: 'https://docs.test.com',
    tokenId: 'test-token-id',
    tokenSecret: 'test-token-secret',
    syncInterval: 3600000,
    exportFormats: ['markdown'],
    exportImages: true,
    exportAttachments: true,
    exportMeta: true,
    modifyMarkdownLinks: true,
    docsSubdir: 'docs/bookstack',
    projectBookMappings: [{ projectIdentifier: 'HVSYN', bookSlug: 'huly-vibe-sync-docs' }],
    exporterOutputPath: '/bookstack-exports',
    ...overrides,
  };
}

function createMockDb() {
  return {
    getBookStackLastExport: vi.fn().mockReturnValue(null),
    setBookStackLastExport: vi.fn(),
    upsertBookStackPage: vi.fn(),
    getBookStackPages: vi.fn().mockReturnValue([]),
    getBookStackPageByPath: vi.fn().mockReturnValue(null),
  };
}

describe('BookStackExporter', () => {
  let exporter;
  let config;

  beforeEach(() => {
    vi.clearAllMocks();
    config = createTestConfig();
    exporter = new BookStackExporter(config);
  });

  describe('getLatestArchive', () => {
    it('returns null when export dir does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      expect(exporter.getLatestArchive()).toBeNull();
    });

    it('returns null when no archives exist', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([]);
      expect(exporter.getLatestArchive()).toBeNull();
    });

    it('returns latest archive sorted by name', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        'bookstack_export_2026-01-27_09-00-00.tgz',
        'bookstack_export_2026-01-28_09-00-00.tgz',
        'bookstack_export_2026-01-26_09-00-00.tgz',
      ]);

      const result = exporter.getLatestArchive();
      expect(result).toBe(
        path.join('/bookstack-exports', 'bookstack_export_2026-01-28_09-00-00.tgz')
      );
    });

    it('ignores non-archive files', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        'readme.md',
        'bookstack_export_2026-01-28_09-00-00.tgz',
        'config.yml',
      ]);

      const result = exporter.getLatestArchive();
      expect(result).toContain('bookstack_export_2026-01-28');
    });
  });

  describe('findBookDir', () => {
    it('finds book directory by slug at top level', () => {
      fs.readdirSync.mockReturnValue([
        { name: 'huly-vibe-sync-docs', isDirectory: () => true },
        { name: 'other-book', isDirectory: () => true },
      ]);

      const result = exporter.findBookDir('/tmp/extract', 'huly-vibe-sync-docs');
      expect(result).toBe(path.join('/tmp/extract', 'huly-vibe-sync-docs'));
    });

    it('returns null when book not found', () => {
      fs.readdirSync.mockReturnValue([{ name: 'other-book', isDirectory: () => true }]);

      const result = exporter.findBookDir('/tmp/extract', 'nonexistent-book');
      expect(result).toBeNull();
    });
  });

  describe('getStats', () => {
    it('returns initial stats', () => {
      const stats = exporter.getStats();
      expect(stats.totalExports).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.lastExportAt).toBeNull();
    });
  });
});

describe('BookStackService', () => {
  let service;
  let config;
  let db;

  beforeEach(() => {
    vi.clearAllMocks();
    config = createTestConfig();
    db = createMockDb();
    service = new BookStackService(config, db);
  });

  describe('initialize', () => {
    it('initializes and reports archive status', async () => {
      fs.existsSync.mockReturnValue(false);
      const result = await service.initialize();
      expect(result.archiveExists).toBe(false);
      expect(service.initialized).toBe(true);
    });
  });

  describe('getBookSlugForProject', () => {
    it('returns slug for mapped project', () => {
      expect(service.getBookSlugForProject('HVSYN')).toBe('huly-vibe-sync-docs');
    });

    it('returns null for unmapped project', () => {
      expect(service.getBookSlugForProject('UNKNOWN')).toBeNull();
    });
  });

  describe('syncExport', () => {
    it('skips when no mapping exists', async () => {
      const result = await service.syncExport('UNKNOWN', '/opt/stacks/unknown');
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('no_mapping');
    });

    it('skips when export is not due', async () => {
      db.getBookStackLastExport.mockReturnValue(Date.now() - 1000);

      const result = await service.syncExport('HVSYN', '/opt/stacks/huly-vibe-sync');
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('not_due');
    });

    it('attempts export when due', async () => {
      db.getBookStackLastExport.mockReturnValue(null);
      fs.existsSync.mockReturnValue(false);

      const result = await service.syncExport('HVSYN', '/opt/stacks/huly-vibe-sync');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('no_archive');
    });
  });

  describe('getHealthInfo', () => {
    it('returns health information', () => {
      const health = service.getHealthInfo();
      expect(health.enabled).toBe(true);
      expect(health.url).toBe('https://docs.test.com');
      expect(health.mappings).toBe(1);
      expect(health.syncInterval).toBe('3600s');
    });
  });

  describe('getStats', () => {
    it('returns combined stats', () => {
      const stats = service.getStats();
      expect(stats.exportsCompleted).toBe(0);
      expect(stats.exportsFailed).toBe(0);
      expect(stats.exporter).toBeDefined();
    });
  });
});
