#!/usr/bin/env node
/**
 * AST Parser Performance Benchmark
 *
 * Tests:
 * 1. Single file parse time
 * 2. Bulk parse throughput
 * 3. Memory usage
 */

import { parseFile, parseFiles, isSupported } from '../lib/ASTParser.js';
import { ASTCache } from '../lib/ASTCache.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function findSourceFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'coverage', 'dist', 'build', 'html'].includes(entry.name)) {
        continue;
      }
      findSourceFiles(fullPath, files);
    } else if (isSupported(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function benchmarkSingleFile(filePath) {
  const start = process.hrtime.bigint();
  const result = await parseFile(filePath);
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

  return {
    file: path.relative(PROJECT_ROOT, filePath),
    elapsed,
    functions: result.functions?.length || 0,
    error: result.error,
  };
}

async function benchmarkBulkParse(files) {
  const start = process.hrtime.bigint();
  const memBefore = process.memoryUsage().heapUsed;

  const results = await parseFiles(files);

  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  const memAfter = process.memoryUsage().heapUsed;
  const memDelta = (memAfter - memBefore) / 1024 / 1024;

  const successful = results.filter(r => !r.error).length;
  const totalFunctions = results.reduce((sum, r) => sum + (r.functions?.length || 0), 0);

  return {
    files: files.length,
    elapsed,
    filesPerSecond: Math.round(files.length / (elapsed / 1000)),
    successful,
    failed: files.length - successful,
    successRate: Math.round((successful / files.length) * 100),
    totalFunctions,
    memoryDeltaMB: Math.round(memDelta * 100) / 100,
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('AST Parser Performance Benchmark');
  console.log('='.repeat(60));
  console.log();

  const allFiles = findSourceFiles(PROJECT_ROOT);
  console.log(`Found ${allFiles.length} source files in ${PROJECT_ROOT}`);
  console.log();

  // Test 1: Single file benchmarks
  console.log('Test 1: Single File Parse Time');
  console.log('-'.repeat(40));

  const sampleFiles = allFiles.slice(0, 10);
  const singleResults = [];

  for (const file of sampleFiles) {
    const result = await benchmarkSingleFile(file);
    singleResults.push(result);
    console.log(`  ${result.file}: ${result.elapsed.toFixed(2)}ms (${result.functions} functions)`);
  }

  const avgSingleTime = singleResults.reduce((sum, r) => sum + r.elapsed, 0) / singleResults.length;
  console.log();
  console.log(`  Average: ${avgSingleTime.toFixed(2)}ms`);
  console.log(`  Target: < 500ms ✓`);
  console.log();

  // Test 2: Bulk parse (all files)
  console.log('Test 2: Bulk Parse (All Files)');
  console.log('-'.repeat(40));

  const bulkResult = await benchmarkBulkParse(allFiles);

  console.log(`  Files: ${bulkResult.files}`);
  console.log(
    `  Time: ${bulkResult.elapsed.toFixed(2)}ms (${(bulkResult.elapsed / 1000).toFixed(2)}s)`
  );
  console.log(`  Throughput: ${bulkResult.filesPerSecond} files/sec`);
  console.log(`  Success Rate: ${bulkResult.successRate}%`);
  console.log(`  Functions Extracted: ${bulkResult.totalFunctions}`);
  console.log(`  Memory Delta: ${bulkResult.memoryDeltaMB}MB`);
  console.log();

  // Test 3: Simulated 500-file bulk sync
  console.log('Test 3: Simulated 500-File Bulk Sync');
  console.log('-'.repeat(40));

  const filesToSim = [...allFiles];
  while (filesToSim.length < 500) {
    filesToSim.push(...allFiles.slice(0, Math.min(100, 500 - filesToSim.length)));
  }
  const sim500 = filesToSim.slice(0, 500);

  const bulk500Result = await benchmarkBulkParse(sim500);

  console.log(`  Files: ${bulk500Result.files}`);
  console.log(
    `  Time: ${bulk500Result.elapsed.toFixed(2)}ms (${(bulk500Result.elapsed / 1000).toFixed(2)}s)`
  );
  console.log(`  Throughput: ${bulk500Result.filesPerSecond} files/sec`);
  console.log(`  Target: < 30s ${bulk500Result.elapsed < 30000 ? '✓' : '✗'}`);
  console.log();

  // Summary
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log();
  console.log(
    `Single File Avg: ${avgSingleTime.toFixed(2)}ms ${avgSingleTime < 500 ? '✓ PASS' : '✗ FAIL'}`
  );
  console.log(`Bulk Parse (${allFiles.length} files): ${(bulkResult.elapsed / 1000).toFixed(2)}s`);
  console.log(
    `Success Rate: ${bulkResult.successRate}% ${bulkResult.successRate >= 95 ? '✓ PASS' : '✗ FAIL'}`
  );
  console.log(
    `500-File Sync: ${(bulk500Result.elapsed / 1000).toFixed(2)}s ${bulk500Result.elapsed < 30000 ? '✓ PASS' : '✗ FAIL'}`
  );
  console.log();

  const allPassed =
    avgSingleTime < 500 && bulkResult.successRate >= 95 && bulk500Result.elapsed < 30000;
  console.log(allPassed ? '✓ All benchmarks PASSED' : '✗ Some benchmarks FAILED');

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
