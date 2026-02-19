/**
 * Event Trigger Client Functions
 *
 * Schedule and manage Huly webhook change workflows.
 */
import type { HulyWebhookChangeInput, HulyWebhookChangeResult } from '../workflows/bidirectional-sync';
/**
 * Schedule a Huly webhook change workflow (fire and forget)
 *
 * Processes Huly webhook change events and syncs to Beads.
 * Returns immediately after scheduling.
 */
export declare function scheduleHulyWebhookChange(input: HulyWebhookChangeInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a Huly webhook change workflow and wait for result
 */
export declare function executeHulyWebhookChange(input: HulyWebhookChangeInput): Promise<HulyWebhookChangeResult>;
//# sourceMappingURL=event-triggers.d.ts.map