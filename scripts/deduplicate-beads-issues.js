#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projectIndex = args.indexOf('--project');
const projectPath = projectIndex >= 0 ? args[projectIndex + 1] : process.cwd();

console.log(`\n=== Beads Deduplication Tool ===`);
console.log(`Project: ${projectPath}`);
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

const jsonlPath = path.join(projectPath, '.beads', 'issues.jsonl');
if (!fs.existsSync(jsonlPath)) {
  console.error('No .beads/issues.jsonl found');
  process.exit(1);
}

const issues = fs
  .readFileSync(jsonlPath, 'utf-8')
  .split('\n')
  .filter(line => line.trim())
  .map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

console.log(`Total issues: ${issues.length}`);

function normalizeTitle(title) {
  if (!title) return '';
  return title
    .trim()
    .toLowerCase()
    .replace(/^\[p[0-4]\]\s*/i, '')
    .replace(/^\[perf[^\]]*\]\s*/i, '')
    .replace(/^\[tier\s*\d+\]\s*/i, '')
    .replace(/^\[action\]\s*/i, '')
    .replace(/^\[bug\]\s*/i, '')
    .replace(/^\[fixed\]\s*/i, '')
    .replace(/^\[epic\]\s*/i, '')
    .replace(/^\[wip\]\s*/i, '')
    .trim();
}

const byTitle = new Map();
for (const issue of issues) {
  const normalizedTitle = normalizeTitle(issue.title);
  if (!byTitle.has(normalizedTitle)) {
    byTitle.set(normalizedTitle, []);
  }
  byTitle.get(normalizedTitle).push(issue);
}

let duplicateCount = 0;
const toClose = [];

for (const [title, group] of byTitle.entries()) {
  if (group.length > 1) {
    group.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const keeper = group[0];
    const duplicates = group.slice(1);

    if (duplicates.length <= 5) {
      console.log(`\n"${title.substring(0, 50)}..." (${group.length} copies)`);
      console.log(`  KEEP: ${keeper.id} (${keeper.created_at})`);
      for (const dup of duplicates) {
        console.log(`  CLOSE: ${dup.id} (${dup.created_at})`);
      }
    }

    for (const dup of duplicates) {
      toClose.push(dup);
      duplicateCount++;
    }
  }
}

console.log(`\n=== Summary ===`);
console.log(`Unique titles: ${byTitle.size}`);
console.log(`Duplicates to close: ${duplicateCount}`);

if (toClose.length === 0) {
  console.log('\nNo duplicates found!');
  process.exit(0);
}

if (dryRun) {
  console.log('\nDRY RUN - No changes made');
  console.log('Run without --dry-run to close duplicates');
  process.exit(0);
}

console.log('\nClosing duplicates...');
let closed = 0;
let errors = 0;

for (const issue of toClose) {
  try {
    execSync(`bd close ${issue.id} --reason "Duplicate" --no-daemon`, {
      cwd: projectPath,
      stdio: 'pipe',
      timeout: 10000,
    });
    closed++;
    if (closed % 50 === 0) {
      console.log(`  Closed ${closed}/${toClose.length}...`);
    }
  } catch (e) {
    errors++;
  }
}

console.log(`\nDone: ${closed} closed, ${errors} errors`);
