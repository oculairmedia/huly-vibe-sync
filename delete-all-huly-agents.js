#!/usr/bin/env node
/**
 * Delete ALL Huly agents
 */

import 'dotenv/config';

// Use direct connection (proxy has issues with DELETE)
const LETTA_API_URL = 'http://192.168.50.90:8283/v1';
const LETTA_PASSWORD = process.env.LETTA_PASSWORD;

async function fetchAgents() {
  const response = await fetch(`${LETTA_API_URL}/agents/?limit=100`, {
    headers: { 'Authorization': `Bearer ${LETTA_PASSWORD}` }
  });
  return await response.json();
}

async function deleteAgent(agentId) {
  try {
    const response = await fetch(`${LETTA_API_URL}/agents/${agentId}`, {
      method: 'DELETE',
      headers: { 
        'Authorization': `Bearer ${LETTA_PASSWORD}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.log(`    Response: ${response.status} ${text}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('Fetching all agents...');
  const agents = await fetchAgents();
  
  // Filter Huly agents (both old "Huly-" and new "Huly " or "Huly:" formats)
  const hulyAgents = agents.filter(a => a.name && (a.name.startsWith('Huly-') || a.name.startsWith('Huly ') || a.name.startsWith('Huly:')));
  
  console.log(`Found ${hulyAgents.length} Huly agents to delete\n`);
  
  let deleted = 0;
  for (const agent of hulyAgents) {
    console.log(`Deleting: ${agent.name} (${agent.id})`);
    const success = await deleteAgent(agent.id);
    if (success) {
      deleted++;
      console.log(`  ✓ Deleted`);
    } else {
      console.log(`  ✗ Failed`);
    }
    // Small delay
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total agents deleted: ${deleted} / ${hulyAgents.length}`);
  console.log(`${'='.repeat(60)}`);
}

main().catch(console.error);
