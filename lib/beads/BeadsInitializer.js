/**
 * Beads Initializer - Initialize and setup beads in project directories
 */

import fs from 'fs';
import path from 'path';
import { execShellCommand, execGitCommand, isGitRepository, commitBeadsSyncFiles } from './BeadsGitOps.js';
import { execBeadsCommand } from './BeadsCLI.js';
import { agentsMdGenerator } from '../AgentsMdGenerator.js';

export function isBeadsInitialized(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') {
    return false;
  }

  if (!fs.existsSync(projectPath)) {
    return false;
  }

  const beadsDir = path.join(projectPath, '.beads');
  return fs.existsSync(beadsDir) && fs.existsSync(path.join(beadsDir, 'beads.db'));
}

export async function initializeBeads(projectPath, options = {}) {
  try {
    if (!projectPath || typeof projectPath !== 'string') {
      console.log('[Beads] Invalid project path provided');
      return false;
    }

    if (isBeadsInitialized(projectPath)) {
      console.log(`[Beads] Already initialized at ${projectPath}`);
      return true;
    }

    console.log(`[Beads] Initializing beads at ${projectPath}`);

    if (!fs.existsSync(projectPath)) {
      console.log(`[Beads] Creating directory: ${projectPath}`);
      fs.mkdirSync(projectPath, { recursive: true });
    }

    await execBeadsCommand('init --quiet', projectPath);

    const beadsDir = path.join(projectPath, '.beads');

    const gitignoreContent = `# SQLite databases
*.db
*.db?*
*.db-journal
*.db-wal
*.db-shm

# Daemon runtime files
daemon.lock
daemon.log
daemon.pid
bd.sock

# Local version tracking (prevents upgrade notification spam after git ops)
.local_version

# Legacy database files
db.sqlite
bd.db

# Merge artifacts (temporary files from 3-way merge)
beads.base.jsonl
beads.base.meta.json
beads.left.jsonl
beads.left.meta.json
beads.right.jsonl
beads.right.meta.json

# Keep JSONL exports and config (source of truth for git)
!issues.jsonl
!interactions.jsonl
!metadata.json
!config.json
`;

    const gitignorePath = path.join(beadsDir, '.gitignore');
    try {
      fs.writeFileSync(gitignorePath, gitignoreContent);
      console.log(`[Beads] Created .beads/.gitignore`);
    } catch (error) {
      console.warn(`[Beads] Could not create .beads/.gitignore: ${error.message}`);
    }

    if (fs.existsSync(beadsDir)) {
      try {
        await execShellCommand(`chown -R 1000:1000 "${beadsDir}"`, { cwd: projectPath });
        console.log(`[Beads] Fixed permissions for ${beadsDir}`);
      } catch (permError) {
        console.log(`[Beads] Could not fix permissions (may not be needed): ${permError.message}`);
      }
    }

    try {
      await execGitCommand('rev-parse --git-dir', projectPath);

      const gitattributesPath = path.join(projectPath, '.gitattributes');
      const beadsMergeAttrs = `# Use bd merge for beads JSONL files
.beads/issues.jsonl merge=beads
.beads/interactions.jsonl merge=beads
`;

      try {
        let existingContent = '';
        if (fs.existsSync(gitattributesPath)) {
          existingContent = fs.readFileSync(gitattributesPath, 'utf-8');
        }

        if (!existingContent.includes('merge=beads')) {
          const newContent = existingContent
            ? `${existingContent.trimEnd()}\n\n${beadsMergeAttrs}`
            : beadsMergeAttrs;
          fs.writeFileSync(gitattributesPath, newContent);
          console.log(`[Beads] Updated .gitattributes with merge driver config`);
        }
      } catch (attrError) {
        console.warn(`[Beads] Could not update .gitattributes: ${attrError.message}`);
      }

      try {
        await execBeadsCommand('hooks install', projectPath);
        console.log(`[Beads] Installed git hooks`);
      } catch (hooksError) {
        console.warn(`[Beads] Could not install git hooks: ${hooksError.message}`);
      }

      const agentsPath = path.join(projectPath, 'AGENTS.md');

      try {
        const { changes } = agentsMdGenerator.generate(
          agentsPath,
          {},
          {
            sections: ['beads-instructions', 'session-completion'],
          }
        );

        const actionsTaken = changes.filter(c => c.action !== 'skipped');
        if (actionsTaken.length > 0) {
          console.log(
            `[Beads] Updated AGENTS.md: ${actionsTaken.map(c => `${c.section}:${c.action}`).join(', ')}`
          );
        }
      } catch (agentsError) {
        console.warn(`[Beads] Could not setup AGENTS.md: ${agentsError.message}`);
      }

      const lsFiles = await execGitCommand('ls-files .beads/', projectPath);

      if (!lsFiles) {
        console.log(`[Beads] Adding .beads/ files to git`);

        try {
          await commitBeadsSyncFiles(projectPath, 'chore(beads): initialize beads issue tracker');
          console.log(`[Beads] Committed .beads/ setup to git`);
        } catch (commitError) {
          console.log(`[Beads] Could not commit .beads/ setup (will retry on next sync)`);
        }
      }
    } catch (gitError) {
      // Not a git repo or git operations failed - skip git setup
    }

    console.log(`[Beads] \u2713 Initialized successfully at ${projectPath}`);
    return true;
  } catch (error) {
    console.error(`[Beads] Failed to initialize at ${projectPath}:`, error.message);
    return false;
  }
}

export async function ensureBeadsInitialized(projectPath, options = {}) {
  if (isBeadsInitialized(projectPath)) {
    return true;
  }

  return await initializeBeads(projectPath, options);
}
