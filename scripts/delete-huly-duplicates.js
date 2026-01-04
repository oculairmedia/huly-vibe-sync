#!/usr/bin/env node

import { createHulyRestClient } from '../lib/HulyRestClient.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projectIndex = args.indexOf('--project');
const projectId = projectIndex >= 0 ? args[projectIndex + 1] : null;
const batchSizeArg = args.indexOf('--batch-size');
const batchSize = batchSizeArg >= 0 ? parseInt(args[batchSizeArg + 1], 10) : 50;

if (!projectId) {
  console.error(
    'Usage: node delete-huly-duplicates.js --project <PROJECT_ID> [--dry-run] [--batch-size N]'
  );
  process.exit(1);
}

const API_URL = process.env.HULY_API_URL || 'http://192.168.50.90:3458';
const client = createHulyRestClient(API_URL, { timeout: 180000 });

console.log(`\n=== Huly Duplicate Deletion Tool ===`);
console.log(`Project: ${projectId}`);
console.log(`API URL: ${API_URL}`);
console.log(`Batch Size: ${batchSize}`);
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE DELETE'}\n`);

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

function extractIssueNumber(identifier) {
  const match = identifier.match(/-(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

async function fetchAllIssues(projectId) {
  console.log(`Fetching issues for ${projectId}...`);

  try {
    const issues = await client.listIssues(projectId, { limit: 10000 });
    console.log(`Fetched ${issues.length} issues`);
    return issues;
  } catch (e) {
    console.error(`Failed to fetch issues: ${e.message}`);
    return [];
  }
}

async function deleteIssuesBulk(identifiers) {
  if (identifiers.length === 0) return { succeeded: 0, failed: 0 };

  try {
    const result = await client.deleteIssuesBulk(identifiers, { cascade: true });
    return result;
  } catch (e) {
    console.error(`Bulk delete failed: ${e.message}`);
    return { succeeded: 0, failed: identifiers.length, error: e.message };
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const issues = await fetchAllIssues(projectId);

  if (issues.length === 0) {
    console.log('No issues found or failed to fetch');
    process.exit(1);
  }

  // Group by normalized title
  const byTitle = new Map();
  for (const issue of issues) {
    const normalizedTitle = normalizeTitle(issue.title);
    if (!byTitle.has(normalizedTitle)) {
      byTitle.set(normalizedTitle, []);
    }
    byTitle.get(normalizedTitle).push(issue);
  }

  // Find duplicates
  const toDelete = [];
  let duplicateGroups = 0;

  for (const [title, group] of byTitle.entries()) {
    if (group.length > 1) {
      duplicateGroups++;

      // Sort by issue number (keep lowest)
      group.sort((a, b) => extractIssueNumber(a.identifier) - extractIssueNumber(b.identifier));

      const keeper = group[0];
      const duplicates = group.slice(1);

      if (duplicateGroups <= 10) {
        console.log(`\n"${title.substring(0, 50)}..." (${group.length} copies)`);
        console.log(`  KEEP: ${keeper.identifier}`);
        for (const dup of duplicates.slice(0, 3)) {
          console.log(`  DELETE: ${dup.identifier}`);
        }
        if (duplicates.length > 3) {
          console.log(`  ... and ${duplicates.length - 3} more`);
        }
      }

      toDelete.push(...duplicates.map(d => d.identifier));
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total issues: ${issues.length}`);
  console.log(`Unique titles: ${byTitle.size}`);
  console.log(`Duplicate groups: ${duplicateGroups}`);
  console.log(`Issues to delete: ${toDelete.length}`);

  if (toDelete.length === 0) {
    console.log('\nNo duplicates found!');
    process.exit(0);
  }

  if (dryRun) {
    console.log('\nDRY RUN - No changes made');
    console.log('Run without --dry-run to delete duplicates');

    // Output the list of issues to delete
    console.log('\nIssues that would be deleted:');
    console.log(toDelete.slice(0, 20).join('\n'));
    if (toDelete.length > 20) {
      console.log(`... and ${toDelete.length - 20} more`);
    }
    process.exit(0);
  }

  console.log('\nDeleting duplicates...');
  let totalDeleted = 0;
  let totalErrors = 0;

  // Delete in batches
  for (let i = 0; i < toDelete.length; i += batchSize) {
    const batch = toDelete.slice(i, i + batchSize);
    console.log(
      `  Deleting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(toDelete.length / batchSize)} (${batch.length} issues)...`
    );

    const result = await deleteIssuesBulk(batch);
    totalDeleted += result.succeeded || 0;
    totalErrors += result.failed || 0;

    // Rate limiting - wait between batches
    if (i + batchSize < toDelete.length) {
      await sleep(500);
    }
  }

  console.log(`\nDone: ${totalDeleted} deleted, ${totalErrors} errors`);
  console.log(`Remaining issues: ${issues.length - totalDeleted}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
