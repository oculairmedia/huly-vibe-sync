#!/usr/bin/env node
/**
 * Fix Agent Types - Switch Projects to Primary Agents
 * 
 * Updates all project mappings to use primary agents instead of sleeptime agents.
 * Sleeptime agents should only be used by Letta internally for background processing.
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const LETTA_API = 'letta.oculair.ca';
const LETTA_PASSWORD = process.env.LETTA_PASSWORD || 'lettaSecurePass123';

function httpsGet(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: LETTA_API,
      path: path,
      headers: { 'Authorization': `Bearer ${LETTA_PASSWORD}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function fixAgentTypes() {
  console.log('=== FIXING AGENT TYPE MAPPINGS ===\n');
  
  // Load settings
  const settingsPath = path.join(process.cwd(), '.letta', 'settings.local.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  
  // Get all agents
  const agents = await httpsGet('/v1/agents');
  
  // Create agent lookup
  const agentById = {};
  const agentByName = {};
  agents.forEach(a => {
    agentById[a.id] = a;
    agentByName[a.name] = a;
  });
  
  const fixes = [];
  let fixed = 0;
  let alreadyCorrect = 0;
  let errors = 0;
  
  console.log('Checking and fixing project mappings...\n');
  
  for (const [projectId, agentId] of Object.entries(settings.agents || {})) {
    const agent = agentById[agentId];
    
    if (!agent) {
      console.log(`⚠️  ${projectId}: Agent ${agentId} not found, skipping`);
      errors++;
      continue;
    }
    
    const isSleeptime = agent.agent_type === 'sleeptime_agent';
    
    if (!isSleeptime) {
      alreadyCorrect++;
      continue; // Already using primary agent
    }
    
    // Find the primary agent
    const primaryAgentName = `Huly-${projectId}-PM`;
    const primaryAgent = agentByName[primaryAgentName];
    
    if (!primaryAgent) {
      console.log(`❌ ${projectId}: Primary agent not found (${primaryAgentName})`);
      errors++;
      continue;
    }
    
    // Update mapping
    settings.agents[projectId] = primaryAgent.id;
    fixes.push({
      projectId,
      oldAgent: {
        id: agentId,
        name: agent.name,
        type: 'sleeptime'
      },
      newAgent: {
        id: primaryAgent.id,
        name: primaryAgent.name,
        type: 'primary'
      }
    });
    
    console.log(`✓ ${projectId}:`);
    console.log(`  Was: ${agent.name} (${agentId.substring(0, 8)}...)`);
    console.log(`  Now: ${primaryAgent.name} (${primaryAgent.id.substring(0, 8)}...)`);
    fixed++;
  }
  
  // Save updated settings
  if (fixes.length > 0) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`\n✅ Updated ${settingsPath}`);
  }
  
  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`Total projects: ${Object.keys(settings.agents).length}`);
  console.log(`✅ Already correct: ${alreadyCorrect}`);
  console.log(`🔧 Fixed: ${fixed}`);
  console.log(`❌ Errors: ${errors}`);
  
  if (fixed > 0) {
    console.log('\n⚠️  IMPORTANT: Restart huly-vibe-sync for changes to take effect:');
    console.log('  docker restart huly-vibe-sync');
  }
  
  return { fixed, errors };
}

// Run fix
fixAgentTypes()
  .then(({ fixed, errors }) => {
    if (errors > 0) {
      console.log('\n⚠️  Some projects could not be fixed. Check logs above.');
      process.exit(1);
    }
    if (fixed > 0) {
      console.log('\n✅ All fixable projects updated successfully!');
    } else {
      console.log('\n✅ No fixes needed - all projects already correct!');
    }
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
