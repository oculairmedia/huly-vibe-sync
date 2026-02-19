/**
 * Status Mapping Utilities (TypeScript)
 *
 * Maps status and priority values between Huly and Beads.
 * Used by Temporal activities for consistent status translation.
 */
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
export declare function mapHulyStatusToBeads(hulyStatus: string): BeadsStatusWithLabel;
/**
 * Get just the Beads status string (simple version)
 */
export declare function mapHulyStatusToBeadsSimple(hulyStatus: string): BeadsStatus;
/**
 * Map Beads status to Huly status, using labels for disambiguation
 */
export declare function mapBeadsStatusToHuly(beadsStatus: string, labels?: string[]): string;
/**
 * Map Huly priority to Beads priority (0-4, P0-P4)
 *
 * Huly: Urgent, High, Medium, Low, NoPriority
 * Beads: 0 (highest) to 4 (lowest)
 */
export declare function mapHulyPriorityToBeads(hulyPriority: string | undefined): number;
/**
 * Map Beads priority to Huly priority
 */
export declare function mapBeadsPriorityToHuly(beadsPriority: number): string;
/**
 * Normalize a status value for comparison
 */
export declare function normalizeStatus(status: string): string;
/**
 * Get all huly: prefixed labels for status tracking
 */
export declare function getHulyStatusLabels(): string[];
//# sourceMappingURL=statusMapper.d.ts.map