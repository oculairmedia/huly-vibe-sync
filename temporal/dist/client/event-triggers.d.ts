/**
 * Event Trigger Client Functions
 *
 * Schedule and manage Vibe SSE and Huly webhook change workflows.
 */
import type { VibeSSEChangeInput, VibeSSEChangeResult, HulyWebhookChangeInput, HulyWebhookChangeResult } from '../workflows/bidirectional-sync';
/**
 * Schedule a Vibe SSE change workflow
 *
 * This is the main entry point for VibeEventWatcher to trigger durable syncs.
 * When Vibe SSE events indicate task changes, call this to sync to Huly.
 */
export declare function scheduleVibeSSEChange(input: VibeSSEChangeInput): Promise<{
    workflowId: string;
    runId: string;
}>;
/**
 * Execute a Vibe SSE change workflow and wait for result
 */
export declare function executeVibeSSEChange(input: VibeSSEChangeInput): Promise<VibeSSEChangeResult>;
/**
 * Schedule a Huly webhook change workflow (fire and forget)
 *
 * Processes Huly webhook change events and syncs to Vibe/Beads.
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