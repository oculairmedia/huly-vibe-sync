#!/usr/bin/env node

/**
 * Quick script to create all missing projects in Vibe Kanban
 * Doesn't sync tasks - just creates projects
 */

import fetch from 'node-fetch';
import fs from 'fs';

const config = {
  huly: {
    mcpUrl: 'http://192.168.50.90:3457/mcp',
  },
  vibeKanban: {
    apiUrl: 'http://192.168.50.90:3106/api',
  },
};

// Simple MCP client
class MCPClient {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.requestId = 1;
  }

  async initialize() {
    console.log(`[${this.name}] Initializing...`);
    await this.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'quick-project-creator', version: '1.0.0' },
    });
  }

  async call(method, params = {}) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.requestId++, method, params }),
    });

    const data = await response.json();
    return data.result;
  }

  async callTool(name, args) {
    const result = await this.call('tools/call', { name, arguments: args });
    if (result?.content?.[0]?.text) {
      return JSON.parse(result.content[0].text);
    }
    return result || {};
  }
}

function extractFilesystemPath(description) {
  if (!description) return null;
  const match = description.match(/(?:^|\n)\s*\/opt\/stacks\/[\w\/-]+/);
  return match ? match[0].trim() : null;
}

function determineGitRepoPath(hulyProject) {
  const filesystemPath = extractFilesystemPath(hulyProject.description);
  if (filesystemPath && fs.existsSync(filesystemPath)) {
    return filesystemPath;
  }
  return `/opt/stacks/huly-sync-placeholders/${hulyProject.identifier}`;
}

async function createVibeProject(hulyProject) {
  const gitRepoPath = determineGitRepoPath(hulyProject);

  const response = await fetch(`${config.vibeKanban.apiUrl}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: hulyProject.name,
      git_repo_path: gitRepoPath,
      use_existing_repo: fs.existsSync(gitRepoPath),
    }),
  });

  const result = await response.json();
  return result.success ? result.data : null;
}

async function main() {
  console.log('Quick Project Creator - Creating all missing projects\n');

  const hulyClient = new MCPClient(config.huly.mcpUrl, 'Huly');
  await hulyClient.initialize();

  // Get Huly projects
  console.log('[Huly] Fetching projects...');
  const hulyResult = await hulyClient.callTool('huly_query', {
    entity_type: 'project',
    mode: 'list',
  });
  const hulyProjects = hulyResult.data || [];
  console.log(`[Huly] Found ${hulyProjects.length} projects\n`);

  // Get Vibe projects
  console.log('[Vibe] Fetching existing projects...');
  const vibeResponse = await fetch(`${config.vibeKanban.apiUrl}/projects`);
  const vibeData = await vibeResponse.json();
  const vibeProjects = vibeData.data || [];
  console.log(`[Vibe] Found ${vibeProjects.length} existing projects\n`);

  // Create lookup
  const vibeNames = new Set(vibeProjects.map(p => p.name.toLowerCase()));

  // Find missing
  const missing = hulyProjects.filter(p => !vibeNames.has(p.name.toLowerCase()));
  console.log(`Missing ${missing.length} projects. Creating them now...\n`);

  let created = 0;
  let failed = 0;

  for (const project of missing) {
    process.stdout.write(`Creating: ${project.name}... `);
    const result = await createVibeProject(project);

    if (result) {
      console.log('✓');
      created++;
    } else {
      console.log('✗');
      failed++;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\nDone! Created ${created} projects, ${failed} failed.`);
  process.exit(0);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
