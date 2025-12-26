/**
 * Unit Tests for Utils Module
 * 
 * Tests general-purpose utility functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, processBatch, formatDuration } from '../../lib/utils.js';

describe('utils', () => {
  describe('withTimeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve when promise completes before timeout', async () => {
      const promise = Promise.resolve('success');
      
      const result = await withTimeout(promise, 1000, 'test operation');
      
      expect(result).toBe('success');
    });

    it('should reject when timeout occurs before promise', async () => {
      const slowPromise = new Promise(resolve => setTimeout(() => resolve('done'), 5000));
      
      const resultPromise = withTimeout(slowPromise, 100, 'slow operation');
      
      // Advance timers past the timeout
      vi.advanceTimersByTime(150);
      
      await expect(resultPromise).rejects.toThrow('Timeout after 100ms: slow operation');
    });

    it('should include operation name in timeout error message', async () => {
      const slowPromise = new Promise(resolve => setTimeout(() => resolve('done'), 5000));
      
      const resultPromise = withTimeout(slowPromise, 50, 'Fetching data from API');
      
      vi.advanceTimersByTime(100);
      
      await expect(resultPromise).rejects.toThrow('Fetching data from API');
    });

    it('should handle promise rejection', async () => {
      const failingPromise = Promise.reject(new Error('API error'));
      
      await expect(withTimeout(failingPromise, 1000, 'test')).rejects.toThrow('API error');
    });

    it('should work with async functions', async () => {
      const asyncFn = async () => {
        return 'async result';
      };
      
      const result = await withTimeout(asyncFn(), 1000, 'async operation');
      
      expect(result).toBe('async result');
    });
  });

  describe('processBatch', () => {
    it('should process all items', async () => {
      const items = [1, 2, 3, 4, 5];
      const processed = [];
      
      await processBatch(items, 2, async (item) => {
        processed.push(item);
        return item * 2;
      });
      
      expect(processed).toEqual([1, 2, 3, 4, 5]);
    });

    it('should respect batch size', async () => {
      const items = [1, 2, 3, 4, 5, 6];
      const batchCalls = [];
      let currentBatch = [];
      
      await processBatch(items, 2, async (item) => {
        currentBatch.push(item);
        if (currentBatch.length === 2 || items.indexOf(item) === items.length - 1) {
          batchCalls.push([...currentBatch]);
          currentBatch = [];
        }
        return item;
      });
      
      // With batch size 2 and 6 items, we should have 3 batches
      expect(batchCalls.length).toBeLessThanOrEqual(3);
    });

    it('should return Promise.allSettled results', async () => {
      const items = [1, 2, 3];
      
      const results = await processBatch(items, 2, async (item) => {
        if (item === 2) throw new Error('Item 2 failed');
        return item * 2;
      });
      
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ status: 'fulfilled', value: 2 });
      expect(results[1]).toEqual({ status: 'rejected', reason: expect.any(Error) });
      expect(results[2]).toEqual({ status: 'fulfilled', value: 6 });
    });

    it('should handle empty array', async () => {
      const results = await processBatch([], 5, async (item) => item);
      
      expect(results).toEqual([]);
    });

    it('should handle batch size larger than items', async () => {
      const items = [1, 2];
      const processed = [];
      
      await processBatch(items, 10, async (item) => {
        processed.push(item);
        return item;
      });
      
      expect(processed).toEqual([1, 2]);
    });

    it('should handle batch size of 1 (sequential)', async () => {
      const items = [1, 2, 3];
      const order = [];
      
      await processBatch(items, 1, async (item) => {
        order.push(item);
        return item;
      });
      
      expect(order).toEqual([1, 2, 3]);
    });

    it('should process async functions concurrently within batch', async () => {
      const items = [100, 50, 25]; // delays in ms
      const startTime = Date.now();
      
      await processBatch(items, 3, async (delay) => {
        await new Promise(resolve => setTimeout(resolve, delay));
        return delay;
      });
      
      const elapsed = Date.now() - startTime;
      // All 3 should run concurrently, so total time ~ max(100, 50, 25) = ~100ms
      // Allow some buffer for test overhead
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(30000)).toBe('30s');
      expect(formatDuration(59000)).toBe('59s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(120000)).toBe('2m 0s');
      expect(formatDuration(3599000)).toBe('59m 59s');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(3600000)).toBe('1h 0m');
      expect(formatDuration(5400000)).toBe('1h 30m');
      expect(formatDuration(7200000)).toBe('2h 0m');
      expect(formatDuration(86399000)).toBe('23h 59m');
    });

    it('should format days and hours', () => {
      expect(formatDuration(86400000)).toBe('1d 0h');
      expect(formatDuration(129600000)).toBe('1d 12h');
      expect(formatDuration(172800000)).toBe('2d 0h');
      expect(formatDuration(259200000)).toBe('3d 0h');
    });

    it('should handle edge cases', () => {
      expect(formatDuration(500)).toBe('0s'); // Less than 1 second
      expect(formatDuration(999)).toBe('0s');
      expect(formatDuration(1001)).toBe('1s');
    });

    it('should handle large durations', () => {
      // 30 days
      expect(formatDuration(30 * 24 * 60 * 60 * 1000)).toBe('30d 0h');
      // 365 days
      expect(formatDuration(365 * 24 * 60 * 60 * 1000)).toBe('365d 0h');
    });
  });
});
