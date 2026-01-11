/**
 * Temporal Integration for VibeSync
 *
 * Main entry point for Temporal workflow integration.
 *
 * Usage in VibeSync:
 *
 *   import {
 *     scheduleMemoryUpdate,
 *     scheduleBatchMemoryUpdate,
 *     getFailedWorkflows,
 *   } from './temporal';
 *
 *   // After sync, schedule memory updates via Temporal
 *   for (const agent of agentsToUpdate) {
 *     await scheduleMemoryUpdate({
 *       agentId: agent.id,
 *       blockLabel: 'board_metrics',
 *       newValue: JSON.stringify(metrics),
 *       source: 'vibesync-sync',
 *     });
 *   }
 *
 *   // Check for failures that need attention
 *   const failed = await getFailedWorkflows();
 *   if (failed.length > 0) {
 *     console.log(`${failed.length} memory updates need attention`);
 *   }
 */

// Client functions for triggering workflows
export {
  scheduleMemoryUpdate,
  scheduleBatchMemoryUpdate,
  executeMemoryUpdate,
  getWorkflowStatus,
  cancelWorkflow,
  listRecentWorkflows,
  getFailedWorkflows,
} from './client';

// Workflow types
export type {
  MemoryUpdateInput,
  MemoryUpdateResult,
  BatchMemoryUpdateInput,
  BatchMemoryUpdateResult,
} from './workflows/memory-update';
