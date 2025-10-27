#!/usr/bin/env node

/**
 * Sync /opt/stacks projects to Huly
 * Creates Huly projects for repos and updates descriptions with filesystem paths
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Configuration
const HULY_MCP_URL = process.env.HULY_MCP_URL || 'http://192.168.50.90:3457/mcp';
const STACKS_DIR = '/opt/stacks';

// Simple MCP client
class MCPClient {
  constructor(url) {
    this.url = url;
    this.requestId = 1;
  }

  async call(method, params = {}) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.requestId++,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`MCP Error: ${data.error.message}`);
    }

    return data.result;
  }

  async callTool(name, args) {
    const result = await this.call('tools/call', { name, arguments: args });

    if (result && result.content && result.content[0]) {
      const content = result.content[0];
      if (content.type === 'text') {
        try {
          return JSON.parse(content.text);
        } catch (e) {
          return content.text;
        }
      }
    }

    return result;
  }
}

// Find all git repos in /opt/stacks
function findGitRepos() {
  console.log(`Scanning ${STACKS_DIR} for git repositories...`);

  const repos = [];
  const entries = fs.readdirSync(STACKS_DIR);

  for (const entry of entries) {
    const fullPath = path.join(STACKS_DIR, entry);
    const gitPath = path.join(fullPath, '.git');

    try {
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory() && fs.existsSync(gitPath)) {
        // Get git remote URL if available
        let gitUrl = null;
        try {
          gitUrl = execSync('git remote get-url origin', {
            cwd: fullPath,
            encoding: 'utf8',
          }).trim();
        } catch (e) {
          // No remote configured
        }

        repos.push({
          name: entry,
          path: fullPath,
          gitUrl,
        });
      }
    } catch (e) {
      // Skip if can't stat
    }
  }

  console.log(`Found ${repos.length} git repositories\n`);
  return repos;
}

// Generate project identifier from name (1-5 uppercase alphanumeric)
function generateIdentifier(name) {
  // Remove special chars, take first 5 alphanumeric, uppercase
  const clean = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return clean.substring(0, 5) || 'PROJ';
}

async function main() {
  console.log('='.repeat(60));
  console.log('Syncing /opt/stacks Projects to Huly');
  console.log('='.repeat(60) + '\n');

  const client = new MCPClient(HULY_MCP_URL);

  // Get existing Huly projects
  console.log('[Huly] Fetching existing projects...');
  let hulyProjects = [];
  try {
    const result = await client.callTool('huly_query', {
      entity_type: 'project',
      mode: 'list',
    });
    hulyProjects = result || [];
    console.log(`[Huly] Found ${hulyProjects.length} existing projects\n`);
  } catch (error) {
    console.error(`[Huly] Error fetching projects: ${error.message}`);
    console.log('[Huly] Continuing with empty project list...\n');
  }

  // Create map of existing projects by identifier and name
  const projectsByIdentifier = new Map();
  const projectsByName = new Map();

  for (const project of hulyProjects) {
    if (project.identifier) {
      projectsByIdentifier.set(project.identifier, project);
    }
    if (project.name) {
      projectsByName.set(project.name, project);
    }
  }

  // Find all git repos
  const repos = findGitRepos();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Process each repo
  for (const repo of repos) {
    console.log(`\n--- Processing: ${repo.name} ---`);
    console.log(`Path: ${repo.path}`);
    if (repo.gitUrl) {
      console.log(`Git URL: ${repo.gitUrl}`);
    }

    const identifier = generateIdentifier(repo.name);
    console.log(`Identifier: ${identifier}`);

    // Check if project exists by identifier or name
    let existingProject = projectsByIdentifier.get(identifier) || projectsByName.get(repo.name);

    if (existingProject) {
      console.log(`[Huly] Project exists: ${existingProject.name} (${existingProject.identifier})`);

      // Check if description already has filesystem path
      const hasPath = existingProject.description && existingProject.description.includes('Filesystem:');

      if (hasPath) {
        console.log('[Huly] ✓ Description already contains filesystem path');
        skipped++;
      } else {
        // Update description to include filesystem path
        const newDescription = (existingProject.description || '') +
          `\n\n---\nFilesystem: ${repo.path}`;

        try {
          await client.callTool('huly_entity', {
            entity_type: 'project',
            operation: 'update',
            project_identifier: existingProject.identifier,
            data: {
              description: newDescription,
            },
          });
          console.log('[Huly] ✓ Updated description with filesystem path');
          updated++;
        } catch (error) {
          console.error(`[Huly] ✗ Error updating description: ${error.message}`);
          skipped++;
        }
      }
    } else {
      // Create new project
      console.log('[Huly] Creating new project...');

      const projectData = {
        name: repo.name,
        identifier: identifier,
        description: `Project synced from /opt/stacks\n\n---\nFilesystem: ${repo.path}`,
      };

      try {
        const result = await client.callTool('huly_entity', {
          entity_type: 'project',
          operation: 'create',
          data: projectData,
        });
        console.log(`[Huly] ✓ Created project: ${repo.name} (${identifier})`);
        created++;
      } catch (error) {
        console.error(`[Huly] ✗ Error creating project: ${error.message}`);
        skipped++;
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Sync Summary');
  console.log('='.repeat(60));
  console.log(`Total repositories: ${repos.length}`);
  console.log(`Projects created: ${created}`);
  console.log(`Projects updated: ${updated}`);
  console.log(`Projects skipped: ${skipped}`);
  console.log('='.repeat(60));
}

main().catch(error => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
