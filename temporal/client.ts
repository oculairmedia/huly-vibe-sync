/**
 * Temporal Client for VibeSync — Facade
 *
 * Re-exports all client functions from sub-modules in temporal/client/.
 *
 * Usage:
 *   import { scheduleMemoryUpdate, scheduleBatchMemoryUpdate } from './temporal/client';
 */

export {
  // Connection & utilities
  isTemporalEnabled,
  isTemporalAvailable,
  // Memory update
  scheduleMemoryUpdate,
  scheduleBatchMemoryUpdate,
  executeMemoryUpdate,
  getWorkflowStatus,
  cancelWorkflow,
  listRecentWorkflows,
  getFailedWorkflows,
  // Issue sync
  scheduleIssueSync,
  executeIssueSync,
  scheduleBatchIssueSync,
  // Full sync
  scheduleSingleIssueSync,
  executeSingleIssueSync,
  scheduleProjectSync,
  scheduleFullSync,
  executeFullSync,
  getFullSyncProgress,
  cancelFullSync,
  listSyncWorkflows,
  // Schedule management
  startScheduledSync,
  getActiveScheduledSync,
  stopScheduledSync,
  restartScheduledSync,
  isScheduledSyncActive,
  // Reconciliation
  executeDataReconciliation,
  startScheduledReconciliation,
  getActiveScheduledReconciliation,
  stopScheduledReconciliation,
  // Agent provisioning
  startAgentProvisioning,
  executeAgentProvisioning,
  getProvisioningProgress,
  cancelProvisioning,
  provisionSingleAgent,
  cleanupFailedProvisions,
  // Beads sync
  scheduleBeadsSync,
  executeBeadsSync,
  scheduleBatchBeadsSync,
  scheduleBeadsFileChange,
  executeBeadsFileChange,
  // Event triggers
  scheduleHulyWebhookChange,
  executeHulyWebhookChange,
} from './client/index';

// Re-export types
export type {
  ReconciliationAction,
  DataReconciliationInput,
  DataReconciliationResult,
  ProvisioningInput,
  ProvisioningResult,
  ProvisioningProgress,
  BeadsSyncInput,
} from './client/index';
