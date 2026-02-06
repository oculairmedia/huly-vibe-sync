/**
 * Temporal Client — Barrel Export
 *
 * Re-exports all client functions from sub-modules.
 */

// Connection & utilities
export { getClient, isTemporalEnabled, isTemporalAvailable, TASK_QUEUE } from './connection';

// Memory update workflows
export {
  scheduleMemoryUpdate,
  scheduleBatchMemoryUpdate,
  executeMemoryUpdate,
  getWorkflowStatus,
  cancelWorkflow,
  listRecentWorkflows,
  getFailedWorkflows,
} from './memory-update';

// Issue sync workflows
export { scheduleIssueSync, executeIssueSync, scheduleBatchIssueSync } from './issue-sync';

// Full sync workflows
export {
  scheduleSingleIssueSync,
  executeSingleIssueSync,
  scheduleProjectSync,
  scheduleVibeToHulySync,
  scheduleFullSync,
  executeFullSync,
  getFullSyncProgress,
  cancelFullSync,
  listSyncWorkflows,
} from './full-sync';

// Schedule management
export {
  startScheduledSync,
  getActiveScheduledSync,
  stopScheduledSync,
  restartScheduledSync,
  isScheduledSyncActive,
} from './schedule';

// Reconciliation
export type { ReconciliationAction, DataReconciliationInput, DataReconciliationResult } from './reconciliation';
export {
  executeDataReconciliation,
  startScheduledReconciliation,
  getActiveScheduledReconciliation,
  stopScheduledReconciliation,
} from './reconciliation';

// Agent provisioning
export type { ProvisioningInput, ProvisioningResult, ProvisioningProgress } from './agent-provisioning';
export {
  startAgentProvisioning,
  executeAgentProvisioning,
  getProvisioningProgress,
  cancelProvisioning,
  provisionSingleAgent,
  cleanupFailedProvisions,
} from './agent-provisioning';

// Beads sync
export type { BeadsSyncInput } from './beads-sync';
export {
  scheduleBeadsSync,
  executeBeadsSync,
  scheduleBatchBeadsSync,
  scheduleBeadsFileChange,
  executeBeadsFileChange,
} from './beads-sync';

// Event triggers
export {
  scheduleVibeSSEChange,
  executeVibeSSEChange,
  scheduleHulyWebhookChange,
  executeHulyWebhookChange,
} from './event-triggers';
