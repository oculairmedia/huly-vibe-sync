/**
 * Beads → Git sync (commit and push)
 */

import {
  isBeadsInitialized,
  isGitRepository,
  execBeadsCommand,
  execGitCommand,
  beadsWorkingTreeDirty,
  commitBeadsSyncFiles,
} from '../BeadsService.js';

import { isValidProjectPath } from './BeadsTitleMatcher.js';

export async function syncBeadsToGit(projectPath, options = {}) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for git sync: ${projectPath}`);
    return false;
  }

  const { projectIdentifier = 'unknown', push = true } = options;

  try {
    if (!isBeadsInitialized(projectPath)) {
      console.log(`[Beads] Skipping git sync - beads not initialized at ${projectPath}`);
      return false;
    }

    if (!(await isGitRepository(projectPath))) {
      console.log(`[Beads] Skipping git sync for ${projectIdentifier} - not a git repository`);
      return false;
    }

    console.log(`[Beads] Syncing ${projectIdentifier} to git...`);

    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const commitMessage = `chore(beads): sync changes at ${timestamp}`;

    try {
      await execBeadsCommand(`sync -m "${commitMessage}" --no-push`, projectPath);
    } catch (syncError) {
      const errorMsg = syncError.message || '';

      if (
        errorMsg.includes('no changes added to commit') ||
        errorMsg.includes('nothing added to commit')
      ) {
        if (await beadsWorkingTreeDirty(projectPath)) {
          try {
            const didCommit = await commitBeadsSyncFiles(projectPath, commitMessage);
            if (didCommit) {
              console.log(`[Beads] ✓ Recovered by committing Beads sync files only`);
            }
          } catch (commitError) {
            console.warn(`[Beads] Recovery commit failed: ${commitError.message}`);
          }
        }
      }

      if (
        errorMsg.includes('no changes') ||
        errorMsg.includes('nothing to commit') ||
        errorMsg.includes('nothing added to commit')
      ) {
        console.log(`[Beads] No changes to sync for ${projectIdentifier}`);
        return true;
      }

      if (errorMsg.includes('not in a git repository')) {
        return false;
      }

      console.warn(`[Beads] Sync failed for ${projectIdentifier}: ${errorMsg.split('\n')[0]}`);
      return false;
    }

    if (await beadsWorkingTreeDirty(projectPath)) {
      try {
        await commitBeadsSyncFiles(projectPath, commitMessage);
      } catch (commitError) {
        console.warn(`[Beads] Post-sync commit failed: ${commitError.message}`);
      }
    }

    if (!push) {
      console.log(`[Beads] Push disabled for ${projectIdentifier}`);
      return true;
    }

    try {
      await execGitCommand('push', projectPath);
      console.log(`[Beads] ✓ Pushed ${projectIdentifier} to git remote`);
      return true;
    } catch (pushError) {
      const errorMsg = pushError?.message || String(pushError);

      if (errorMsg.includes('up-to-date') || errorMsg.includes('Everything up-to-date')) {
        console.log(`[Beads] Git already up-to-date for ${projectIdentifier}`);
        return true;
      }

      console.warn(
        `[Beads] Could not push ${projectIdentifier} to remote: ${errorMsg.split('\n')[0]}`
      );
      return false;
    }
  } catch (error) {
    console.error(`[Beads] Failed to sync ${projectIdentifier} to git:`, error.message);
    return false;
  }
}
