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
    'todo': 'Backlog',
    'inprogress': 'In Progress',
    'inreview': 'In Review',
    'done': 'Done',
    'cancelled': 'Cancelled'
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
