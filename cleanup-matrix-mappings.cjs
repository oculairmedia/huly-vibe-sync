#!/usr/bin/env node

require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');

const MAPPINGS_FILE = '/opt/stacks/matrix-synapse-deployment/matrix_client_data/agent_user_mappings.json';

async function cleanupMappings() {
  console.log('🧹 Matrix Client Mapping Cleanup\n');
  
  // 1. Get active agents from Letta using REST API
  console.log('[1/4] Fetching active agents from Letta...');
  
  const apiUrl = `${process.env.LETTA_BASE_URL}/v1/agents/?limit=500`;
  const response = await fetch(apiUrl, {
    headers: {
      'Authorization': `Bearer ${process.env.LETTA_PASSWORD}`
    }
  });
  
  if (!response.ok) {
    throw new Error(`Letta API error: ${response.status} ${response.statusText}`);
  }
  
  const agents = await response.json();
  const activeAgentIds = new Set(agents.map(a => a.id));
  console.log(`✓ Found ${activeAgentIds.size} active agents\n`);
  
  // 2. Read current mappings
  console.log('[2/4] Reading current mappings...');
  if (!fs.existsSync(MAPPINGS_FILE)) {
    console.error(`❌ Mappings file not found: ${MAPPINGS_FILE}`);
    process.exit(1);
  }
  
  const mappings = JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf8'));
  console.log(`✓ Found ${Object.keys(mappings).length} total mappings\n`);
  
  // 3. Filter out orphaned agents
  console.log('[3/4] Cleaning orphaned mappings...');
  const cleanedMappings = {};
  let removedCount = 0;
  let keptCount = 0;
  const orphaned = [];
  
  for (const [agentId, mapping] of Object.entries(mappings)) {
    if (activeAgentIds.has(agentId)) {
      cleanedMappings[agentId] = mapping;
      keptCount++;
    } else {
      orphaned.push(agentId);
      removedCount++;
    }
  }
  
  console.log(`Sample of orphaned agents (showing first 10 of ${orphaned.length}):`);
  orphaned.slice(0, 10).forEach(id => console.log(`  - ${id}`));
  if (orphaned.length > 10) {
    console.log(`  ... and ${orphaned.length - 10} more`);
  }
  
  console.log(`\n✓ Kept ${keptCount} active mappings`);
  console.log(`✓ Removed ${removedCount} orphaned mappings\n`);
  
  // 4. Backup and write cleaned mappings
  console.log('[4/4] Writing cleaned mappings...');
  
  // Backup original
  const backupFile = `${MAPPINGS_FILE}.backup-${Date.now()}`;
  fs.copyFileSync(MAPPINGS_FILE, backupFile);
  console.log(`✓ Backup created: ${backupFile}`);
  
  // Write cleaned mappings
  fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(cleanedMappings, null, 2));
  console.log(`✓ Cleaned mappings written: ${MAPPINGS_FILE}\n`);
  
  // Summary
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📊 Summary:`);
  console.log(`   Total before:     ${Object.keys(mappings).length}`);
  console.log(`   Active agents:    ${keptCount}`);
  console.log(`   Orphaned removed: ${removedCount}`);
  console.log(`   Reduction:        ${Math.round(removedCount / Object.keys(mappings).length * 100)}%`);
  console.log('═══════════════════════════════════════════════════════\n');
  
  console.log('✅ Cleanup complete! You can now restart the matrix client:');
  console.log('   docker start matrix-synapse-deployment-matrix-client-1\n');
}

cleanupMappings().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
