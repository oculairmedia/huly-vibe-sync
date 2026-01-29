import { describe, it, expect, beforeAll } from 'vitest';

const isCI = process.env.CI === 'true';
import path from 'path';
import fs from 'fs';

import { readIssuesFromJSONL as readFromJSONL } from '../../lib/BeadsJSONLReader.js';
import { readIssuesFromDB } from '../../lib/BeadsDBReader.js';

const TEST_PROJECTS = [
  '/opt/stacks/huly-vibe-sync',
  '/opt/stacks/graphiti',
  '/opt/stacks/lettatoolsselector',
];

function getValidProjects() {
  return TEST_PROJECTS.filter(p => {
    const dbPath = path.join(p, '.beads', 'beads.db');
    const jsonlPath = path.join(p, '.beads', 'issues.jsonl');
    return fs.existsSync(dbPath) && fs.existsSync(jsonlPath);
  });
}

function benchmarkFn(fn, iterations = 10) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return {
    min: Math.min(...times),
    max: Math.max(...times),
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    median: times.sort((a, b) => a - b)[Math.floor(times.length / 2)],
  };
}

describe.skipIf(isCI)('BeadsReader Performance Benchmark', () => {
  const validProjects = getValidProjects();

  if (validProjects.length === 0) {
    it.skip('No valid test projects found', () => {});
    return;
  }

  describe.each(validProjects)('Project: %s', projectPath => {
    let jsonlCount = 0;
    let dbCount = 0;

    beforeAll(() => {
      jsonlCount = readFromJSONL(projectPath).length;
      dbCount = readIssuesFromDB(projectPath).length;
    });

    it('should read issues from both sources with DB filtering deleted', () => {
      // DB filters WHERE deleted_at IS NULL (active only), JSONL includes all issues
      expect(dbCount).toBeGreaterThan(0);
      expect(dbCount).toBeLessThanOrEqual(jsonlCount);
      console.log(`  JSONL: ${jsonlCount} issues (all), DB: ${dbCount} issues (active only)`);
    });

    it('should benchmark JSONL read performance', () => {
      const stats = benchmarkFn(() => readFromJSONL(projectPath), 20);
      console.log(
        `  JSONL read: avg=${stats.avg.toFixed(2)}ms, min=${stats.min.toFixed(2)}ms, max=${stats.max.toFixed(2)}ms`
      );
      expect(stats.avg).toBeLessThan(1000);
    });

    it('should benchmark SQLite read performance', () => {
      const stats = benchmarkFn(() => readIssuesFromDB(projectPath), 20);
      console.log(
        `  SQLite read: avg=${stats.avg.toFixed(2)}ms, min=${stats.min.toFixed(2)}ms, max=${stats.max.toFixed(2)}ms`
      );
      expect(stats.avg).toBeLessThan(1000);
    });

    it('should compare JSONL vs SQLite performance', () => {
      const jsonlStats = benchmarkFn(() => readFromJSONL(projectPath), 20);
      const dbStats = benchmarkFn(() => readIssuesFromDB(projectPath), 20);

      const ratio = jsonlStats.avg / dbStats.avg;
      const winner = ratio > 1 ? 'SQLite' : 'JSONL';
      const speedup = ratio > 1 ? ratio : 1 / ratio;

      console.log(`  Performance comparison:`);
      console.log(`    JSONL avg: ${jsonlStats.avg.toFixed(2)}ms`);
      console.log(`    SQLite avg: ${dbStats.avg.toFixed(2)}ms`);
      console.log(`    Winner: ${winner} (${speedup.toFixed(2)}x faster)`);

      expect(dbStats.avg).toBeDefined();
    });

    it('should verify DB returns richer data (descriptions, comments)', () => {
      const dbIssues = readIssuesFromDB(projectPath);
      const withDescriptions = dbIssues.filter(
        i => i.description && i.description.length > 0
      ).length;
      const withComments = dbIssues.filter(i => i.comments && i.comments.length > 0).length;
      const withDependencies = dbIssues.filter(
        i => i.dependencies && i.dependencies.length > 0
      ).length;

      console.log(
        `  DB enrichment: ${withDescriptions} with descriptions, ${withComments} with comments, ${withDependencies} with dependencies`
      );

      expect(dbIssues[0]).toHaveProperty('comments');
      expect(dbIssues[0]).toHaveProperty('dependencies');
    });
  });

  describe('Aggregate Performance Summary', () => {
    it('should produce summary across all projects', () => {
      let totalJsonlTime = 0;
      let totalDbTime = 0;
      let totalIssues = 0;

      for (const projectPath of validProjects) {
        const jsonlStats = benchmarkFn(() => readFromJSONL(projectPath), 10);
        const dbStats = benchmarkFn(() => readIssuesFromDB(projectPath), 10);
        const issueCount = readIssuesFromDB(projectPath).length;

        totalJsonlTime += jsonlStats.avg;
        totalDbTime += dbStats.avg;
        totalIssues += issueCount;
      }

      console.log('\n=== AGGREGATE PERFORMANCE SUMMARY ===');
      console.log(`Total projects tested: ${validProjects.length}`);
      console.log(`Total issues across projects: ${totalIssues}`);
      console.log(`Total JSONL read time: ${totalJsonlTime.toFixed(2)}ms`);
      console.log(`Total SQLite read time: ${totalDbTime.toFixed(2)}ms`);

      const winner = totalJsonlTime > totalDbTime ? 'SQLite' : 'JSONL';
      const speedup =
        totalJsonlTime > totalDbTime ? totalJsonlTime / totalDbTime : totalDbTime / totalJsonlTime;

      console.log(`Overall winner: ${winner} (${speedup.toFixed(2)}x faster)`);
      console.log('=====================================\n');

      expect(totalDbTime).toBeDefined();
    });
  });
});
