/**
 * Status Mapping Utilities (TypeScript)
 *
 * Maps status and priority values between Huly and Beads.
 * Used by Temporal activities for consistent status translation.
 */

// ============================================================
// BEADS STATUS MAPPING
// ============================================================

export type BeadsStatus = 'open' | 'in_progress' | 'blocked' | 'deferred' | 'closed';

export interface BeadsStatusWithLabel {
  status: BeadsStatus;
  label: string | null;
}

/**
 * Map Huly status to Beads status with optional label for disambiguation
 *
 * Beads has 5 native statuses: open, in_progress, blocked, deferred, closed
 * We use labels to preserve Huly-specific status distinctions.
 */
export function mapHulyStatusToBeads(hulyStatus: string): BeadsStatusWithLabel {
  if (!hulyStatus) {
    return { status: 'open', label: null };
  }

  const status = hulyStatus.toLowerCase();

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

  return { status: 'open', label: null };
}

/**
 * Get just the Beads status string (simple version)
 */
export function mapHulyStatusToBeadsSimple(hulyStatus: string): BeadsStatus {
  return mapHulyStatusToBeads(hulyStatus).status;
}

/**
 * Map Beads status to Huly status, using labels for disambiguation
 */
export function mapBeadsStatusToHuly(beadsStatus: string, labels: string[] = []): string {
  const hasLabel = (label: string) => labels.includes(label);

  switch (beadsStatus) {
    case 'open':
      return hasLabel('huly:Todo') ? 'Todo' : 'Backlog';
    case 'in_progress':
      return hasLabel('huly:In Review') ? 'In Review' : 'In Progress';
    case 'blocked':
      return 'In Progress'; // Huly doesn't have blocked
    case 'deferred':
      return 'Backlog';
    case 'closed':
      return hasLabel('huly:Canceled') ? 'Canceled' : 'Done';
    default:
      return 'Backlog';
  }
}

// ============================================================
// PRIORITY MAPPING
// ============================================================

/**
 * Map Huly priority to Beads priority (0-4, P0-P4)
 *
 * Huly: Urgent, High, Medium, Low, NoPriority
 * Beads: 0 (highest) to 4 (lowest)
 */
export function mapHulyPriorityToBeads(hulyPriority: string | undefined): number {
  if (!hulyPriority) {
    return 2; // Default to medium (P2)
  }

  const priority = hulyPriority.toLowerCase();

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
  if (
    priority === 'no' ||
    priority === 'none' ||
    priority === 'nopriority' ||
    priority.includes('no priority') ||
    priority.includes('minimal')
  ) {
    return 4;
  }

  return 2; // Default to medium
}

/**
 * Map Beads priority to Huly priority
 */
export function mapBeadsPriorityToHuly(beadsPriority: number): string {
  const priorityMap: Record<number, string> = {
    0: 'Urgent',
    1: 'High',
    2: 'Medium',
    3: 'Low',
    4: 'NoPriority',
  };

  return priorityMap[beadsPriority] || 'Medium';
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Normalize a status value for comparison
 */
export function normalizeStatus(status: string): string {
  if (!status) return '';
  return status.toLowerCase().trim();
}

/**
 * Get all huly: prefixed labels for status tracking
 */
export function getHulyStatusLabels(): string[] {
  return ['huly:Todo', 'huly:In Review', 'huly:Canceled'];
}
