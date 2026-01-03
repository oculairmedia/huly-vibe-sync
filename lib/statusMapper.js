/**
 * Status Mapping Utilities
 *
 * Maps status values between Huly and Vibe Kanban
 */

/**
 * Map Huly status to Vibe Kanban status
 *
 * @param {string} hulyStatus - The Huly status value
 * @returns {string} The mapped Vibe Kanban status (todo, inprogress, inreview, done, cancelled)
 */
export function mapHulyStatusToVibe(hulyStatus) {
  if (!hulyStatus) {
    return 'todo';
  }

  const status = hulyStatus.toLowerCase();

  if (status.includes('backlog') || status.includes('todo')) {
    return 'todo';
  }
  if (status.includes('progress')) {
    return 'inprogress';
  }
  if (status.includes('review')) {
    return 'inreview';
  }
  if (status.includes('done') || status.includes('completed')) {
    return 'done';
  }
  if (status.includes('cancel')) {
    return 'cancelled';
  }

  return 'todo';
}

/**
 * Map Vibe Kanban status to Huly status
 *
 * @param {string} vibeStatus - The Vibe Kanban status
 * @returns {string} The mapped Huly status
 */
export function mapVibeStatusToHuly(vibeStatus) {
  const statusMap = {
    todo: 'Backlog',
    inprogress: 'In Progress',
    inreview: 'In Review',
    done: 'Done',
    cancelled: 'Canceled', // Huly uses one 'l' not two!
  };

  return statusMap[vibeStatus] || 'Backlog';
}

/**
 * Normalize a status value to lowercase for comparison
 *
 * @param {string} status - The status value to normalize
 * @returns {string} The normalized status (lowercase, trimmed)
 */
export function normalizeStatus(status) {
  if (!status) {
    return '';
  }
  return status.toLowerCase().trim();
}

/**
 * Check if two status values are equivalent
 * (after mapping and normalization)
 *
 * @param {string} hulyStatus - The Huly status
 * @param {string} vibeStatus - The Vibe status
 * @returns {boolean} True if statuses are equivalent
 */
export function areStatusesEquivalent(hulyStatus, vibeStatus) {
  const hulyMapped = normalizeStatus(mapHulyStatusToVibe(hulyStatus));
  const vibeNormalized = normalizeStatus(vibeStatus);
  return hulyMapped === vibeNormalized;
}

// ============================================================
// BEADS MAPPING FUNCTIONS
// ============================================================

/**
 * Beads native statuses: open, in_progress, blocked, deferred, closed
 *
 * We use labels prefixed with "huly:" to preserve Huly-specific statuses
 * that don't have a direct Beads equivalent:
 * - huly:Todo - Distinguishes Todo from Backlog (both map to 'open')
 * - huly:In Review - Distinguishes In Review from In Progress (both map to 'in_progress')
 * - huly:Canceled - Distinguishes Canceled from Done (both map to 'closed')
 */

/**
 * Map Huly status to Beads status with optional label
 *
 * Beads has 5 native statuses: open, in_progress, blocked, deferred, closed
 * We use labels to preserve Huly-specific status distinctions.
 *
 * @param {string} hulyStatus - The Huly status value
 * @returns {{status: string, label: string|null}} The mapped Beads status and optional label
 */
export function mapHulyStatusToBeads(hulyStatus) {
  if (!hulyStatus) {
    return { status: 'open', label: null };
  }

  const status = hulyStatus.toLowerCase();

  // Map to Beads native statuses with labels for disambiguation
  if (status.includes('backlog')) {
    return { status: 'open', label: null };
  }
  if (status === 'todo' || status.includes('to do') || status.includes('to-do')) {
    return { status: 'open', label: 'huly:Todo' };
  }
  if (status.includes('review')) {
    return { status: 'in_progress', label: 'huly:In Review' };
  }
  if (status.includes('progress')) {
    return { status: 'in_progress', label: null };
  }
  if (status.includes('cancel')) {
    return { status: 'closed', label: 'huly:Canceled' };
  }
  if (status.includes('done') || status.includes('completed')) {
    return { status: 'closed', label: null };
  }

  // Default to open
  return { status: 'open', label: null };
}

/**
 * Get just the Beads status string (for backward compatibility)
 *
 * @param {string} hulyStatus - The Huly status value
 * @returns {string} The mapped Beads status (open, in_progress, or closed)
 */
export function mapHulyStatusToBeadsSimple(hulyStatus) {
  return mapHulyStatusToBeads(hulyStatus).status;
}

/**
 * Map Beads status to Huly status, using labels for disambiguation
 *
 * @param {string} beadsStatus - The Beads status (open, in_progress, blocked, deferred, closed)
 * @param {string[]} labels - Array of labels on the issue (optional)
 * @returns {string} The mapped Huly status
 */
