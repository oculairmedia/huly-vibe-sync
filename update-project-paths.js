#!/usr/bin/env node

/**
 * Update Huly Project Descriptions with Filesystem Paths
 *
 * Automatically adds filesystem paths to project descriptions
 */

import 'dotenv/config';
import fetch from 'node-fetch';

// Ensure we have /api suffix
const baseUrl = process.env.HULY_API_URL || process.env.HULY_MCP_URL || 'http://192.168.50.90:3458';
const HULY_API_URL = baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;

// Projects that need path updates
const UPDATES = [
  {
    identifier: 'LETTA',
    name: 'Letta OpenCode Plugin',
    path: '/opt/stacks/letta-opencode-plugin',
  },
  {
    identifier: 'HULLY',
    name: 'Huly MCP Server',
    path: '/opt/stacks/huly-selfhost/huly-mcp-server',
  },
  {
    identifier: 'LMS',
    name: 'Letta MCP Server',
    path: '/opt/stacks/letta-MCP-server',
  },
  {
    identifier: 'TSK',
    name: 'Default',
    path: '/opt/stacks/vibe-kanban',
  },
  {
    identifier: 'BKMCP',
    name: 'BookStack MCP',
    path: '/opt/stacks/bookstack-mcp',
  },
  {
    identifier: 'SFMCP',
    name: 'SureFinance MCP Server',
    path: '/opt/stacks/surefinance-mcp-server',
  },
  {
    identifier: 'OPCDE',
    name: 'OpenCode Project',
    path: '/opt/stacks/opencode',
  },
  {
    identifier: 'GRAPH',
    name: 'Graphiti Knowledge Graph Platform',
    path: '/opt/stacks/graphiti',
  },
];

async function updateProjectDescription(identifier, name, path) {
  const url = `${HULY_API_URL}/projects/${identifier}`;

  // Get current description first
  let currentDescription = '';
  try {
    const listResponse = await fetch(`${HULY_API_URL}/projects`);
    if (listResponse.ok) {
      const projects = await listResponse.json();
      currentDescription = projects[identifier]?.description || '';
    }
  } catch (error) {
    console.log(`   ⚠️  Could not fetch current description: ${error.message}`);
  }

  // Build new description with path
  let newDescription = currentDescription.trim();

  // Remove any existing path lines
  newDescription = newDescription
    .split('\n')
    .filter(line => !line.match(/^(?:Path|Filesystem|Directory|Location):/i))
    .join('\n')
    .trim();

  // Add path at the beginning
  if (newDescription) {
    newDescription = `Path: ${path}\n\n${newDescription}`;
  } else {
    newDescription = `Path: ${path}`;
  }

  console.log(`📝 Updating ${identifier} - ${name}`);
  console.log(`   Path: ${path}`);

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        field: 'description',
        value: newDescription,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (result.success) {
      console.log(`   ✅ Updated successfully`);
      return true;
    } else {
      console.log(`   ❌ Update failed: ${result.message || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('🔧 UPDATING HULY PROJECT DESCRIPTIONS\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  let successCount = 0;
  let failCount = 0;

  for (const project of UPDATES) {
    if (dryRun) {
      console.log(`📝 Would update ${project.identifier} - ${project.name}`);
      console.log(`   Path: ${project.path}`);
      console.log();
    } else {
      const success = await updateProjectDescription(
        project.identifier,
        project.name,
        project.path,
      );

      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      console.log();

      // Small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  if (!dryRun) {
    console.log('='.repeat(60));
    console.log(`\n✅ Successfully updated: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📊 Total: ${UPDATES.length}\n`);

    if (successCount > 0) {
      console.log('💡 Next steps:');
      console.log('   1. Restart sync service: docker-compose restart');
      console.log('   2. Wait for next sync cycle');
      console.log('   3. Run audit: node audit-project-paths.js');
    }
  }
}

main();
