/**
 * Unit Tests for Utility Functions
 *
 * Tests general-purpose utility functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, processBatch, formatDuration } from '../../lib/utils.js';

describe('utils', () => {
  describe('withTimeout', () => {
    it('should resolve when promise completes before timeout', async () => {
      const fastPromise = new Promise((resolve) =>
        setTimeout(() => resolve('success'), 10)
      );

      const result = await withTimeout(fastPromise, 100, 'fast operation');

      expect(result).toBe('success');
    });

    it('should reject when promise exceeds timeout', async () => {
      const slowPromise = new Promise((resolve) =>
        setTimeout(() => resolve('too late'), 200)
      );

      await expect(
        withTimeout(slowPromise, 50, 'slow operation')
      ).rejects.toThrow('Timeout after 50ms: slow operation');
    });

    it('should propagate promise rejection', async () => {
      const failingPromise = Promise.reject(new Error('operation failed'));

      await expect(
        withTimeout(failingPromise, 1000, 'failing operation')
      ).rejects.toThrow('operation failed');
    });

    it('should handle immediate resolution', async () => {
      const immediatePromise = Promise.resolve('instant');

      const result = await withTimeout(
        immediatePromise,
        100,
        'immediate operation'
      );

      expect(result).toBe('instant');
    });

    it('should handle immediate rejection', async () => {
      const immediateReject = Promise.reject(new Error('instant fail'));

      await expect(
        withTimeout(immediateReject, 100, 'immediate reject')
      ).rejects.toThrow('instant fail');
    });

    it('should work with zero timeout', async () => {
      const promise = new Promise((resolve) => setTimeout(resolve, 10));

      await expect(
        withTimeout(promise, 0, 'zero timeout')
      ).rejects.toThrow('Timeout after 0ms');
    });

    it('should cancel timeout on promise resolution', async () => {
      const promise = Promise.resolve('done');
      const result = await withTimeout(promise, 1000, 'test');
      expect(result).toBe('done');

      // Wait to ensure timeout doesn't fire
      await new Promise(resolve => setTimeout(resolve, 50));
    });
  });

  describe('processBatch', () => {
    it('should process all items in batches', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const processedItems = [];

      const results = await processBatch(items, 3, async (item) => {
        processedItems.push(item);
        return item * 2;
      });

      expect(results).toHaveLength(10);
      expect(processedItems).toEqual(items);
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    });

    it('should return values from process function', async () => {
      const items = [1, 2, 3];
      const results = await processBatch(items, 2, async (item) => item * 2);

      expect(results[0]).toEqual({ status: 'fulfilled', value: 2 });
      expect(results[1]).toEqual({ status: 'fulfilled', value: 4 });
      expect(results[2]).toEqual({ status: 'fulfilled', value: 6 });
    });

    it('should handle batch size larger than array', async () => {
      const items = [1, 2, 3];
      const results = await processBatch(items, 10, async (item) => item);

      expect(results).toHaveLength(3);
    });

    it('should handle empty array', async () => {
      const items = [];
      const results = await processBatch(items, 5, async (item) => item);

      expect(results).toEqual([]);
    });

    it('should handle batch size of 1', async () => {
      const items = [1, 2, 3];
      const order = [];

      await processBatch(items, 1, async (item) => {
        order.push(item);
        return item;
      });

      expect(order).toEqual([1, 2, 3]); // Processed sequentially
    });

    it('should capture both successes and failures', async () => {
      const items = [1, 2, 3, 4];
      const results = await processBatch(items, 2, async (item) => {
        if (item % 2 === 0) {
          throw new Error(`Failed on ${item}`);
        }
        return item;
      });

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
      expect(results[1].status).toBe('rejected');
      expect(results[1].reason.message).toContain('Failed on 2');
      expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
      expect(results[3].status).toBe('rejected');
    });

    it('should process batches concurrently', async () => {
      const items = [1, 2, 3, 4, 5, 6];
      const executionTimes = [];

      const start = Date.now();
      await processBatch(items, 3, async (item) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        executionTimes.push(Date.now() - start);
        return item;
      });

      // With batch size 3, should complete in ~2 batches
      // First batch at ~50ms, second batch at ~100ms
      expect(executionTimes[0]).toBeLessThan(100);
      expect(executionTimes[2]).toBeLessThan(100); // Items 1-3 in parallel
      expect(executionTimes[5]).toBeGreaterThan(100); // Items 4-6 in second batch
    });

    it('should handle async errors gracefully', async () => {
      const items = [1, 2, 3];
      const results = await processBatch(items, 2, async (item) => {
        if (item === 2) {
          throw new Error('Intentional error');
        }
        return item * 2;
      });

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');
    });

    it('should work with complex objects', async () => {
      const items = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ];

      const results = await processBatch(items, 2, async (item) => ({
        ...item,
        processed: true,
      }));

      expect(results[0].value).toEqual({ id: 1, name: 'Alice', processed: true });
      expect(results[1].value).toEqual({ id: 2, name: 'Bob', processed: true });
      expect(results[2].value).toEqual({ id: 3, name: 'Charlie', processed: true });
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(30000)).toBe('30s');
      expect(formatDuration(59000)).toBe('59s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(125000)).toBe('2m 5s');
      expect(formatDuration(3599000)).toBe('59m 59s');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(3600000)).toBe('1h 0m');
      expect(formatDuration(5400000)).toBe('1h 30m');
      expect(formatDuration(7380000)).toBe('2h 3m');
      expect(formatDuration(86399000)).toBe('23h 59m');
    });

    it('should format days and hours', () => {
      expect(formatDuration(86400000)).toBe('1d 0h');
      expect(formatDuration(90000000)).toBe('1d 1h');
      expect(formatDuration(172800000)).toBe('2d 0h');
      expect(formatDuration(176400000)).toBe('2d 1h');
    });

    it('should handle zero duration', () => {
      expect(formatDuration(0)).toBe('0s');
    });

    it('should handle very small durations', () => {
      expect(formatDuration(1)).toBe('0s');
      expect(formatDuration(500)).toBe('0s');
      expect(formatDuration(999)).toBe('0s');
    });

    it('should handle very large durations', () => {
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      expect(formatDuration(oneWeek)).toBe('7d 0h');

      const oneMonth = 30 * 24 * 60 * 60 * 1000;
      expect(formatDuration(oneMonth)).toBe('30d 0h');
    });

    it('should round down partial seconds', () => {
      expect(formatDuration(1500)).toBe('1s');
      expect(formatDuration(2999)).toBe('2s');
    });

    it('should format typical sync durations', () => {
      expect(formatDuration(3000)).toBe('3s');
      expect(formatDuration(21000)).toBe('21s');
      expect(formatDuration(289000)).toBe('4m 49s');
    });

    it('should format typical uptime durations', () => {
      const oneHour = 3600000;
      const oneDay = 86400000;

      expect(formatDuration(oneHour)).toBe('1h 0m');
      expect(formatDuration(oneDay)).toBe('1d 0h');
      expect(formatDuration(oneDay + oneHour)).toBe('1d 1h');
    });
  });

  describe('edge cases', () => {
    it('withTimeout should handle undefined operation name', async () => {
      const promise = new Promise(resolve => setTimeout(resolve, 100));

      await expect(
        withTimeout(promise, 10, undefined)
      ).rejects.toThrow('Timeout after 10ms: undefined');
    });

    it('processBatch should handle null items', async () => {
      const items = [null, undefined, 0, false, ''];
      const results = await processBatch(items, 2, async (item) => item);

      expect(results).toHaveLength(5);
      expect(results[0].value).toBeNull();
      expect(results[1].value).toBeUndefined();
      expect(results[2].value).toBe(0);
      expect(results[3].value).toBe(false);
      expect(results[4].value).toBe('');
    });

    it('formatDuration should handle negative values', () => {
      // Should treat negative as zero or handle gracefully
      expect(formatDuration(-1000)).toBe('0s');
    });

    it('formatDuration should handle non-integer values', () => {
      expect(formatDuration(1500.7)).toBe('1s');
      expect(formatDuration(60000.5)).toBe('1m 0s');
    });
  });

  describe('performance', () => {
    it('processBatch should be efficient with large arrays', async () => {
      const items = Array.from({ length: 1000 }, (_, i) => i);
      const start = Date.now();

      await processBatch(items, 100, async (item) => item);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
    });

    it('formatDuration should be fast', () => {
      const iterations = 10000;
      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        formatDuration(Math.random() * 86400000);
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // Should format 10k durations in < 100ms
    });
  });
});
