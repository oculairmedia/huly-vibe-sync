#!/usr/bin/env node
/**
 * Fix Agent Mappings - Ensure One Agent Per Project
 * 
 * This script:
 * 1. Audits .letta/settings.local.json for agent reuse
 * 2. Creates new dedicated agents for projects that are sharing agents
 * 3. Updates the settings file with correct one-to-one mappings
 */

import { LettaService } from './lib/LettaService.js';
import fs from 'fs';
import path from 'path';

const LETTA_API_URL = process.env.LETTA_API_URL || 'https://letta.oculair.ca/v1';
const LETTA_PASSWORD = process.env.LETTA_PASSWORD || 'lettaSecurePass123';

async function main() {
  console.log('=== FIXING AGENT MAPPINGS ===\n');
  
  const lettaService = new LettaService(LETTA_API_URL, LETTA_PASSWORD);
  const settingsPath = path.join(process.cwd(), '.letta', 'settings.local.json');
  
  // Load current settings
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  const agents = settings.agents || {};
  
  // Find agent reuse (multiple projects pointing to same agent)
  const agentUsage = {}; // agentId -> [projectIds]
  
  Object.entries(agents).forEach(([projectId, agentId]) => {
    if (!agentUsage[agentId]) {
      agentUsage[agentId] = [];
    }
    agentUsage[agentId].push(projectId);
  });
  
  // Find reused agents
  const reusedAgents = Object.entries(agentUsage).filter(([agentId, projects]) => projects.length > 1);
  
  if (reusedAgents.length === 0) {
    console.log('✓ No agent reuse detected. All projects have dedicated agents.');
    return;
  }
  
  console.log(`Found ${reusedAgents.length} agents being reused:\n`);
  reusedAgents.forEach(([agentId, projects]) => {
    console.log(`  ${agentId.substring(0, 8)}... used by: ${projects.join(', ')}`);
  });
  
  console.log('\n--- Creating Dedicated Agents ---\n');
  
  // For each reused agent, keep the first project and create new agents for the rest
  for (const [agentId, projects] of reusedAgents) {
    const keepProject = projects[0];
    const needNewAgents = projects.slice(1);
    
    console.log(`\nAgent ${agentId.substring(0, 8)}...:`);
    console.log(`  ✓ Keep for ${keepProject}`);
    
    for (const projectId of needNewAgents) {
      console.log(`  → Creating new agent for ${projectId}...`);
      
      try {
        // Create new agent (ensureAgent will create if doesn't exist)
        const newAgent = await lettaService.ensureAgent(projectId, projectId);
        
        // Update settings with new agent ID
        agents[projectId] = newAgent.id;
        
        console.log(`     ✓ Created ${newAgent.id.substring(0, 8)}...`);
      } catch (error) {
        console.error(`     ✗ Failed to create agent for ${projectId}: ${error.message}`);
      }
    }
  }
  
  // Save updated settings
  settings.agents = agents;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  
  console.log('\n--- Verification ---\n');
  
  // Verify no duplicates remain
  const newAgentUsage = {};
  Object.entries(agents).forEach(([projectId, agentId]) => {
    if (!newAgentUsage[agentId]) {
      newAgentUsage[agentId] = [];
    }
    newAgentUsage[agentId].push(projectId);
  });
  
  const stillReused = Object.entries(newAgentUsage).filter(([agentId, projects]) => projects.length > 1);
  
  if (stillReused.length === 0) {
    console.log('✓ All projects now have dedicated agents!');
    console.log(`✓ Updated ${settingsPath}`);
  } else {
    console.error('✗ Some agent reuse still detected:');
    stillReused.forEach(([agentId, projects]) => {
      console.error(`  ${agentId}: ${projects.join(', ')}`);
    });
  }
  
  console.log('\n=== FIX COMPLETE ===');
}

main().catch(console.error);
