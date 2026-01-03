#!/usr/bin/env node

/**
 * Fix Project Paths Script
 *
 * 1. Delete obsolete projects
 * 2. Add filesystem paths to projects missing them
 */

import 'dotenv/config';
import fs from 'fs';
import { createHulyRestClient } from './lib/HulyRestClient.js';
import readline from 'readline';

const hulyClient = createHulyRestClient(process.env.HULY_API_URL || process.env.HULY_MCP_URL);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// Projects to delete
const OBSOLETE_PROJECTS = ['TMCP', 'RDCLE', 'TMCPS'];

// Projects that need paths added (you'll need to confirm these)
const PATH_SUGGESTIONS = {
  'LETTA': '/opt/stacks/letta-opencode-plugin',
  'HULLY': '/opt/stacks/huly-mcp-server',
  'LMS': '/opt/stacks/letta-mcp-server',
  'TSK': '/opt/stacks/vibe-kanban',  // Default project, might be vibe-kanban?
  'BKMCP': '/opt/stacks/bookstack-mcp',
  'SFMCP': '/opt/stacks/surefinance-mcp-server',
  'OPCDE': '/opt/stacks/opencode',
  'GRAPH': '/opt/stacks/graphiti',
};

async function deleteObsoleteProjects() {
  console.log('\n🗑️  DELETING OBSOLETE PROJECTS\n');

  await hulyClient.initialize();
  const projects = await hulyClient.listProjects();

  for (const identifier of OBSOLETE_PROJECTS) {
    const project = projects.find(p => p.identifier === identifier);
    if (project) {
      console.log(`❌ Deleting: ${identifier} - ${project.name}`);

      // Note: Huly API might not have a delete endpoint via REST
      // You may need to delete these manually in the Huly UI
      console.log(`   ⚠️  Please delete this project manually in Huly UI`);
      console.log(`   URL: ${process.env.HULY_API_URL.replace('/api', '')}/browse/${identifier}`);
    } else {
      console.log(`✓ Already deleted: ${identifier}`);
    }
  }
}

async function suggestPathFixes() {
  console.log('\n📝 SUGGESTING PATH FIXES\n');

  await hulyClient.initialize();
  const projects = await hulyClient.listProjects();

  const needsPaths = projects.filter(p =>
    Object.keys(PATH_SUGGESTIONS).includes(p.identifier),
  );

  console.log(`Found ${needsPaths.length} projects needing paths:\n`);

  for (const project of needsPaths) {
    const suggestedPath = PATH_SUGGESTIONS[project.identifier];
    const pathExists = fs.existsSync(suggestedPath);

    console.log(`📁 ${project.identifier} - ${project.name}`);
    console.log(`   Suggested: ${suggestedPath}`);
    console.log(`   Exists: ${pathExists ? '✅ Yes' : '❌ No'}`);

    if (!pathExists) {
      // Try to find alternative paths
      const alternatives = fs.readdirSync('/opt/stacks')
        .filter(dir => {
          const lower = dir.toLowerCase();
          const identifier = project.identifier.toLowerCase();
          const name = project.name.toLowerCase();
          return lower.includes(identifier) ||
                 lower.includes(name.split(' ')[0].toLowerCase());
        })
        .map(dir => `/opt/stacks/${dir}`);

      if (alternatives.length > 0) {
        console.log(`   Alternatives found:`);
        alternatives.forEach(alt => console.log(`     - ${alt}`));
      }
    }

    console.log();
  }

  console.log('\n💡 TO FIX: Add these paths to project descriptions in Huly UI:');
  console.log('   Format: Add "Path: /opt/stacks/project-name" to the description field\n');

  for (const [identifier, path] of Object.entries(PATH_SUGGESTIONS)) {
    const project = needsPaths.find(p => p.identifier === identifier);
    if (project && fs.existsSync(path)) {
      console.log(`   ${identifier}: Add "Path: ${path}" to description`);
    }
  }
}

async function checkMissingLettaFiles() {
  console.log('\n⚠️  PROJECTS WITH PATHS BUT NO .letta FILES\n');

  const issues = [
    { id: 'CAGW', path: '/opt/stacks/claude api gateway' },
    { id: 'AUGMT', path: '/opt/stacks/augment-mcp-tool' },
    { id: 'OCOAI', path: '/opt/stacks/opencode-openai-codex-auth' },
  ];

  for (const issue of issues) {
    console.log(`📁 ${issue.id}`);
    console.log(`   Path: ${issue.path}`);

    if (fs.existsSync(issue.path)) {
      console.log(`   ✅ Directory exists`);
      const lettaPath = `${issue.path}/.letta/settings.local.json`;
      if (fs.existsSync(lettaPath)) {
        console.log(`   ✅ .letta file now exists`);
      } else {
        console.log(`   ⏳ .letta file will be created on next sync`);
      }
    } else {
      console.log(`   ❌ Directory not found`);
    }
    console.log();
  }
}

async function main() {
  try {
    console.log('🔧 PROJECT PATH FIX UTILITY\n');

    const action = process.argv[2];

    if (action === '--delete') {
      await deleteObsoleteProjects();
    } else if (action === '--suggest') {
      await suggestPathFixes();
    } else if (action === '--check-letta') {
      await checkMissingLettaFiles();
    } else {
      console.log('Usage:');
      console.log('  node fix-project-paths.js --delete       # Show obsolete projects to delete');
      console.log('  node fix-project-paths.js --suggest      # Suggest path fixes');
      console.log('  node fix-project-paths.js --check-letta  # Check missing .letta files');
      console.log();

      await deleteObsoleteProjects();
      await suggestPathFixes();
      await checkMissingLettaFiles();
    }

    rl.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    rl.close();
    process.exit(1);
  }
}

main();
