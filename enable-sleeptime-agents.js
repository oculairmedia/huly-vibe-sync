#!/usr/bin/env node

/**
 * Enable sleep-time agents for all Huly PM agents
 * 
 * Sleep-time agents run in the background and:
 * - Process conversation history asynchronously
 * - Generate learned context from interactions
 * - Update memory blocks with insights
 * - Triggered every N steps (default: 5)
 * 
 * More info: https://docs.letta.com/agents/sleep-time-agents
 */

import { createLettaService } from './lib/LettaService.js';
import { fetchWithPool } from './lib/http.js';
import dotenv from 'dotenv';

dotenv.config();

const lettaService = createLettaService();

async function enableSleeptime(agentId, agentName, frequency = 5) {
  try {
    console.log(`  Enabling sleep-time for ${agentName}...`);
    
    // Get current agent to check if already enabled
    const agent = await lettaService.getAgent(agentId);
    
    if (agent.multiAgentGroup) {
      console.log(`  ⏭️  Sleep-time already enabled (group: ${agent.multiAgentGroup.id})`);
      
      // Check current frequency
      if (agent.multiAgentGroup.sleeptimeAgentFrequency !== frequency) {
        console.log(`  📝 Updating frequency: ${agent.multiAgentGroup.sleeptimeAgentFrequency} → ${frequency}`);
        
        // Update frequency using REST API
        const response = await fetchWithPool(
          `${lettaService.baseURL}/v1/groups/${agent.multiAgentGroup.id}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${lettaService.password}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              manager_config: {
                sleeptime_agent_frequency: frequency
              }
            })
          }
        );
        
        if (!response.ok) {
          throw new Error(`Failed to update frequency: ${response.status}`);
        }
        
        console.log(`  ✅ Frequency updated to ${frequency}`);
      }
      
      return { status: 'already_enabled', groupId: agent.multiAgentGroup.id };
    }
    
    // Enable sleep-time by updating agent
    // Note: This requires recreating the agent with enableSleeptime: true
    // For now, we'll document that new agents should be created with this flag
    console.log(`  ⚠️  Sleep-time not enabled - requires agent recreation`);
    return { status: 'requires_recreation' };
    
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    return { status: 'error', error: error.message };
  }
}

async function main() {
  console.log('\n💤 ENABLING SLEEP-TIME AGENTS FOR HULY PM AGENTS\n');
  console.log('Sleep-time agents will:');
  console.log('  - Process conversation history in the background');
  console.log('  - Generate learned context from interactions');
  console.log('  - Update memory blocks with insights');
  console.log('  - Trigger every 5 steps by default\n');
  
  const FREQUENCY = parseInt(process.env.SLEEPTIME_FREQUENCY || '5');
  console.log(`Using frequency: ${FREQUENCY} steps\n`);
  
  try {
    const agents = await lettaService.listAgents();
    const hulyAgents = agents.filter(a => a.name.startsWith('Huly-'));
    
    console.log(`Found ${hulyAgents.length} Huly agents\n`);
    
    let alreadyEnabled = 0;
    let requiresRecreation = 0;
    let updated = 0;
    let errors = 0;
    
    for (const agent of hulyAgents) {
      const result = await enableSleeptime(agent.id, agent.name, FREQUENCY);
      
      switch (result.status) {
        case 'already_enabled':
          alreadyEnabled++;
          break;
        case 'requires_recreation':
          requiresRecreation++;
          break;
        case 'updated':
          updated++;
          break;
        case 'error':
          errors++;
          break;
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Already enabled: ${alreadyEnabled}`);
    console.log(`📝 Updated frequency: ${updated}`);
    console.log(`⚠️  Requires recreation: ${requiresRecreation}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total: ${hulyAgents.length}\n`);
    
    if (requiresRecreation > 0) {
      console.log('⚠️  NOTE: Some agents need to be recreated with enableSleeptime: true');
      console.log('This has been added to the agent creation flow in ensureAgent().');
      console.log('New agents will automatically have sleep-time enabled.\n');
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
