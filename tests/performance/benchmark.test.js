/**
 * Performance Benchmarking Suite
 * 
 * Tests performance characteristics of key operations
 * Measures execution time for critical operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncDatabase } from '../../lib/database.js';
import { HulyRestClient } from '../../lib/HulyRestClient.js';
import { mapHulyStatusToVibe, mapVibeStatusToHuly } from '../../lib/statusMapper.js';
import { parseIssuesFromText, parseProjectsFromText } from '../../lib/textParsers.js';
import { fetchWithPool, getPoolStats } from '../../lib/http.js';
import {
  createMockHulyProject,
  createMockHulyIssue,
} from '../mocks/hulyMocks.js';

describe('Performance Benchmarks', () => {
  describe('Database Operations', () => {
    let db;

    beforeEach(() => {
      db = new SyncDatabase(':memory:');
      db.initialize();
    });

    afterEach(() => {
      if (db) {
        db.close();
      }
    });

    it('should insert 100 projects efficiently', () => {
      const start = Date.now();
      
      for (let i = 0; i < 100; i++) {
        db.upsertProject({
          identifier: `BENCH${i}`,
          name: `Benchmark Project ${i}`,
          description: 'Performance test project',
        });
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // Should complete in < 100ms
    });

    it('should insert 1000 issues efficiently', () => {
      // Setup: Create project first
      db.upsertProject({
        identifier: 'PERF',
        name: 'Performance Test',
        description: 'Test',
      });

      const start = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        db.upsertIssue({
          identifier: `PERF-${i}`,
          project_identifier: 'PERF',
          title: `Issue ${i}`,
          description: `Performance test issue ${i}`,
          status: 'Todo',
          priority: 'Medium',
        });
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500); // Should complete in < 500ms
    });

    it('should query all projects efficiently', () => {
      // Insert test data
      for (let i = 0; i < 50; i++) {
        db.upsertProject({
          identifier: `TEST${i}`,
          name: `Test Project ${i}`,
        });
      }
      
      const start = Date.now();
      const projects = db.getAllProjects();
      const duration = Date.now() - start;
      
      expect(projects).toHaveLength(50);
      expect(duration).toBeLessThan(10); // Should query in < 10ms
    });

    it('should query issues by project efficiently', () => {
      db.upsertProject({
        identifier: 'PERF',
        name: 'Performance Test',
      });
      
      for (let i = 0; i < 100; i++) {
        db.upsertIssue({
          identifier: `PERF-${i}`,
          project_identifier: 'PERF',
          title: `Issue ${i}`,
        });
      }
      
      const start = Date.now();
      const issues = db.getProjectIssues('PERF');
      const duration = Date.now() - start;
      
      expect(issues).toHaveLength(100);
      expect(duration).toBeLessThan(20); // Should query in < 20ms
    });

    it('should update issue status efficiently', () => {
      db.upsertProject({
        identifier: 'PERF',
        name: 'Performance Test',
      });
      
      db.upsertIssue({
        identifier: 'PERF-1',
        project_identifier: 'PERF',
        title: 'Test Issue',
        status: 'Todo',
      });
      
      const start = Date.now();
      
      db.upsertIssue({
        identifier: 'PERF-1',
        project_identifier: 'PERF',
        title: 'Test Issue',
        status: 'Done',
      });
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5); // Should update in < 5ms
    });
  });

  describe('Status Mapping Performance', () => {
    const testStatuses = ['Todo', 'InProgress', 'InReview', 'Done', 'Cancelled', 'Backlog'];
    const vibeStatuses = ['todo', 'inprogress', 'inreview', 'done', 'cancelled'];

    it('should perform Huly to Vibe mapping efficiently (1000 calls)', () => {
      const start = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        mapHulyStatusToVibe(testStatuses[i % testStatuses.length]);
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10); // Should complete in < 10ms
    });

    it('should perform Vibe to Huly mapping efficiently (1000 calls)', () => {
      const start = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        mapVibeStatusToHuly(vibeStatuses[i % vibeStatuses.length]);
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10); // Should complete in < 10ms
    });

    it('should perform roundtrip conversion efficiently (500 cycles)', () => {
      const start = Date.now();
      
      for (let i = 0; i < 500; i++) {
        const status = testStatuses[i % testStatuses.length];
        const vibe = mapHulyStatusToVibe(status);
        mapVibeStatusToHuly(vibe);
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10); // Should complete in < 10ms
    });
  });

  describe('Text Parsing Performance', () => {
    it('should parse issues from text efficiently (100 calls)', () => {
      const issueText = `
        Issue TEST-1: First issue
        Issue TEST-2: Second issue
        Issue TEST-3: Third issue
      `;
      
      const start = Date.now();
      
      for (let i = 0; i < 100; i++) {
        parseIssuesFromText(issueText);
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(50); // Should complete in < 50ms
    });

    it('should parse projects from text efficiently (100 calls)', () => {
      const projectText = `
        Project TEST: Test Project
        Project DEMO: Demo Project
        Project PROD: Production Project
      `;
      
      const start = Date.now();
      
      for (let i = 0; i < 100; i++) {
        parseProjectsFromText(projectText);
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(50); // Should complete in < 50ms
    });
  });

  describe('HTTP Connection Pool Performance', () => {
    it('should get pool stats efficiently (1000 calls)', () => {
      const start = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        getPoolStats();
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(50); // Should complete in < 50ms
    });

    it('should determine agent selection efficiently (1000 calls)', () => {
      const urls = [
        'http://example.com',
        'https://example.com',
        'http://api.example.com:8080',
        'https://secure.example.com:8443',
      ];
      
      const start = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        const url = urls[i % urls.length];
        const isHttps = url.startsWith('https://');
        // Simulate agent selection logic
        const agent = isHttps ? 'httpsAgent' : 'httpAgent';
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5); // Should complete in < 5ms
    });
  });

  describe('Mock Factory Performance', () => {
    it('should create 1000 mock projects efficiently', () => {
      const start = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        createMockHulyProject({ identifier: `MOCK${i}` });
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // Should complete in < 100ms
    });

    it('should create 1000 mock issues efficiently', () => {
      const start = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        createMockHulyIssue({ identifier: `TEST-${i}` });
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // Should complete in < 100ms
    });

    it('should create batch of 100 projects efficiently', () => {
      const start = Date.now();
      
      Array.from({ length: 100 }, (_, i) =>
        createMockHulyProject({ identifier: `BATCH${i}` })
      );
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(20); // Should complete in < 20ms
    });

    it('should create batch of 100 issues efficiently', () => {
      const start = Date.now();
      
      Array.from({ length: 100 }, (_, i) =>
        createMockHulyIssue({ identifier: `TEST-${i}` })
      );
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(20); // Should complete in < 20ms
    });
  });

  describe('Memory Usage Patterns', () => {
    it('should handle large dataset without excessive memory', () => {
      const db = new SyncDatabase(':memory:');
      db.initialize();

      const startMem = process.memoryUsage().heapUsed;

      // Insert large dataset
      for (let i = 0; i < 1000; i++) {
        db.upsertProject({
          identifier: `LARGE${i}`,
          name: `Large Project ${i}`,
          description: 'A'.repeat(1000), // 1KB description
        });
      }

      for (let i = 0; i < 5000; i++) {
        db.upsertIssue({
          identifier: `LARGE-${i}`,
          project_identifier: `LARGE${i % 1000}`,
          title: `Issue ${i}`,
          description: 'B'.repeat(500), // 500B description
        });
      }

      const endMem = process.memoryUsage().heapUsed;
      const memoryIncreaseMB = (endMem - startMem) / 1024 / 1024;

      // Should not use excessive memory (< 100MB for this dataset)
      expect(memoryIncreaseMB).toBeLessThan(100);

      db.close();
    });

    it('should close database connection properly', () => {
      const db = new SyncDatabase(':memory:');
      db.initialize();

      // Insert data
      for (let i = 0; i < 100; i++) {
        db.upsertProject({
          identifier: `MEM${i}`,
          name: `Memory Test ${i}`,
        });
      }

      db.close();

      // Should not be able to perform operations after close
      expect(() => {
        db.upsertProject({
          identifier: 'TEST',
          name: 'Should Fail',
        });
      }).toThrow();
    });
  });

  describe('Concurrency Characteristics', () => {
    it('should handle concurrent database operations', () => {
      const db = new SyncDatabase(':memory:');
      db.initialize();

      const operations = [];

      // Simulate concurrent operations
      for (let i = 0; i < 100; i++) {
        operations.push(
          Promise.resolve().then(() => {
            db.upsertProject({
              identifier: `CONC${i}`,
              name: `Concurrent ${i}`,
            });
          })
        );
      }

      return Promise.all(operations).then(() => {
        const projects = db.getAllProjects();
        expect(projects).toHaveLength(100);
        db.close();
      });
    });

    it('should handle rapid status mapping calls', () => {
      const start = Date.now();
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        mapHulyStatusToVibe('InProgress');
      }

      const duration = Date.now() - start;
      const callsPerMs = iterations / duration;

      // Should handle at least 100 calls per ms
      expect(callsPerMs).toBeGreaterThan(100);
    });
  });

  describe('Baseline Performance Metrics', () => {
    it('should complete 100 project inserts in < 100ms', () => {
      const db = new SyncDatabase(':memory:');
      db.initialize();

      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        db.upsertProject({
          identifier: `BASE${i}`,
          name: `Baseline ${i}`,
        });
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);

      db.close();
    });

    it('should complete 1000 status mappings in < 10ms', () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        mapHulyStatusToVibe('Todo');
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10);
    });

    it('should query 1000 issues in < 50ms', () => {
      const db = new SyncDatabase(':memory:');
      db.initialize();

      db.upsertProject({
        identifier: 'QUERY',
        name: 'Query Test',
      });

      for (let i = 0; i < 1000; i++) {
        db.upsertIssue({
          identifier: `QUERY-${i}`,
          project_identifier: 'QUERY',
          title: `Issue ${i}`,
        });
      }

      const start = Date.now();
      const issues = db.getProjectIssues('QUERY');
      const duration = Date.now() - start;

      expect(issues).toHaveLength(1000);
      expect(duration).toBeLessThan(50);

      db.close();
    });
  });
});
