"use strict";
/**
 * Status Mapping Utilities (TypeScript)
 *
 * Maps status and priority values between Huly, Vibe Kanban, and Beads.
 * Used by Temporal activities for consistent status translation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapHulyStatusToVibe = mapHulyStatusToVibe;
exports.mapVibeStatusToHuly = mapVibeStatusToHuly;
exports.mapHulyStatusToBeads = mapHulyStatusToBeads;
exports.mapHulyStatusToBeadsSimple = mapHulyStatusToBeadsSimple;
exports.mapBeadsStatusToHuly = mapBeadsStatusToHuly;
exports.mapBeadsStatusToVibe = mapBeadsStatusToVibe;
exports.mapHulyPriorityToBeads = mapHulyPriorityToBeads;
exports.mapBeadsPriorityToHuly = mapBeadsPriorityToHuly;
exports.normalizeStatus = normalizeStatus;
exports.areStatusesEquivalent = areStatusesEquivalent;
exports.getHulyStatusLabels = getHulyStatusLabels;
/**
 * Map Huly status to Vibe Kanban status
 */
function mapHulyStatusToVibe(hulyStatus) {
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
 */
function mapVibeStatusToHuly(vibeStatus) {
    const statusMap = {
        todo: 'Backlog',
        inprogress: 'In Progress',
        inreview: 'In Review',
        done: 'Done',
        cancelled: 'Canceled', // Huly uses one 'l'
    };
    return statusMap[vibeStatus] || 'Backlog';
}
/**
 * Map Huly status to Beads status with optional label for disambiguation
 *
 * Beads has 5 native statuses: open, in_progress, blocked, deferred, closed
 * We use labels to preserve Huly-specific status distinctions.
 */
function mapHulyStatusToBeads(hulyStatus) {
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
function mapHulyStatusToBeadsSimple(hulyStatus) {
    return mapHulyStatusToBeads(hulyStatus).status;
}
/**
 * Map Beads status to Huly status, using labels for disambiguation
 */
function mapBeadsStatusToHuly(beadsStatus, labels = []) {
    const hasLabel = (label) => labels.includes(label);
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
/**
 * Map Beads status to Vibe Kanban status
 */
function mapBeadsStatusToVibe(beadsStatus, labels = []) {
    const hasLabel = (label) => labels.includes(label);
    switch (beadsStatus) {
        case 'open':
            return 'todo';
        case 'in_progress':
            return hasLabel('huly:In Review') ? 'inreview' : 'inprogress';
        case 'blocked':
            return 'inprogress';
        case 'deferred':
            return 'todo';
        case 'closed':
            return hasLabel('huly:Canceled') ? 'cancelled' : 'done';
        default:
            return 'todo';
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
function mapHulyPriorityToBeads(hulyPriority) {
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
    if (priority === 'no' || priority === 'none' || priority === 'nopriority' ||
        priority.includes('no priority') || priority.includes('minimal')) {
        return 4;
    }
    return 2; // Default to medium
}
/**
 * Map Beads priority to Huly priority
 */
function mapBeadsPriorityToHuly(beadsPriority) {
    const priorityMap = {
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
function normalizeStatus(status) {
    if (!status)
        return '';
    return status.toLowerCase().trim();
}
/**
 * Check if two statuses are equivalent after mapping
 */
function areStatusesEquivalent(hulyStatus, vibeStatus) {
    const hulyMapped = normalizeStatus(mapHulyStatusToVibe(hulyStatus));
    const vibeNormalized = normalizeStatus(vibeStatus);
    return hulyMapped === vibeNormalized;
}
/**
 * Get all huly: prefixed labels for status tracking
 */
function getHulyStatusLabels() {
    return ['huly:Todo', 'huly:In Review', 'huly:Canceled'];
}
//# sourceMappingURL=statusMapper.js.map