export function mapBeadsStatusToHuly(beadsStatus, labels = []) {
  const hasLabel = label => labels && labels.includes(label);

  switch (beadsStatus) {
    case 'open':
      return hasLabel('huly:Todo') ? 'Todo' : 'Backlog';
    case 'in_progress':
      return hasLabel('huly:In Review') ? 'In Review' : 'In Progress';
    case 'blocked':
      return 'In Progress'; // Huly doesn't have a blocked status
    case 'deferred':
      return 'Backlog'; // Treat deferred as backlogged
    case 'closed':
      return hasLabel('huly:Canceled') ? 'Canceled' : 'Done';
    default:
      return 'Backlog';
  }
}

/**
 * Map Beads status to Vibe Kanban status, using labels for disambiguation
 *
 * @param {string} beadsStatus - The Beads status (open, in_progress, blocked, deferred, closed)
 * @param {string[]} labels - Array of labels on the issue (optional)
 * @returns {string} The mapped Vibe status
 */
export function mapBeadsStatusToVibe(beadsStatus, labels = []) {
  const hasLabel = label => labels && labels.includes(label);

  switch (beadsStatus) {
    case 'open':
      return 'todo';
    case 'in_progress':
      return hasLabel('huly:In Review') ? 'inreview' : 'inprogress';
    case 'blocked':
      return 'inprogress'; // Vibe doesn't have a blocked status
    case 'deferred':
      return 'todo'; // Treat deferred as todo
    case 'closed':
      return hasLabel('huly:Canceled') ? 'cancelled' : 'done';
    default:
      return 'todo';
  }
}

/**
 * Get all huly: prefixed labels that should be removed when status changes
 *
 * @returns {string[]} Array of huly status labels
 */
export function getHulyStatusLabels() {
  return ['huly:Todo', 'huly:In Review', 'huly:Canceled'];
}

/**
 * Map Huly priority to Beads priority
 *
 * Huly: Urgent, High, Medium, Low, NoPriority
 * Beads: 1 (highest) to 5 (lowest)
 *
 * @param {string} hulyPriority - The Huly priority value
 * @returns {number} The mapped Beads priority (1-5)
 */
export function mapHulyPriorityToBeads(hulyPriority) {
  if (!hulyPriority) {
    return 2; // Default to medium (P2)
  }

  const priority = hulyPriority.toLowerCase();

  // Beads uses 0-4 (P0-P4):
  // 0 = Critical/Urgent
  // 1 = High
  // 2 = Medium (default)
  // 3 = Low
  // 4 = Minimal/None

  if (priority.includes('urgent') || priority.includes('critical')) {
    return 0;
  }
  if (priority.includes('high')) {
    return 1;
  }
  if (priority.includes('medium')) {
    return 2;
  }
  if (priority.includes('low')) {
    return 3;
  }
  // Check for explicit "no priority" indicators - be careful not to match "unknown" which contains "no"
  if (
    priority === 'no' ||
    priority === 'none' ||
    priority === 'nopriority' ||
    priority.includes('no priority') ||
    priority.includes('minimal')
  ) {
    return 4;
  }

  return 2; // Default to medium (P2)
}

/**
 * Map Beads priority to Huly priority
 *
 * @param {number} beadsPriority - The Beads priority (0-4, P0-P4)
 * @returns {string} The mapped Huly priority
 */
export function mapBeadsPriorityToHuly(beadsPriority) {
  const priorityMap = {
    0: 'Urgent',
    1: 'High',
    2: 'Medium',
    3: 'Low',
    4: 'NoPriority',
  };

  return priorityMap[beadsPriority] || 'Medium';
}

/**
 * Map Huly issue type to Beads issue type
 *
 * Huly types vary by workspace, Beads has: task, bug, feature, epic, chore
 *
 * @param {string} hulyType - The Huly issue type
 * @returns {string} The mapped Beads issue type
 */
export function mapHulyTypeToBeads(hulyType) {
  if (!hulyType) {
    return 'task';
  }

  const type = hulyType.toLowerCase();

  if (type.includes('bug') || type.includes('defect')) {
    return 'bug';
  }
  if (type.includes('feature') || type.includes('enhancement')) {
    return 'feature';
  }
  if (type.includes('epic') || type.includes('initiative')) {
    return 'epic';
  }
  if (type.includes('chore') || type.includes('maintenance')) {
    return 'chore';
  }

  return 'task'; // Default
}

/**
 * Map Beads issue type to Huly issue type
 *
 * @param {string} beadsType - The Beads issue type
 * @returns {string} The mapped Huly issue type
 */
export function mapBeadsTypeToHuly(beadsType) {
  // Note: This mapping may need adjustment based on specific Huly workspace configuration
  const typeMap = {
    task: 'Task',
    bug: 'Bug',
    feature: 'Feature',
    epic: 'Epic',
    chore: 'Chore',
  };

  return typeMap[beadsType] || 'Task';
}
