/**
 * Unit Tests for HealthService
 *
 * Tests health metrics, monitoring, and Prometheus metrics
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getHealthMetrics,
  recordApiLatency,
  recordSyncStats,
  metrics,
} from '../../lib/HealthService.js';

// Mock dependencies
vi.mock('../../lib/utils.js', () => ({
  formatDuration: vi.fn((ms) => `${Math.floor(ms / 1000)}s`),
}));

vi.mock('../../lib/http.js', () => ({
  getPoolStats: vi.fn(() => ({
    http: { sockets: 5, freeSockets: 3 },
    https: { sockets: 2, freeSockets: 1 },
  })),
}));

describe('HealthService', () => {
  describe('getHealthMetrics', () => {
    let healthStats;
    let config;

    beforeEach(() => {
      healthStats = {
        startTime: Date.now() - 300000, // 5 minutes ago
        lastSyncTime: Date.now() - 30000, // 30 seconds ago
        lastSyncDuration: 21000, // 21 seconds
        syncCount: 10,
        errorCount: 1,
        lastError: {
          message: 'Test error',
          timestamp: Date.now() - 60000, // 1 minute ago
        },
      };

      config = {
        sync: {
          interval: 30000,
          apiDelay: 10,
          parallel: true,
          maxWorkers: 5,
          dryRun: false,
          incremental: true,
        },
      };
    });

    it('should return health metrics with all fields', () => {
      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics).toHaveProperty('status', 'healthy');
      expect(metrics).toHaveProperty('service', 'huly-vibe-sync');
      expect(metrics).toHaveProperty('version', '1.0.0');
      expect(metrics).toHaveProperty('uptime');
      expect(metrics).toHaveProperty('sync');
      expect(metrics).toHaveProperty('lastError');
      expect(metrics).toHaveProperty('config');
    });

    it('should calculate uptime correctly', () => {
      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics.uptime).toHaveProperty('milliseconds');
      expect(metrics.uptime).toHaveProperty('seconds');
      expect(metrics.uptime).toHaveProperty('human');
      expect(metrics.uptime.seconds).toBeGreaterThan(0);
    });

    it('should format sync information', () => {
      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics.sync.totalSyncs).toBe(10);
      expect(metrics.sync.errorCount).toBe(1);
      expect(metrics.sync.successRate).toBe('90.00%');
      expect(metrics.sync.lastSyncDuration).toBe('21000ms');
    });

    it('should handle zero syncs gracefully', () => {
      healthStats.syncCount = 0;
      healthStats.errorCount = 0;

      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics.sync.totalSyncs).toBe(0);
      expect(metrics.sync.successRate).toBe('N/A');
    });

    it('should include error information when present', () => {
      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics.lastError).toBeTruthy();
      expect(metrics.lastError.message).toBe('Test error');
      expect(metrics.lastError).toHaveProperty('timestamp');
      expect(metrics.lastError).toHaveProperty('age');
    });

    it('should handle absence of errors', () => {
      healthStats.lastError = null;

      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics.lastError).toBeNull();
    });

    it('should include configuration details', () => {
      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics.config.syncInterval).toBe('30s');
      expect(metrics.config.apiDelay).toBe('10ms');
      expect(metrics.config.parallelSync).toBe(true);
      expect(metrics.config.maxWorkers).toBe(5);
      expect(metrics.config.dryRun).toBe(false);
    });

    it('should format ISO timestamps', () => {
      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics.sync.lastSyncTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      if (metrics.lastError) {
        expect(metrics.lastError.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });

    it('should handle null last sync time', () => {
      healthStats.lastSyncTime = null;

      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics.sync.lastSyncTime).toBeNull();
    });

    it('should calculate 100% success rate', () => {
      healthStats.syncCount = 10;
      healthStats.errorCount = 0;

      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics.sync.successRate).toBe('100.00%');
    });

    it('should calculate 0% success rate', () => {
      healthStats.syncCount = 10;
      healthStats.errorCount = 10;

      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics.sync.successRate).toBe('0.00%');
    });
  });

  describe('recordApiLatency', () => {
    beforeEach(() => {
      // Reset histogram between tests
      if (metrics.hulyApiLatency.reset) {
        metrics.hulyApiLatency.reset();
      }
      if (metrics.vibeApiLatency.reset) {
        metrics.vibeApiLatency.reset();
      }
    });

    it('should record Huly API latency', () => {
      expect(() => {
        recordApiLatency('huly', 'listProjects', 1500);
      }).not.toThrow();
    });

    it('should record Vibe API latency', () => {
      expect(() => {
        recordApiLatency('vibe', 'createTask', 250);
      }).not.toThrow();
    });

    it('should handle different operations', () => {
      expect(() => {
        recordApiLatency('huly', 'listIssues', 500);
        recordApiLatency('huly', 'updateIssue', 300);
        recordApiLatency('vibe', 'listTasks', 450);
        recordApiLatency('vibe', 'updateTask', 200);
      }).not.toThrow();
    });

    it('should handle very fast operations', () => {
      expect(() => {
        recordApiLatency('huly', 'fastOp', 1);
      }).not.toThrow();
    });

    it('should handle slow operations', () => {
      expect(() => {
        recordApiLatency('vibe', 'slowOp', 30000);
      }).not.toThrow();
    });

    it('should handle zero latency', () => {
      expect(() => {
        recordApiLatency('huly', 'instant', 0);
      }).not.toThrow();
    });
  });

  describe('recordSyncStats', () => {
    beforeEach(() => {
      // Reset gauges between tests
      if (metrics.projectsProcessed.reset) {
        metrics.projectsProcessed.reset();
      }
      if (metrics.issuesSynced.reset) {
        metrics.issuesSynced.reset();
      }
    });

    it('should record sync statistics', () => {
      expect(() => {
        recordSyncStats({
          projectsProcessed: 44,
          issuesSynced: 299,
        });
      }).not.toThrow();
    });

    it('should handle zero values', () => {
      expect(() => {
        recordSyncStats({
          projectsProcessed: 0,
          issuesSynced: 0,
        });
      }).not.toThrow();
    });

    it('should handle large values', () => {
      expect(() => {
        recordSyncStats({
          projectsProcessed: 1000,
          issuesSynced: 50000,
        });
      }).not.toThrow();
    });

    it('should update values on multiple calls', () => {
      expect(() => {
        recordSyncStats({ projectsProcessed: 10, issuesSynced: 100 });
        recordSyncStats({ projectsProcessed: 20, issuesSynced: 200 });
        recordSyncStats({ projectsProcessed: 30, issuesSynced: 300 });
      }).not.toThrow();
    });
  });

  describe('Prometheus metrics', () => {
    it('should have syncRunsTotal counter', () => {
      expect(metrics.syncRunsTotal).toBeDefined();
      expect(metrics.syncRunsTotal.name).toBe('sync_runs_total');
    });

    it('should have syncDuration histogram', () => {
      expect(metrics.syncDuration).toBeDefined();
      expect(metrics.syncDuration.name).toBe('sync_duration_seconds');
    });

    it('should have API latency histograms', () => {
      expect(metrics.hulyApiLatency).toBeDefined();
      expect(metrics.hulyApiLatency.name).toBe('huly_api_latency_seconds');

      expect(metrics.vibeApiLatency).toBeDefined();
      expect(metrics.vibeApiLatency.name).toBe('vibe_api_latency_seconds');
    });

    it('should have gauge metrics', () => {
      expect(metrics.projectsProcessed).toBeDefined();
      expect(metrics.issuesSynced).toBeDefined();
      expect(metrics.memoryUsageBytes).toBeDefined();
      expect(metrics.connectionPoolActive).toBeDefined();
      expect(metrics.connectionPoolFree).toBeDefined();
    });

    it('should increment sync counter', () => {
      const before = metrics.syncRunsTotal.hashMap['status:success']?.value || 0;
      metrics.syncRunsTotal.inc({ status: 'success' });
      const after = metrics.syncRunsTotal.hashMap['status:success']?.value || 0;

      expect(after).toBeGreaterThan(before);
    });

    it('should observe sync duration', () => {
      expect(() => {
        metrics.syncDuration.observe(21.5);
        metrics.syncDuration.observe(15.2);
        metrics.syncDuration.observe(30.8);
      }).not.toThrow();
    });

    it('should set gauge values', () => {
      expect(() => {
        metrics.projectsProcessed.set(44);
        metrics.issuesSynced.set(299);
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle missing config fields gracefully', () => {
      const healthStats = {
        startTime: Date.now(),
        syncCount: 0,
        errorCount: 0,
      };

      const minimalConfig = {
        sync: {
          interval: 10000,
          apiDelay: 10,
        },
      };

      const metrics = getHealthMetrics(healthStats, minimalConfig);

      expect(metrics).toBeDefined();
      expect(metrics.config.syncInterval).toBe('10s');
    });

    it('should handle very long uptime', () => {
      const healthStats = {
        startTime: Date.now() - (365 * 24 * 60 * 60 * 1000), // 1 year ago
        syncCount: 10000,
        errorCount: 5,
      };

      const config = {
        sync: {
          interval: 30000,
          apiDelay: 10,
        },
      };

      const metrics = getHealthMetrics(healthStats, config);

      expect(metrics.uptime.seconds).toBeGreaterThan(365 * 24 * 60 * 60);
    });

    it('should handle future timestamps gracefully', () => {
      const healthStats = {
        startTime: Date.now() + 60000, // 1 minute in future (clock skew)
        syncCount: 0,
        errorCount: 0,
      };

      const config = {
        sync: {
          interval: 30000,
          apiDelay: 10,
        },
      };

      // Should not throw
      expect(() => {
        getHealthMetrics(healthStats, config);
      }).not.toThrow();
    });
  });

  describe('performance', () => {
    it('should generate metrics quickly', () => {
      const healthStats = {
        startTime: Date.now() - 300000,
        lastSyncTime: Date.now(),
        lastSyncDuration: 21000,
        syncCount: 100,
        errorCount: 2,
      };

      const config = {
        sync: {
          interval: 30000,
          apiDelay: 10,
          parallel: true,
          maxWorkers: 5,
          dryRun: false,
        },
      };

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        getHealthMetrics(healthStats, config);
      }
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100); // 1000 calls in < 100ms
    });
  });
});
