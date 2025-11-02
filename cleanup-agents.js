#!/usr/bin/env node

/**
 * Cleanup Script for Letta PM Agents
 * 
 * - Lists all Huly PM agents
 * - Identifies duplicates by name
 * - Optionally deletes duplicates
 */

import 'dotenv/config';
import { LettaClient } from '@letta-ai/letta-client';

const client = new LettaClient({
  baseUrl: process.env.LETTA_BASE_URL,
  token: process.env.LETTA_PASSWORD,
});

async function listAllAgents() {
  console.log('Fetching all agents from Letta...\n');
  
  let allAgents = [];
  let offset = 0;
  const limit = 100;
  
  while (true) {
    const agents = await client.agents.list({ limit, offset });
    if (!agents || agents.length === 0) break;
    allAgents = allAgents.concat(agents);
    offset += limit;
    if (agents.length < limit) break;
  }
  
  console.log(`Total agents: ${allAgents.length}\n`);
  return allAgents;
}

async function analyzeAgents() {
  const allAgents = await listAllAgents();
  
  // Filter Huly PM agents (start with "Huly-" and end with "-PM")
  const hulyAgents = allAgents.filter(agent => 
    agent.name && agent.name.startsWith('Huly-') && agent.name.endsWith('-PM')
  );
  
  console.log(`Huly PM agents: ${hulyAgents.length}\n`);
  
  // Group by name to find duplicates
  const agentsByName = {};
  
  for (const agent of hulyAgents) {
    if (!agentsByName[agent.name]) {
      agentsByName[agent.name] = [];
    }
    agentsByName[agent.name].push(agent);
  }
  
  // Find duplicates
  const duplicates = [];
  const unique = [];
  
  for (const [name, agents] of Object.entries(agentsByName)) {
    if (agents.length > 1) {
      duplicates.push({ name, agents });
      console.log(`❌ DUPLICATE: ${name} (${agents.length} copies)`);
      agents.forEach((agent, idx) => {
        console.log(`   ${idx + 1}. ${agent.id} (created: ${agent.created_at || 'unknown'})`);
      });
      console.log();
    } else {
      unique.push(agents[0]);
    }
  }
  
  console.log('\n=== SUMMARY ===');
  console.log(`Unique agents: ${unique.length}`);
  console.log(`Duplicate agent names: ${duplicates.length}`);
  console.log(`Total duplicate copies: ${duplicates.reduce((sum, d) => sum + d.agents.length - 1, 0)}`);
  console.log();
  
  return { duplicates, unique, agentsByName };
}

async function deleteDuplicates(duplicates, dryRun = true) {
  console.log('\n=== DELETING DUPLICATES ===\n');
  
  let deleteCount = 0;
  
  for (const { name, agents } of duplicates) {
    // Sort by creation date (keep oldest)
    const sorted = agents.sort((a, b) => {
      const dateA = new Date(a.created_at || 0);
      const dateB = new Date(b.created_at || 0);
      return dateA - dateB;
    });
    
    const keepAgent = sorted[0];
    const deleteAgents = sorted.slice(1);
    
    console.log(`${name}:`);
    console.log(`  ✓ KEEP: ${keepAgent.id} (oldest, created: ${keepAgent.created_at})`);
    
    for (const agent of deleteAgents) {
      if (dryRun) {
        console.log(`  🗑️  WOULD DELETE: ${agent.id} (created: ${agent.created_at})`);
      } else {
        try {
          await client.agents.delete(agent.id);
          console.log(`  ✅ DELETED: ${agent.id}`);
          deleteCount++;
        } catch (error) {
          console.log(`  ❌ ERROR deleting ${agent.id}: ${error.message}`);
        }
      }
    }
    console.log();
  }
  
  if (dryRun) {
    console.log(`\n[DRY RUN] Would delete ${duplicates.reduce((sum, d) => sum + d.agents.length - 1, 0)} duplicate agents`);
    console.log('Run with --delete flag to actually delete them\n');
  } else {
    console.log(`\n✅ Deleted ${deleteCount} duplicate agents\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldDelete = args.includes('--delete');
  const listOnly = args.includes('--list');
  
  try {
    const { duplicates, unique, agentsByName } = await analyzeAgents();
    
    if (listOnly) {
      console.log('\n=== ALL HULY PM AGENTS ===\n');
      for (const [name, agents] of Object.entries(agentsByName)) {
        agents.forEach(agent => {
          console.log(`${name} → ${agent.id}`);
        });
      }
      return;
    }
    
    if (duplicates.length === 0) {
      console.log('✅ No duplicates found! All agents are unique.');
      return;
    }
    
    await deleteDuplicates(duplicates, !shouldDelete);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
