#!/usr/bin/env node
/**
 * Quick Cleanup of Duplicate Agents
 * Removes all but the most recent agent for each duplicate group
 */

import 'dotenv/config';

const LETTA_API_URL = process.env.LETTA_BASE_URL + '/v1';
const LETTA_PASSWORD = process.env.LETTA_PASSWORD;

async function fetchAgents() {
  const response = await fetch(`${LETTA_API_URL}/agents/?limit=100`, {
    headers: { 'Authorization': `Bearer ${LETTA_PASSWORD}` }
  });
  return await response.json();
}

async function deleteAgent(agentId) {
  const response = await fetch(`${LETTA_API_URL}/agents/${agentId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${LETTA_PASSWORD}` }
  });
  return response.ok;
}

async function main() {
  console.log('Fetching all agents...');
  const agents = await fetchAgents();
  
  // Group by name
  const groups = {};
  for (const agent of agents) {
    if (!groups[agent.name]) {
      groups[agent.name] = [];
    }
    groups[agent.name].push(agent);
  }
  
  // Find duplicates
  let totalDeleted = 0;
  for (const [name, agentList] of Object.entries(groups)) {
    if (agentList.length > 1) {
      console.log(`\n${name}: ${agentList.length} copies found`);
      
      // Sort by creation date (keep newest)
      const sorted = agentList.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
      
      const keep = sorted[0];
      const toDelete = sorted.slice(1);
      
      console.log(`  Keeping: ${keep.id} (${keep.created_at})`);
      
      for (const agent of toDelete) {
        console.log(`  Deleting: ${agent.id} (${agent.created_at})`);
        const success = await deleteAgent(agent.id);
        if (success) {
          console.log(`    ✓ Deleted`);
          totalDeleted++;
        } else {
          console.log(`    ✗ Failed to delete`);
        }
        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total agents deleted: ${totalDeleted}`);
  console.log(`${'='.repeat(60)}`);
}

main().catch(console.error);
