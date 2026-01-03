#!/usr/bin/env node

/**
 * Cleanup Huly Agents
 *
 * Deletes all Huly PM agents (agents starting with "Huly-") from Letta
 * to allow fresh recreation with correct primary agents.
 */

import https from 'https';
import http from 'http';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const LETTA_BASE_URL = process.env.LETTA_BASE_URL || 'http://192.168.50.90:8289';
const LETTA_PASSWORD = process.env.LETTA_PASSWORD || 'lettaSecurePass123';

// Parse URL
const url = new URL(LETTA_BASE_URL);
const isHttps = url.protocol === 'https:';
const httpModule = isHttps ? https : http;

/**
 * Make HTTP request
 */
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `/v1${path}`,
      method: method,
      headers: {
        'Authorization': `Bearer ${LETTA_PASSWORD}`,
        'Content-Type': 'application/json',
      },
    };

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * List all agents
 */
async function listAgents() {
  const agents = await makeRequest('GET', '/agents');
  return agents;
}

/**
 * Delete an agent
 */
async function deleteAgent(agentId) {
  await makeRequest('DELETE', `/agents/${agentId}`);
}

/**
 * Main cleanup function
 */
async function cleanup() {
  console.log('🧹 Cleaning up Huly agents from Letta...\n');

  try {
    // List all agents
    console.log('📋 Fetching agent list...');
    const allAgents = await listAgents();
    console.log(`✓ Found ${allAgents.length} total agents\n`);

    // Filter Huly agents (those starting with "Huly-")
    const hulyAgents = allAgents.filter(agent =>
      agent.name && agent.name.startsWith('Huly-'),
    );

    console.log(`🎯 Found ${hulyAgents.length} Huly agents to delete\n`);

    if (hulyAgents.length === 0) {
      console.log('✅ No Huly agents to delete');
      return;
    }

    // Show what will be deleted
    console.log('Agents to delete:');
    hulyAgents.forEach((agent, idx) => {
      const type = agent.name.endsWith('-sleeptime') ? '(sleeptime)' : '(primary)';
      console.log(`  ${idx + 1}. ${agent.name} - ${agent.id} ${type}`);
    });
    console.log();

    // Delete agents
    console.log('🗑️  Deleting agents...');
    let deleted = 0;
    let errors = 0;

    for (const agent of hulyAgents) {
      try {
        await deleteAgent(agent.id);
        deleted++;
        process.stdout.write(`\r  ✓ Deleted ${deleted}/${hulyAgents.length} agents`);
      } catch (error) {
        errors++;
        console.error(`\n  ✗ Failed to delete ${agent.name} (${agent.id}): ${error.message}`);
      }
    }

    console.log('\n');
    console.log('='.repeat(60));
    console.log(`✅ Cleanup complete!`);
    console.log(`   Deleted: ${deleted} agents`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Remaining non-Huly agents: ${allAgents.length - deleted}`);
    console.log('='.repeat(60));
    console.log();
    console.log('ℹ️  Next steps:');
    console.log('   1. Clear the database: rm logs/sync-state.db');
    console.log('   2. Clear agent mappings: echo \'{"version":"1.0.0","agents":{}}\' > .letta/settings.local.json');
    console.log('   3. Start sync: docker-compose up -d');
    console.log('   4. Service will automatically create fresh agents for all projects');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run cleanup
cleanup();
