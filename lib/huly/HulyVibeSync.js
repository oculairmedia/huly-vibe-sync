/**
 * Huly Vibe Sync - Sync Vibe task changes back to Huly (bidirectional)
 */

import { extractHulyIdentifier, extractHulyParentIdentifier } from '../textParsers.js';
import { mapVibeStatusToHuly, normalizeStatus } from '../statusMapper.js';
import {
  updateHulyIssueStatus,
  updateHulyIssueDescription,
  updateHulyIssueParent,
} from './HulyUpdateService.js';

function extractCurrentParentIdentifier(hulyIssue) {
  const parentValue = hulyIssue?.parentIssue ?? hulyIssue?.parent ?? null;

  if (!parentValue) return null;
  if (typeof parentValue === 'string') return parentValue;
  if (typeof parentValue === 'object' && parentValue.identifier) return parentValue.identifier;

  return null;
}

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

  const vibeDescription = vibeTask.description || '';
  const vibeDescWithoutFooter = vibeDescription.split('\n\n---\n')[0].trim();

  if (vibeDescWithoutFooter !== hulyIssue.description?.trim()) {
    console.log(`[Phase 2] Description changed in Vibe: ${hulyIdentifier}`);

    const newDescription = vibeDescWithoutFooter;
    await updateHulyIssueDescription(hulyClient, hulyIdentifier, newDescription, config);
  }

  const desiredParentIdentifier = extractHulyParentIdentifier(vibeDescription);
  if (desiredParentIdentifier !== undefined) {
    const currentParentIdentifier = extractCurrentParentIdentifier(hulyIssue);
    if (currentParentIdentifier !== desiredParentIdentifier) {
      console.log(
        `[Phase 2] Parent changed in Vibe: ${hulyIdentifier} ` +
          `(${currentParentIdentifier || 'top-level'} → ${desiredParentIdentifier || 'top-level'})`
      );

      await updateHulyIssueParent(hulyClient, hulyIdentifier, desiredParentIdentifier, config);
    }
  }
}
