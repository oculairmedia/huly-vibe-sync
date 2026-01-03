#!/usr/bin/env node

/**
 * Audit Script for Huly Project Filesystem Paths
 *
 * Checks if filesystem paths in Huly project descriptions:
 * - Actually exist on disk
 * - Match expected /opt/stacks/{project-name} pattern
 * - Have .letta/settings.local.json created
 */

import 'dotenv/config';
import fs from 'fs';
import { createHulyRestClient } from './lib/HulyRestClient.js';

const hulyClient = createHulyRestClient(process.env.HULY_API_URL || process.env.HULY_MCP_URL);

function extractFilesystemPath(description) {
  if (!description) return null;

  // Match patterns like:
  // Path: /opt/stacks/project-name
  // Filesystem: /opt/stacks/project-name
  // Directory: /opt/stacks/project-name
  const patterns = [
    /(?:Path|Filesystem|Directory|Location):\s*([^\n\r]+)/i,
    /(?:^|\n)([/][^\n\r]+)/,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const path = match[1].trim();
      // Clean up common suffixes
      return path.replace(/[,;.]$/, '').trim();
    }
  }

  return null;
}

async function auditProjects() {
  console.log('🔍 Auditing Huly Project Filesystem Paths\n');

  try {
    await hulyClient.initialize();
    const projects = await hulyClient.listProjects();

    console.log(`Found ${projects.length} Huly projects\n`);
    console.log('='.repeat(80));
    console.log('\n');

    const issues = {
      noPath: [],
      pathNotExist: [],
      noLettaFile: [],
      correct: [],
    };

    for (const project of projects) {
      const identifier = project.identifier;
      const name = project.name;
      const description = project.description || '';
      const extractedPath = extractFilesystemPath(description);

      console.log(`📁 ${identifier} - ${name}`);

      if (!extractedPath) {
        console.log(`   ❌ NO PATH: No filesystem path in description`);
        issues.noPath.push({ identifier, name });
      } else {
        console.log(`   📂 Path: ${extractedPath}`);

        // Check if path exists
        if (!fs.existsSync(extractedPath)) {
          console.log(`   ❌ PATH NOT FOUND: Directory does not exist`);
          issues.pathNotExist.push({ identifier, name, path: extractedPath });
        } else {
          // Check if .letta/settings.local.json exists
          const lettaFile = `${extractedPath}/.letta/settings.local.json`;
          if (!fs.existsSync(lettaFile)) {
            console.log(`   ⚠️  NO .letta FILE: ${lettaFile}`);
            issues.noLettaFile.push({ identifier, name, path: extractedPath });
          } else {
            // Check if it has lastAgent
            try {
              const content = JSON.parse(fs.readFileSync(lettaFile, 'utf8'));
              if (content.lastAgent) {
                console.log(`   ✅ CORRECT: .letta file exists with agent ${content.lastAgent.substring(0, 20)}...`);
                issues.correct.push({ identifier, name, path: extractedPath, agentId: content.lastAgent });
              } else {
                console.log(`   ⚠️  INVALID FORMAT: .letta file missing lastAgent field`);
                issues.noLettaFile.push({ identifier, name, path: extractedPath });
              }
            } catch (error) {
              console.log(`   ⚠️  INVALID JSON: Cannot parse .letta file`);
              issues.noLettaFile.push({ identifier, name, path: extractedPath });
            }
          }
        }
      }
      console.log();
    }

    console.log('\n');
    console.log('='.repeat(80));
    console.log('\n📊 AUDIT SUMMARY\n');
    console.log(`Total Projects: ${projects.length}`);
    console.log(`✅ Correct Setup: ${issues.correct.length}`);
    console.log(`❌ No Path in Description: ${issues.noPath.length}`);
    console.log(`❌ Path Does Not Exist: ${issues.pathNotExist.length}`);
    console.log(`⚠️  Missing .letta File: ${issues.noLettaFile.length}`);
    console.log();

    // Detailed breakdown
    if (issues.noPath.length > 0) {
      console.log('\n📋 PROJECTS WITH NO PATH IN DESCRIPTION:');
      issues.noPath.forEach(p => {
        console.log(`   - ${p.identifier}: ${p.name}`);
      });
    }

    if (issues.pathNotExist.length > 0) {
      console.log('\n📋 PROJECTS WITH NON-EXISTENT PATHS:');
      issues.pathNotExist.forEach(p => {
        console.log(`   - ${p.identifier}: ${p.name}`);
        console.log(`     Path: ${p.path}`);
      });
    }

    if (issues.noLettaFile.length > 0) {
      console.log('\n📋 PROJECTS MISSING .letta/settings.local.json:');
      issues.noLettaFile.forEach(p => {
        console.log(`   - ${p.identifier}: ${p.name}`);
        console.log(`     Path: ${p.path}`);
      });
    }

    console.log();
    console.log('='.repeat(80));
    console.log();

    // Recommendations
    console.log('💡 RECOMMENDATIONS:\n');

    if (issues.noPath.length > 0) {
      console.log(`1. Add filesystem paths to ${issues.noPath.length} project descriptions`);
      console.log(`   Format: "Path: /opt/stacks/project-name" in the description field`);
      console.log();
    }

    if (issues.pathNotExist.length > 0) {
      console.log(`2. Fix ${issues.pathNotExist.length} incorrect paths in project descriptions`);
      console.log(`   Either create the directories or update the descriptions`);
      console.log();
    }

    if (issues.noLettaFile.length > 0) {
      console.log(`3. Restart sync to create .letta files for ${issues.noLettaFile.length} projects`);
      console.log(`   docker-compose restart`);
      console.log();
    }

    // Export JSON for programmatic use
    if (process.argv.includes('--json')) {
      const output = {
        total: projects.length,
        summary: {
          correct: issues.correct.length,
          noPath: issues.noPath.length,
          pathNotExist: issues.pathNotExist.length,
          noLettaFile: issues.noLettaFile.length,
        },
        issues,
      };
      console.log('\n📄 JSON OUTPUT:\n');
      console.log(JSON.stringify(output, null, 2));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

auditProjects();
