/**
 * Huly Vibe Sync - Sync Vibe task changes back to Huly (bidirectional)
 */

import { extractHulyIdentifier } from '../textParsers.js';
import { mapVibeStatusToHuly, normalizeStatus } from '../statusMapper.js';
import { updateHulyIssueStatus, updateHulyIssueDescription } from './HulyUpdateService.js';

export async function syncVibeTaskToHuly(
  hulyClient,
  vibeTask,
  hulyIssues,
  projectIdentifier,
  config = {},
  phase1UpdatedTasks = new Set(),
) {
  if (phase1UpdatedTasks.has(vibeTask.id)) {
    console.log(`[Skip Phase 2] Task "${vibeTask.title}" was just updated in Phase 1`);
    return;
  }

  const hulyIdentifier = extractHulyIdentifier(vibeTask.description);

  if (!hulyIdentifier) {
    return;
  }

  const hulyIssue = hulyIssues.find(issue => issue.identifier === hulyIdentifier);

  if (!hulyIssue) {
    console.warn(`[Phase 2] Huly issue ${hulyIdentifier} not found for task "${vibeTask.title}"`);
    return;
  }

  const vibeStatusMapped = mapVibeStatusToHuly(vibeTask.status);
  const hulyStatusNormalized = normalizeStatus(hulyIssue.status);

  if (vibeStatusMapped !== hulyStatusNormalized) {
    console.log(
      `[Phase 2] Status changed in Vibe: ${hulyIdentifier} ` +
      `(Huly: ${hulyIssue.status} \u2192 Vibe: ${vibeTask.status})`,
    );

    await updateHulyIssueStatus(hulyClient, hulyIdentifier, vibeStatusMapped, config);
  }

  const vibeDescWithoutFooter = vibeTask.description
    .split('\n\n---\n')[0]
    .trim();

  if (vibeDescWithoutFooter !== hulyIssue.description?.trim()) {
    console.log(`[Phase 2] Description changed in Vibe: ${hulyIdentifier}`);

    const newDescription = vibeDescWithoutFooter;
    await updateHulyIssueDescription(hulyClient, hulyIdentifier, newDescription, config);
  }
}
