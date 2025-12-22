#!/usr/bin/env node
/**
 * One-time migration script to update all existing AGENTS.md files
 * with Huly project info headers
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LettaService } from './lib/LettaService.js';
import { determineGitRepoPath } from './lib/textParsers.js';
import { HulyRestClient } from './lib/HulyRestClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  console.log('=== AGENTS.md Migration Script ===\n');

  // Initialize services
  const lettaService = new LettaService(
    process.env.LETTA_API_URL || 'http://192.168.50.90:8283',
    process.env.LETTA_PASSWORD || 'password'
  );

  const hulyClient = new HulyRestClient(
    process.env.HULY_API_URL || 'http://192.168.50.90:3458'
  );

  // Fetch all Huly projects
  console.log('Fetching Huly projects...');
  const hulyProjects = await hulyClient.listProjects();
  console.log(`Found ${hulyProjects.length} Huly projects\n`);

  // Get the agent state from LettaService
  const agentState = lettaService._agentState?.agents || {};
  console.log(`Found ${Object.keys(agentState).length} projects with Letta agents\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const hulyProject of hulyProjects) {
    const projectIdentifier = hulyProject.identifier;
    const projectName = hulyProject.name;

    // Get the project path
    const projectPath = determineGitRepoPath(hulyProject);
    if (!projectPath || !fs.existsSync(projectPath)) {
      console.log(`⏭️  ${projectIdentifier}: No valid path (${projectPath || 'none'})`);
      skipped++;
      continue;
    }

    // Get the Letta agent ID from LettaService state
    const agentId = agentState[projectIdentifier];
    if (!agentId) {
      console.log(`⏭️  ${projectIdentifier}: No Letta agent assigned`);
      skipped++;
      continue;
    }

    try {
      // Update AGENTS.md
      lettaService.updateAgentsMdWithProjectInfo(projectPath, agentId, {
        identifier: projectIdentifier,
        name: projectName,
      });
      console.log(`✅ ${projectIdentifier}: Updated AGENTS.md at ${projectPath}`);
      updated++;
    } catch (error) {
      console.error(`❌ ${projectIdentifier}: ${error.message}`);
      errors++;
    }
  }

  console.log('\n=== Migration Complete ===');
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors:  ${errors}`);
}

main().catch(console.error);
