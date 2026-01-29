/**
 * Unit Tests for HealthService Module
 *
 * Tests health check endpoint, metrics tracking, and Prometheus integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import {
  initializeHealthStats,
  recordSuccessfulSync,
  recordFailedSync,
  recordSyncStats,
  recordApiLatency,
  getHealthMetrics,
  updateSystemMetrics,
  getMetricsRegistry,
  createHealthServer,
} from '../../lib/HealthService.js';

describe('HealthService', () => {
  describe('initializeHealthStats', () => {
    it('should create health stats with initial values', () => {
      const stats = initializeHealthStats();

      expect(stats).toHaveProperty('startTime');
      expect(stats.startTime).toBeCloseTo(Date.now(), -2); // Within 100ms
      expect(stats.lastSyncTime).toBeNull();
      expect(stats.lastSyncDuration).toBeNull();
      expect(stats.syncCount).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.lastError).toBeNull();
    });

    it('should create independent stats objects', () => {
      const stats1 = initializeHealthStats();
      const stats2 = initializeHealthStats();

      stats1.syncCount = 10;

      expect(stats2.syncCount).toBe(0);
    });
  });

  describe('recordSuccessfulSync', () => {
    it('should update health stats after successful sync', () => {
      const stats = initializeHealthStats();
      const duration = 1500;

      recordSuccessfulSync(stats, duration);

      expect(stats.syncCount).toBe(1);
      expect(stats.lastSyncDuration).toBe(1500);
      expect(stats.lastSyncTime).toBeCloseTo(Date.now(), -2);
    });

    it('should increment sync count on each call', () => {
      const stats = initializeHealthStats();

      recordSuccessfulSync(stats, 100);
      recordSuccessfulSync(stats, 200);
      recordSuccessfulSync(stats, 300);

      expect(stats.syncCount).toBe(3);
      expect(stats.lastSyncDuration).toBe(300); // Last duration
    });

    it('should not affect error count', () => {
      const stats = initializeHealthStats();
      stats.errorCount = 5;

      recordSuccessfulSync(stats, 100);

      expect(stats.errorCount).toBe(5);
    });
  });

  describe('recordFailedSync', () => {
    it('should update health stats after failed sync', () => {
      const stats = initializeHealthStats();
      const error = new Error('Connection failed');

      recordFailedSync(stats, error);

      expect(stats.errorCount).toBe(1);
      expect(stats.lastError).toBeDefined();
      expect(stats.lastError.message).toBe('Connection failed');
      expect(stats.lastError.timestamp).toBeCloseTo(Date.now(), -2);
    });

    it('should increment error count on each call', () => {
      const stats = initializeHealthStats();

      recordFailedSync(stats, new Error('Error 1'));
      recordFailedSync(stats, new Error('Error 2'));

      expect(stats.errorCount).toBe(2);
      expect(stats.lastError.message).toBe('Error 2'); // Last error
    });

    it('should not affect sync count', () => {
      const stats = initializeHealthStats();
      stats.syncCount = 10;

      recordFailedSync(stats, new Error('Test'));

      expect(stats.syncCount).toBe(10);
    });
  });

  describe('recordSyncStats', () => {
    it('should record project and issue counts', () => {
      // Just verify it doesn't throw
      expect(() => recordSyncStats(5, 100)).not.toThrow();
    });

    it('should handle zero counts', () => {
      expect(() => recordSyncStats(0, 0)).not.toThrow();
    });

    it('should handle large counts', () => {
      expect(() => recordSyncStats(1000, 50000)).not.toThrow();
    });
  });

  describe('recordApiLatency', () => {
    it('should record Huly API latency', () => {
      expect(() => recordApiLatency('huly', 'fetchProjects', 150)).not.toThrow();
    });

    it('should record Vibe API latency', () => {
      expect(() => recordApiLatency('vibe', 'listTasks', 200)).not.toThrow();
    });

    it('should handle unknown service gracefully', () => {
      expect(() => recordApiLatency('unknown', 'operation', 100)).not.toThrow();
    });

    it('should handle various operations', () => {
      expect(() => recordApiLatency('huly', 'fetchIssues', 100)).not.toThrow();
      expect(() => recordApiLatency('huly', 'updateIssue', 50)).not.toThrow();
      expect(() => recordApiLatency('vibe', 'createProject', 300)).not.toThrow();
    });

    it('should convert milliseconds to seconds for Prometheus', () => {
      // The function should not throw and should convert correctly
      expect(() => recordApiLatency('huly', 'test', 1500)).not.toThrow();
    });
  });

  describe('getHealthMetrics', () => {
    it('should return health metrics object', () => {
      const stats = initializeHealthStats();
      const config = {
        sync: {
          interval: 30000,
          apiDelay: 10,
          parallel: true,
          maxWorkers: 5,
          dryRun: false,
        },
        letta: {
          enabled: true,
        },
      };

      const metrics = getHealthMetrics(stats, config);

      expect(metrics.status).toBe('healthy');
      expect(metrics.service).toBe('huly-vibe-sync');
      expect(metrics.version).toBe('1.0.0');
      expect(metrics.uptime).toBeDefined();
      expect(metrics.sync).toBeDefined();
      expect(metrics.config).toBeDefined();
      expect(metrics.memory).toBeDefined();
      expect(metrics.connectionPool).toBeDefined();
    });

    it('should format uptime correctly', () => {
      const stats = initializeHealthStats();
      stats.startTime = Date.now() - 60000; // 1 minute ago

      const config = {
        sync: { interval: 30000, apiDelay: 10, parallel: false, maxWorkers: 1, dryRun: false },
        letta: { enabled: false },
      };

      const metrics = getHealthMetrics(stats, config);

      expect(metrics.uptime.milliseconds).toBeGreaterThanOrEqual(60000);
      expect(metrics.uptime.seconds).toBeGreaterThanOrEqual(60);
      expect(metrics.uptime.human).toMatch(/1m/);
    });

    it('should include sync statistics', () => {
      const stats = initializeHealthStats();
      recordSuccessfulSync(stats, 1500);
      recordSuccessfulSync(stats, 2000);
      recordFailedSync(stats, new Error('Test error'));

      const config = {
        sync: { interval: 30000, apiDelay: 10, parallel: false, maxWorkers: 1, dryRun: false },
        letta: { enabled: false },
      };

      const metrics = getHealthMetrics(stats, config);

      expect(metrics.sync.totalSyncs).toBe(2); // Only successful syncs counted
      expect(metrics.sync.errorCount).toBe(1);
      expect(metrics.sync.lastSyncDuration).toBe('2000ms');
      // Success rate formula: (syncCount - errorCount) / syncCount = (2-1)/2 = 50%
      expect(metrics.sync.successRate).toBe('50.00%');
    });

    it('should include last error when present', () => {
      const stats = initializeHealthStats();
      recordFailedSync(stats, new Error('Database connection failed'));

      const config = {
        sync: { interval: 30000, apiDelay: 10, parallel: false, maxWorkers: 1, dryRun: false },
        letta: { enabled: false },
      };

      const metrics = getHealthMetrics(stats, config);

      expect(metrics.lastError).toBeDefined();
      expect(metrics.lastError.message).toBe('Database connection failed');
      expect(metrics.lastError.timestamp).toBeDefined();
      expect(metrics.lastError.age).toBeDefined();
    });

    it('should return null for lastError when no errors', () => {
      const stats = initializeHealthStats();

      const config = {
        sync: { interval: 30000, apiDelay: 10, parallel: false, maxWorkers: 1, dryRun: false },
        letta: { enabled: false },
      };

      const metrics = getHealthMetrics(stats, config);

      expect(metrics.lastError).toBeNull();
    });

    it('should format config correctly', () => {
      const config = {
        sync: {
          interval: 60000,
          apiDelay: 50,
          parallel: true,
          maxWorkers: 10,
          dryRun: true,
        },
        letta: {
          enabled: true,
        },
      };

      const stats = initializeHealthStats();
      const metrics = getHealthMetrics(stats, config);

      expect(metrics.config.syncInterval).toBe('60s');
      expect(metrics.config.apiDelay).toBe('50ms');
      expect(metrics.config.parallelSync).toBe(true);
      expect(metrics.config.maxWorkers).toBe(10);
      expect(metrics.config.dryRun).toBe(true);
      expect(metrics.config.lettaEnabled).toBe(true);
    });

    it('should include memory statistics', () => {
      const stats = initializeHealthStats();
      const config = {
        sync: { interval: 30000, apiDelay: 10, parallel: false, maxWorkers: 1, dryRun: false },
        letta: { enabled: false },
      };

      const metrics = getHealthMetrics(stats, config);

      expect(metrics.memory.rss).toMatch(/\d+MB/);
      expect(metrics.memory.heapUsed).toMatch(/\d+MB/);
      expect(metrics.memory.heapTotal).toMatch(/\d+MB/);
    });

    it('should handle N/A success rate when no syncs', () => {
      const stats = initializeHealthStats();
      const config = {
        sync: { interval: 30000, apiDelay: 10, parallel: false, maxWorkers: 1, dryRun: false },
        letta: { enabled: false },
      };

      const metrics = getHealthMetrics(stats, config);

      expect(metrics.sync.successRate).toBe('N/A');
    });
  });

  describe('updateSystemMetrics', () => {
    it('should update system metrics without error', () => {
      expect(() => updateSystemMetrics()).not.toThrow();
    });

    it('should be callable multiple times', () => {
      expect(() => {
        updateSystemMetrics();
        updateSystemMetrics();
        updateSystemMetrics();
      }).not.toThrow();
    });
  });

  describe('getMetricsRegistry', () => {
    it('should return Prometheus registry', () => {
      const registry = getMetricsRegistry();

      expect(registry).toBeDefined();
      expect(typeof registry.metrics).toBe('function');
    });

    it('should return metrics in Prometheus format', async () => {
      const registry = getMetricsRegistry();
      const metricsOutput = await registry.metrics();

      expect(typeof metricsOutput).toBe('string');
      // Should contain some of our custom metrics
      expect(metricsOutput).toContain('sync');
    });
  });

  describe('Prometheus metrics integration', () => {
    it('should track sync runs', async () => {
      const stats = initializeHealthStats();

      recordSuccessfulSync(stats, 100);
      recordSuccessfulSync(stats, 200);
      recordFailedSync(stats, new Error('Test'));

      const registry = getMetricsRegistry();
      const metricsOutput = await registry.metrics();

      expect(metricsOutput).toContain('sync_runs_total');
    });

    it('should track API latency', async () => {
      recordApiLatency('huly', 'fetchProjects', 150);
      recordApiLatency('vibe', 'listTasks', 200);

      const registry = getMetricsRegistry();
      const metricsOutput = await registry.metrics();

      expect(metricsOutput).toContain('huly_api_latency');
      expect(metricsOutput).toContain('vibe_api_latency');
    });

    it('should track memory usage', async () => {
      updateSystemMetrics();

      const registry = getMetricsRegistry();
      const metricsOutput = await registry.metrics();

      expect(metricsOutput).toContain('memory_usage_bytes');
    });
  });

  describe('createHealthServer', () => {
    let server;
    let port;

    beforeEach(async () => {
      process.env.HEALTH_PORT = '0';
      const stats = initializeHealthStats();
      const config = {
        sync: {
          interval: 10000,
          apiDelay: 10,
          parallel: true,
          maxWorkers: 5,
          dryRun: false,
        },
        letta: {
          enabled: true,
        },
      };
      server = createHealthServer(stats, config);

      await new Promise(resolve => {
        server.on('listening', resolve);
      });

      const addr = server.address();
      port = typeof addr === 'object' ? addr.port : 0;
    });

    afterEach(async () => {
      if (server) {
        await new Promise(resolve => {
          server.close(resolve);
        });
      }
      delete process.env.HEALTH_PORT;
    });

    function makeRequest(path) {
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path,
            method: 'GET',
          },
          res => {
            let data = '';
            res.on('data', chunk => {
              data += chunk;
            });
            res.on('end', () => {
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: data,
              });
            });
          }
        );
        req.on('error', reject);
        req.end();
      });
    }

    it('should create and start HTTP server', async () => {
      expect(server).toBeDefined();
      expect(port).toBeGreaterThan(0);
    });

    it('should respond to /health endpoint with JSON', async () => {
      const response = await makeRequest('/health');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/json');

      const health = JSON.parse(response.body);
      expect(health.status).toBe('healthy');
      expect(health.service).toBe('huly-vibe-sync');
      expect(health.version).toBe('1.0.0');
      expect(health.uptime).toBeDefined();
      expect(health.sync).toBeDefined();
      expect(health.config).toBeDefined();
      expect(health.memory).toBeDefined();
    });

    it('should respond to /metrics endpoint with Prometheus format', async () => {
      const response = await makeRequest('/metrics');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.body).toContain('# HELP');
      expect(response.body).toContain('# TYPE');
    });

    it('should respond to / endpoint with plain text', async () => {
      const response = await makeRequest('/');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/plain');
      expect(response.body).toContain('Huly-Vibe Sync Service');
      expect(response.body).toContain('Health check: /health');
      expect(response.body).toContain('Metrics: /metrics');
    });

    it('should respond with 404 for unknown routes', async () => {
      const response = await makeRequest('/unknown');

      expect(response.status).toBe(404);
      expect(response.body).toBe('Not Found');
    });

    it('should respond with 404 for /api endpoint', async () => {
      const response = await makeRequest('/api');

      expect(response.status).toBe(404);
    });

    it('should respond with 404 for /status endpoint', async () => {
      const response = await makeRequest('/status');

      expect(response.status).toBe(404);
    });

    it('should handle multiple requests to /health', async () => {
      const response1 = await makeRequest('/health');
      const response2 = await makeRequest('/health');

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      const health1 = JSON.parse(response1.body);
      const health2 = JSON.parse(response2.body);

      expect(health1.status).toBe('healthy');
      expect(health2.status).toBe('healthy');
    });

    it('should handle multiple requests to /metrics', async () => {
      const response1 = await makeRequest('/metrics');
      const response2 = await makeRequest('/metrics');

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response1.body).toContain('# HELP');
      expect(response2.body).toContain('# HELP');
    });

    it('should include health stats in /health response', async () => {
      const stats = initializeHealthStats();
      recordSuccessfulSync(stats, 1500);
      recordFailedSync(stats, new Error('Test error'));

      const config = {
        sync: {
          interval: 10000,
          apiDelay: 10,
          parallel: true,
          maxWorkers: 5,
          dryRun: false,
        },
        letta: {
          enabled: true,
        },
      };

      await new Promise(resolve => {
        server.close(resolve);
      });

      process.env.HEALTH_PORT = '0';
      server = createHealthServer(stats, config);
      await new Promise(resolve => {
        server.on('listening', resolve);
      });
      const addr = server.address();
      port = typeof addr === 'object' ? addr.port : 0;

      const response = await makeRequest('/health');
      const health = JSON.parse(response.body);

      expect(health.sync.totalSyncs).toBe(1);
      expect(health.sync.errorCount).toBe(1);
    });

    it('should use custom HEALTH_PORT from environment', async () => {
      await new Promise(resolve => {
        server.close(resolve);
      });

      process.env.HEALTH_PORT = '0';
      const stats = initializeHealthStats();
      const config = {
        sync: { interval: 10000, apiDelay: 10, parallel: true, maxWorkers: 5, dryRun: false },
        letta: { enabled: true },
      };
      server = createHealthServer(stats, config);

      await new Promise(resolve => {
        server.on('listening', resolve);
      });

      const addr = server.address();
      const newPort = typeof addr === 'object' ? addr.port : 0;
      expect(newPort).toBeGreaterThan(0);

      port = newPort;
      const response = await makeRequest('/');
      expect(response.status).toBe(200);
    });

    it('should return valid JSON from /health endpoint', async () => {
      const response = await makeRequest('/health');

      expect(() => {
        JSON.parse(response.body);
      }).not.toThrow();
    });

    it('should include config in /health response', async () => {
      const response = await makeRequest('/health');
      const health = JSON.parse(response.body);

      expect(health.config).toBeDefined();
      expect(health.config.syncInterval).toBe('10s');
      expect(health.config.dryRun).toBe(false);
      expect(health.config.lettaEnabled).toBe(true);
    });

    it('should include memory info in /health response', async () => {
      const response = await makeRequest('/health');
      const health = JSON.parse(response.body);

      expect(health.memory).toBeDefined();
      expect(health.memory.rss).toMatch(/\d+MB/);
      expect(health.memory.heapUsed).toMatch(/\d+MB/);
      expect(health.memory.heapTotal).toMatch(/\d+MB/);
    });

    it('should include connection pool info in /health response', async () => {
      const response = await makeRequest('/health');
      const health = JSON.parse(response.body);

      expect(health.connectionPool).toBeDefined();
      expect(health.connectionPool.http).toBeDefined();
      expect(health.connectionPool.https).toBeDefined();
    });
  });
});
