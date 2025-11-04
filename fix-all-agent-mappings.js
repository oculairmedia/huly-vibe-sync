#!/usr/bin/env node
/**
 * Fix ALL Agent Mappings - Main and Project-Specific
 * 
 * Updates both:
 * 1. Main .letta/settings.local.json
 * 2. Project-specific /opt/stacks/PROJECT/.letta/settings.local.json
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
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

async function fixAllMappings() {
  console.log('=== FIXING ALL AGENT MAPPINGS (Main + Project-Specific) ===\n');
  
  // Load main settings
  const mainSettingsPath = path.join(process.cwd(), '.letta', 'settings.local.json');
  const mainSettings = JSON.parse(fs.readFileSync(mainSettingsPath, 'utf-8'));
  
  // Get all agents
  const agents = await httpsGet('/v1/agents');
  const agentById = {};
  const agentByName = {};
  agents.forEach(a => {
    agentById[a.id] = a;
    agentByName[a.name] = a;
  });
  
  // Find all project-specific settings
  const { stdout } = await execAsync('find /opt/stacks -path "*/.letta/settings.local.json" 2>/dev/null');
  const projectSettingsFiles = stdout.trim().split('\n').filter(f => f);
  
  console.log(`Found ${projectSettingsFiles.length} project-specific settings files\n`);
  
  let mainFixed = 0;
  let projectFixed = 0;
  
  // Step 1: Fix main settings
  console.log('Step 1: Fixing main settings (.letta/settings.local.json)...\n');
  
  for (const [projectId, agentId] of Object.entries(mainSettings.agents || {})) {
    const agent = agentById[agentId];
    if (!agent) continue;
    
    if (agent.agent_type === 'sleeptime_agent') {
      const primaryAgentName = `Huly-${projectId}-PM`;
      const primaryAgent = agentByName[primaryAgentName];
      
      if (primaryAgent) {
        mainSettings.agents[projectId] = primaryAgent.id;
        console.log(`✓ ${projectId}: ${agent.name} -> ${primaryAgent.name}`);
        mainFixed++;
      }
    }
  }
  
  // Save main settings
  fs.writeFileSync(mainSettingsPath, JSON.stringify(mainSettings, null, 2));
  console.log(`\n✅ Updated main settings: ${mainFixed} projects fixed\n`);
  
  // Step 2: Fix project-specific settings
  console.log('Step 2: Fixing project-specific settings...\n');
  
  for (const projectFile of projectSettingsFiles) {
    try {
      const projectSettings = JSON.parse(fs.readFileSync(projectFile, 'utf-8'));
      const oldAgentId = projectSettings.lastAgent;
      
      if (!oldAgentId) continue;
      
      const agent = agentById[oldAgentId];
      if (!agent) continue;
      
      // Extract project ID from path
      const match = projectFile.match(/\/opt\/stacks\/([^\/]+)\//);
      if (!match) continue;
      
      const projectDir = match[1];
      
      if (agent.agent_type === 'sleeptime_agent') {
        // Try to find the project ID from agent name
        const projectIdMatch = agent.name.match(/Huly-(.+)-PM-sleeptime/);
        if (!projectIdMatch) continue;
        
        const projectId = projectIdMatch[1];
        const primaryAgentName = `Huly-${projectId}-PM`;
        const primaryAgent = agentByName[primaryAgentName];
        
        if (primaryAgent) {
          projectSettings.lastAgent = primaryAgent.id;
          fs.writeFileSync(projectFile, JSON.stringify(projectSettings, null, 2));
          console.log(`✓ ${projectDir} (${projectId}): ${agent.name} -> ${primaryAgent.name}`);
          projectFixed++;
        }
      }
    } catch (err) {
      console.log(`⚠️  Could not process ${projectFile}: ${err.message}`);
    }
  }
  
  console.log(`\n✅ Updated ${projectFixed} project-specific settings\n`);
  
  // Summary
  console.log('=== SUMMARY ===\n');
  console.log(`Main settings fixed: ${mainFixed}`);
  console.log(`Project settings fixed: ${projectFixed}`);
  console.log(`Total fixes: ${mainFixed + projectFixed}`);
  
  if (mainFixed > 0 || projectFixed > 0) {
    console.log('\n⚠️  IMPORTANT: Restart huly-vibe-sync for changes to take effect:');
    console.log('  docker restart huly-vibe-sync');
  }
}

// Run fix
fixAllMappings()
  .then(() => {
    console.log('\n✅ All mappings fixed!');
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
