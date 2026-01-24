#!/usr/bin/env node
/**
 * Cleanup duplicate Huly issues
 * Keeps the oldest (lowest identifier number) and deletes newer duplicates
 */

const { createHulyClient } = require('../temporal/dist/lib/HulyClient');

const DRY_RUN = process.argv.includes('--dry-run');
const PROJECT = process.argv[2] || 'HVSYN';

async function main() {
  console.log(`Cleaning up duplicates in ${PROJECT}${DRY_RUN ? ' (DRY RUN)' : ''}\n`);
  
  const client = createHulyClient(process.env.HULY_API_URL);
  const issues = await client.listIssues(PROJECT, { limit: 1000 });
  
  console.log(`Found ${issues.length} total issues\n`);
  
  // Group by title
  const byTitle = {};
  issues.forEach(i => {
    if (!byTitle[i.title]) byTitle[i.title] = [];
    byTitle[i.title].push(i);
  });
  
  // Find duplicates
  const duplicates = Object.entries(byTitle).filter(([_, v]) => v.length > 1);
  console.log(`Found ${duplicates.length} titles with duplicates\n`);
  
  let deleted = 0;
  let errors = 0;
  
  for (const [title, dupes] of duplicates) {
    // Sort by identifier number (HVSYN-123 -> 123)
    dupes.sort((a, b) => {
      const numA = parseInt(a.identifier.split('-')[1]);
      const numB = parseInt(b.identifier.split('-')[1]);
      return numA - numB;
    });
    
    const keep = dupes[0];
    const toDelete = dupes.slice(1);
    
    console.log(`"${title.substring(0, 60)}..."`);
    console.log(`  Keep: ${keep.identifier}`);
    console.log(`  Delete: ${toDelete.map(d => d.identifier).join(', ')}`);
    
    for (const issue of toDelete) {
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would delete ${issue.identifier}`);
        deleted++;
      } else {
        try {
          await client.deleteIssue(issue.identifier);
          console.log(`  Deleted ${issue.identifier}`);
          deleted++;
          // Small delay to avoid rate limiting
          await new Promise(r => setTimeout(r, 100));
        } catch (err) {
          console.log(`  ERROR deleting ${issue.identifier}: ${err.message}`);
          errors++;
        }
      }
    }
    console.log('');
  }
  
  console.log(`\nSummary:`);
  console.log(`  Deleted: ${deleted}`);
  console.log(`  Errors: ${errors}`);
}

main().catch(console.error);
