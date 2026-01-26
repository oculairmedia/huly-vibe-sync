import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ASTCache } from '../../lib/ASTCache.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('ASTCache', () => {
  let tempDir;
  let cache;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ast-cache-test-'));
    cache = new ASTCache({
      projectId: 'test-project',
      projectPath: tempDir,
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('computeHash', () => {
    it('returns consistent MD5 hash for same content', () => {
      const content = 'function test() {}';
      const hash1 = ASTCache.computeHash(content);
      const hash2 = ASTCache.computeHash(content);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(32);
    });

    it('returns different hash for different content', () => {
      const hash1 = ASTCache.computeHash('function a() {}');
      const hash2 = ASTCache.computeHash('function b() {}');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('load/save', () => {
    it('creates empty cache on first load', async () => {
      await cache.load();

      const stats = cache.getStats();
      expect(stats.files).toBe(0);
      expect(stats.functions).toBe(0);
    });

    it('saves and loads cache correctly', async () => {
      await cache.load();

      cache.set('test.py', 'abc123', Date.now(), [
        { name: 'func1', signature: 'def func1()', start_line: 1, end_line: 3 },
        { name: 'func2', signature: 'def func2()', start_line: 5, end_line: 7 },
      ]);

      await cache.save();

      const newCache = new ASTCache({
        projectId: 'test-project',
        projectPath: tempDir,
      });
      await newCache.load();

      const stats = newCache.getStats();
      expect(stats.files).toBe(1);
      expect(stats.functions).toBe(2);
    });

    it('handles corrupted cache file gracefully', async () => {
      const cacheDir = path.join(tempDir, '.vibesync-cache');
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(path.join(cacheDir, 'ast-cache.json'), 'invalid json{{{');

      await cache.load();

      const stats = cache.getStats();
      expect(stats.files).toBe(0);
    });
  });

  describe('get/set', () => {
    beforeEach(async () => {
      await cache.load();
    });

    it('returns null for uncached file', () => {
      const result = cache.get('nonexistent.py');
      expect(result).toBeNull();
    });

    it('stores and retrieves cached data', () => {
      const functions = [{ name: 'test', signature: 'def test()' }];
      cache.set('test.py', 'hash123', Date.now(), functions);

      const cached = cache.get('test.py');
      expect(cached).not.toBeNull();
      expect(cached.contentHash).toBe('hash123');
      expect(cached.functions).toHaveLength(1);
      expect(cached.functions[0].name).toBe('test');
    });
  });

  describe('remove', () => {
    beforeEach(async () => {
      await cache.load();
    });

    it('removes cached file', () => {
      cache.set('test.py', 'hash123', Date.now(), []);

      const removed = cache.remove('test.py');
      expect(removed).toBe(true);

      const cached = cache.get('test.py');
      expect(cached).toBeNull();
    });

    it('returns false for non-existent file', () => {
      const removed = cache.remove('nonexistent.py');
      expect(removed).toBe(false);
    });
  });

  describe('needsReparse', () => {
    beforeEach(async () => {
      await cache.load();
    });

    it('returns true for uncached file', () => {
      expect(cache.needsReparse('new.py', 'somehash')).toBe(true);
    });

    it('returns false when hash matches', () => {
      cache.set('test.py', 'hash123', Date.now(), []);
      expect(cache.needsReparse('test.py', 'hash123')).toBe(false);
    });

    it('returns true when hash differs', () => {
      cache.set('test.py', 'hash123', Date.now(), []);
      expect(cache.needsReparse('test.py', 'differenthash')).toBe(true);
    });
  });

  describe('diff', () => {
    beforeEach(async () => {
      await cache.load();
    });

    it('detects added functions', () => {
      cache.set('test.py', 'hash1', Date.now(), [
        { name: 'existing', signature: 'def existing()' },
      ]);

      const current = [
        { name: 'existing', signature: 'def existing()' },
        { name: 'newFunc', signature: 'def newFunc()' },
      ];

      const diff = cache.diff('test.py', current);

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].name).toBe('newFunc');
      expect(diff.unchanged).toHaveLength(1);
      expect(diff.removed).toHaveLength(0);
    });

    it('detects removed functions', () => {
      cache.set('test.py', 'hash1', Date.now(), [
        { name: 'func1', signature: 'def func1()' },
        { name: 'func2', signature: 'def func2()' },
      ]);

      const current = [{ name: 'func1', signature: 'def func1()' }];

      const diff = cache.diff('test.py', current);

      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].name).toBe('func2');
      expect(diff.unchanged).toHaveLength(1);
    });

    it('detects modified functions by signature change', () => {
      cache.set('test.py', 'hash1', Date.now(), [
        { name: 'func', signature: 'def func(a)', start_line: 1, end_line: 3 },
      ]);

      const current = [{ name: 'func', signature: 'def func(a, b)', start_line: 1, end_line: 3 }];

      const diff = cache.diff('test.py', current);

      expect(diff.modified).toHaveLength(1);
      expect(diff.modified[0].previous.signature).toBe('def func(a)');
      expect(diff.modified[0].current.signature).toBe('def func(a, b)');
    });

    it('detects modified functions by line change', () => {
      cache.set('test.py', 'hash1', Date.now(), [
        { name: 'func', signature: 'def func()', start_line: 1, end_line: 3 },
      ]);

      const current = [{ name: 'func', signature: 'def func()', start_line: 5, end_line: 7 }];

      const diff = cache.diff('test.py', current);

      expect(diff.modified).toHaveLength(1);
    });

    it('handles uncached file as all added', () => {
      const current = [
        { name: 'func1', signature: 'def func1()' },
        { name: 'func2', signature: 'def func2()' },
      ];

      const diff = cache.diff('uncached.py', current);

      expect(diff.added).toHaveLength(2);
      expect(diff.modified).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
    });
  });

  describe('getCachedFiles', () => {
    beforeEach(async () => {
      await cache.load();
    });

    it('returns empty array for empty cache', () => {
      expect(cache.getCachedFiles()).toHaveLength(0);
    });

    it('returns all cached file paths', () => {
      cache.set('file1.py', 'h1', Date.now(), []);
      cache.set('file2.js', 'h2', Date.now(), []);
      cache.set('dir/file3.ts', 'h3', Date.now(), []);

      const files = cache.getCachedFiles();

      expect(files).toHaveLength(3);
      expect(files).toContain('file1.py');
      expect(files).toContain('file2.js');
      expect(files).toContain('dir/file3.ts');
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await cache.load();
    });

    it('returns correct statistics', () => {
      cache.set('file1.py', 'h1', Date.now(), [{ name: 'f1' }, { name: 'f2' }]);
      cache.set('file2.py', 'h2', Date.now(), [{ name: 'f3' }]);

      const stats = cache.getStats();

      expect(stats.files).toBe(2);
      expect(stats.functions).toBe(3);
    });
  });
});
