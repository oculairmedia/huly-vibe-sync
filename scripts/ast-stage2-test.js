#!/usr/bin/env node
/**
 * AST Integration Test - Stage 2
 * 
 * Tests AST parsing → Graphiti sync across 5 projects.
 * PRD Phase 4.3 validation.
 */

import { parseFile, parseFiles, isSupported } from '../lib/ASTParser.js';
import { GraphitiClient } from '../lib/GraphitiClient.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GRAPHITI_URL = process.env.GRAPHITI_API_URL || 'http://192.168.50.90:8003';

// Stage 2 target projects
const PROJECTS = [
  { id: 'huly-vibe-sync', path: '/opt/stacks/huly-vibe-sync' },
  { id: 'graphiti', path: '/opt/stacks/graphiti' },
  { id: 'claude-code-mcp', path: '/opt/stacks/claude-code-mcp' },
  { id: 'gpt-researcher', path: '/opt/stacks/gpt-researcher' },
  { id: 'letta', path: '/opt/stacks/letta' },
];

// Max files per project for testing (to avoid overwhelming Graphiti)
const MAX_FILES_PER_PROJECT = 20;
const MAX_FUNCTIONS_PER_FILE = 10;

async function findSourceFiles(projectPath, extensions = ['.js', '.ts', '.py']) {
  const files = [];
  
  async function walk(dir) {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Skip common non-source directories
        if (entry.isDirectory()) {
          if (['node_modules', '.venv', 'venv', '.git', '__pycache__', 'dist', 'build', '.next'].includes(entry.name)) {
            continue;
          }
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (err) {
      // Ignore permission errors
    }
  }
  
  await walk(projectPath);
  return files;
}

async function testProject(project) {
  const { id, path: projectPath } = project;
  const groupId = `vibesync_${id}`;
  
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Project: ${id}`);
  console.log(`Path: ${projectPath}`);
  console.log(`Group ID: ${groupId}`);
  console.log(`${'─'.repeat(60)}`);
  
  const client = new GraphitiClient({
    baseUrl: GRAPHITI_URL,
    groupId,
    timeout: 30000,
    retries: 3,
  });
  
  const results = {
    project: id,
    status: 'success',
    filesFound: 0,
    filesParsed: 0,
    functionsFound: 0,
    entitiesCreated: 0,
    edgesCreated: 0,
    errors: [],
    timing: {},
  };
  
  try {
    // 1. Find source files
    const startFind = Date.now();
    const allFiles = await findSourceFiles(projectPath);
    const files = allFiles.slice(0, MAX_FILES_PER_PROJECT);
    results.filesFound = allFiles.length;
    results.timing.find = Date.now() - startFind;
    
    console.log(`  Found ${allFiles.length} source files, testing ${files.length}`);
    
    if (files.length === 0) {
      results.status = 'skipped';
      results.errors.push('No source files found');
      return results;
    }
    
    // 2. Parse files
    const startParse = Date.now();
    const parseResults = await parseFiles(files.slice(0, 10)); // Parse 10 at a time for performance
    const remainingFiles = files.slice(10);
    
    if (remainingFiles.length > 0) {
      const moreResults = await parseFiles(remainingFiles);
      parseResults.push(...moreResults);
    }
    
    results.timing.parse = Date.now() - startParse;
    
    const successful = parseResults.filter(r => !r.error);
    results.filesParsed = successful.length;
    results.functionsFound = successful.reduce((sum, r) => sum + r.functions.length, 0);
    
    console.log(`  Parsed ${successful.length}/${files.length} files`);
    console.log(`  Found ${results.functionsFound} functions`);
    
    if (successful.length === 0) {
      results.status = 'failed';
      results.errors.push('No files parsed successfully');
      return results;
    }
    
    // 3. Sync to Graphiti
    const startSync = Date.now();
    
    // Prepare files for sync
    const filesToSync = successful.map(r => ({
      filePath: path.relative(projectPath, r.file),
      functions: r.functions.slice(0, MAX_FUNCTIONS_PER_FILE),
    }));
    
    // Create file entities first
    for (const file of filesToSync) {
      try {
        await client.upsertEntity({
          name: `File:${file.filePath}`,
          summary: `Source file with ${file.functions.length} functions`,
        });
      } catch (err) {
        results.errors.push(`File entity error: ${file.filePath}: ${err.message}`);
      }
    }
    
    // Sync functions with edges
    const syncResult = await client.syncFilesWithFunctions({
      projectId: id,
      files: filesToSync,
      concurrency: 5,
      rateLimit: 100,
    });
    
    results.timing.sync = Date.now() - startSync;
    results.entitiesCreated = syncResult.entities;
    results.edgesCreated = syncResult.edges;
    
    if (syncResult.errors.length > 0) {
      results.errors.push(...syncResult.errors.slice(0, 5).map(e => `Sync: ${e}`));
    }
    
    console.log(`  Synced: ${syncResult.entities} entities, ${syncResult.edges} edges`);
    
    if (syncResult.entities === 0 && syncResult.edges === 0) {
      results.status = 'warning';
    }
    
  } catch (err) {
    results.status = 'failed';
    results.errors.push(`Fatal: ${err.message}`);
    console.error(`  Error: ${err.message}`);
  }
  
  return results;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('AST Integration Test - Stage 2 (5 Projects)');
  console.log('═'.repeat(60));
  console.log();
  console.log(`Graphiti URL: ${GRAPHITI_URL}`);
  console.log(`Projects: ${PROJECTS.map(p => p.id).join(', ')}`);
  console.log(`Max files per project: ${MAX_FILES_PER_PROJECT}`);
  
  // Health check
  const client = new GraphitiClient({
    baseUrl: GRAPHITI_URL,
    groupId: 'vibesync_test',
    timeout: 10000,
    retries: 1,
  });
  
  console.log();
  console.log('Health Check...');
  const healthy = await client.healthCheck();
  if (!healthy) {
    console.error('✗ Graphiti is not available');
    process.exit(1);
  }
  console.log('✓ Graphiti is healthy');
  
  // Test each project
  const results = [];
  for (const project of PROJECTS) {
    const result = await testProject(project);
    results.push(result);
  }
  
  // Summary
  console.log();
  console.log('═'.repeat(60));
  console.log('Stage 2 Summary');
  console.log('═'.repeat(60));
  console.log();
  
  console.log('┌' + '─'.repeat(20) + '┬' + '─'.repeat(8) + '┬' + '─'.repeat(8) + '┬' + '─'.repeat(10) + '┬' + '─'.repeat(10) + '┐');
  console.log('│ Project            │ Status │ Files  │ Entities │ Edges    │');
  console.log('├' + '─'.repeat(20) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(10) + '┤');
  
  let totalEntities = 0;
  let totalEdges = 0;
  let successCount = 0;
  
  for (const r of results) {
    const status = r.status === 'success' ? '✓' : r.status === 'warning' ? '⚠' : '✗';
    const statusPad = r.status.padEnd(6);
    const project = r.project.padEnd(18);
    const files = String(r.filesParsed).padStart(6);
    const entities = String(r.entitiesCreated).padStart(8);
    const edges = String(r.edgesCreated).padStart(8);
    
    console.log(`│ ${project} │ ${status} ${statusPad}│ ${files} │ ${entities} │ ${edges} │`);
    
    totalEntities += r.entitiesCreated;
    totalEdges += r.edgesCreated;
    if (r.status === 'success' || r.status === 'warning') successCount++;
  }
  
  console.log('└' + '─'.repeat(20) + '┴' + '─'.repeat(8) + '┴' + '─'.repeat(8) + '┴' + '─'.repeat(10) + '┴' + '─'.repeat(10) + '┘');
  console.log();
  
  console.log(`Total projects: ${results.length}`);
  console.log(`Successful: ${successCount}/${results.length}`);
  console.log(`Total entities: ${totalEntities}`);
  console.log(`Total edges: ${totalEdges}`);
  console.log();
  
  // Errors
  const errors = results.flatMap(r => r.errors);
  if (errors.length > 0) {
    console.log('Errors:');
    errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more`);
    }
    console.log();
  }
  
  // Final verdict
  if (successCount >= 4) {
    console.log('✓ Stage 2 PASSED - Ready for Stage 3 (full rollout)');
    process.exit(0);
  } else {
    console.log('✗ Stage 2 FAILED - Address errors before proceeding');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Stage 2 test failed:', err);
  process.exit(1);
});
