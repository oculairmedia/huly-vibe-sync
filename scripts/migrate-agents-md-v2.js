#!/usr/bin/env node

/**
 * Migration script: Convert existing AGENTS.md files to composable VIBESYNC marker format.
 *
 * Usage:
 *   node scripts/migrate-agents-md-v2.js --dry-run    # Preview changes
 *   node scripts/migrate-agents-md-v2.js              # Execute migration
 *
 * Per PM decision: auto-detect customized content and mark as CUSTOM.
 * @see HVSYN-910
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { AgentsMdGenerator, markers, SECTION_ORDER } from '../lib/AgentsMdGenerator.js';

const DRY_RUN = process.argv.includes('--dry-run');
const DB_PATH = path.join(process.cwd(), 'logs', 'sync-state.db');

const generator = new AgentsMdGenerator();

function getProjects() {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `
    SELECT identifier, name, filesystem_path, letta_agent_id
    FROM projects
    WHERE filesystem_path IS NOT NULL AND filesystem_path != ''
  `
    )
    .all();
  db.close();
  return rows;
}

function detectExistingContent(content) {
  const detected = {};

  if (content.includes('<!-- HULY-PROJECT-INFO -->')) {
    detected['project-info'] = 'legacy-marker';
  }

  if (
    content.includes('## PM Agent Communication') ||
    content.includes('### Reporting Hierarchy') ||
    content.includes('## Developer-PM Workflow') ||
    content.includes('## Project Agent Role')
  ) {
    detected['reporting-hierarchy'] = 'manual';
  }

  if (
    content.includes('bd ready') ||
    content.includes('bd onboard') ||
    content.includes('beads) for issue tracking')
  ) {
    detected['beads-instructions'] = content.includes('## Beads Issue Tracking')
      ? 'legacy-marker'
      : 'manual';
  }

  if (content.includes('Landing the Plane') || content.includes('Session Completion')) {
    detected['session-completion'] = content.includes('## Landing the Plane')
      ? 'legacy-marker'
      : 'manual';
  }

  if (content.includes('## Codebase Context')) {
    detected['codebase-context'] = 'manual';
  }

  return detected;
}

function extractLegacyProjectInfo(content) {
  const regex = /<!-- HULY-PROJECT-INFO -->[\s\S]*?<!-- END-HULY-PROJECT-INFO -->/;
  const match = content.match(regex);
  return match ? match[0] : null;
}

function stripLegacyMarkers(content) {
  return content
    .replace(/<!-- HULY-PROJECT-INFO -->[\s\S]*?<!-- END-HULY-PROJECT-INFO -->\n*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasCustomReportingHierarchy(content, projectName) {
  const defaultPhrases = [
    'acts as the senior developer and project manager',
    'Can provide guidance',
  ];

  const customPhrases = [
    'acts as the technical product manager',
    'Makes technical decisions',
    'When to Consult the PM',
    'When to Escalate to User',
    'Developer-PM Workflow',
  ];

  const hasCustom = customPhrases.some(p => content.includes(p));
  return hasCustom;
}

function migrateProject(project) {
  const agentsPath = path.join(project.filesystem_path, 'AGENTS.md');
  const result = {
    identifier: project.identifier,
    name: project.name,
    path: project.filesystem_path,
    agentId: project.letta_agent_id,
    hasFile: false,
    actions: [],
    errors: [],
  };

  if (!fs.existsSync(agentsPath)) {
    result.actions.push('no AGENTS.md found — will generate fresh');

    if (!project.letta_agent_id) {
      result.actions.push(
        'no agent ID — skipping (beads-only projects get migrated on next beads init)'
      );
      return result;
    }

    const vars = {
      identifier: project.identifier,
      name: project.name,
      agentId: project.letta_agent_id,
      agentName: `Huly - ${project.name}`,
      projectPath: project.filesystem_path,
    };

    if (!DRY_RUN) {
      generator.generate(agentsPath, vars);
    }
    result.actions.push('generated fresh AGENTS.md with all sections');
    return result;
  }

  result.hasFile = true;
  const content = fs.readFileSync(agentsPath, 'utf8');
  const detected = detectExistingContent(content);

  let workingContent = content;

  const isCustomReporting =
    detected['reporting-hierarchy'] === 'manual' &&
    hasCustomReportingHierarchy(content, project.name);

  // Extract custom PM content from original (pre-strip) to avoid losing it in legacy marker removal
  let extractedCustomPM = null;
  if (isCustomReporting) {
    result.actions.push(
      'reporting-hierarchy: CUSTOM detected (manual PM section with custom content)'
    );
    const pmSectionRegex =
      /## (?:PM Agent Communication|Project Agent Role|Developer-PM Workflow)[^\n]*[\s\S]*?(?=\n## (?!(?:Developer-PM Workflow|Project Agent Role|When to Consult|When to Escalate|Reporting Requirements|Communication Pattern|Example Workflow))|\n---\s*\n|\n<!-- (?!HULY)|$)/;
    const pmMatch = content.match(pmSectionRegex);
    if (pmMatch) {
      extractedCustomPM = pmMatch[0].trim();
    }
  }

  if (detected['project-info'] === 'legacy-marker') {
    workingContent = stripLegacyMarkers(workingContent);
    result.actions.push('project-info: stripped legacy <!-- HULY-PROJECT-INFO --> block');
  }

  if (!project.letta_agent_id) {
    result.actions.push('no agent ID — only migrating beads/session sections');

    if (!DRY_RUN) {
      fs.writeFileSync(agentsPath, workingContent, { mode: 0o666 });
      generator.generate(
        agentsPath,
        {},
        {
          sections: ['beads-instructions', 'session-completion'],
        }
      );
    }
    result.actions.push('generated beads-instructions + session-completion');
    return result;
  }

  const vars = {
    identifier: project.identifier,
    name: project.name,
    agentId: project.letta_agent_id,
    agentName: `Huly - ${project.name}`,
    projectPath: project.filesystem_path,
  };

  if (!DRY_RUN) {
    fs.writeFileSync(agentsPath, workingContent, { mode: 0o666 });
  }

  const sectionsToGenerate = [
    'project-info',
    'beads-instructions',
    'session-completion',
    'codebase-context',
  ];

  if (isCustomReporting && extractedCustomPM) {
    result.actions.push('reporting-hierarchy: preserving as CUSTOM');
    if (!DRY_RUN) {
      const m = markers('reporting-hierarchy');
      const currentContent = fs.readFileSync(agentsPath, 'utf8');
      if (!currentContent.includes(m.custom) && !currentContent.includes(m.start)) {
        const customBlock = `\n${m.custom}\n${extractedCustomPM}\n`;
        const insertPoint = currentContent.indexOf('\n\n');
        if (insertPoint !== -1) {
          const updated =
            currentContent.slice(0, insertPoint) +
            '\n' +
            customBlock +
            currentContent.slice(insertPoint);
          fs.writeFileSync(agentsPath, updated, { mode: 0o666 });
        } else {
          fs.writeFileSync(agentsPath, currentContent + '\n' + customBlock, { mode: 0o666 });
        }
      }
    }
  } else {
    sectionsToGenerate.splice(1, 0, 'reporting-hierarchy');
    result.actions.push('reporting-hierarchy: generating from template');
  }

  if (!DRY_RUN) {
    const { changes } = generator.generate(agentsPath, vars, {
      sections: sectionsToGenerate,
    });
    result.actions.push(
      `generated sections: ${changes.map(c => `${c.section}:${c.action}`).join(', ')}`
    );
  } else {
    result.actions.push(`would generate sections: ${sectionsToGenerate.join(', ')}`);
  }

  return result;
}

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  AGENTS.md Migration to VIBESYNC Composable Sections`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'EXECUTE'}`);
  console.log(`${'='.repeat(70)}\n`);

  const projects = getProjects();
  console.log(`Found ${projects.length} projects with filesystem paths\n`);

  const results = [];
  for (const project of projects) {
    try {
      const result = migrateProject(project);
      results.push(result);
    } catch (err) {
      results.push({
        identifier: project.identifier,
        name: project.name,
        errors: [err.message],
        actions: ['FAILED'],
      });
    }
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log('MIGRATION SUMMARY');
  console.log(`${'─'.repeat(70)}\n`);

  let generated = 0,
    updated = 0,
    skipped = 0,
    failed = 0;

  for (const r of results) {
    const status = r.errors?.length > 0 ? '❌' : r.actions.length === 0 ? '⏭️' : '✅';
    console.log(`${status} ${r.identifier} (${r.name})`);
    for (const a of r.actions) {
      console.log(`   ${a}`);
    }
    for (const e of r.errors || []) {
      console.log(`   ERROR: ${e}`);
    }

    if (r.errors?.length > 0) failed++;
    else if (r.hasFile === false && r.actions.some(a => a.includes('generated fresh'))) generated++;
    else if (r.actions.length > 0) updated++;
    else skipped++;
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(
    `Generated: ${generated} | Updated: ${updated} | Skipped: ${skipped} | Failed: ${failed}`
  );
  console.log(`${'─'.repeat(70)}\n`);

  if (DRY_RUN) {
    console.log('This was a DRY RUN. No files were modified.');
    console.log('Run without --dry-run to execute the migration.\n');
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
