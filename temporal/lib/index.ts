/**
 * TypeScript Client Library for VibeSync Temporal Activities
 *
 * Re-exports all clients and utilities for easy importing.
 */

// Clients
export { VibeClient, createVibeClient } from './VibeClient';
export type { VibeProject, VibeTask, CreateTaskInput, VibeClientOptions } from './VibeClient';

export { HulyClient, createHulyClient } from './HulyClient';
export type { HulyProject, HulyIssue, CreateIssueInput, HulyClientOptions } from './HulyClient';

export { BeadsClient, createBeadsClient } from './BeadsClient';
export type { BeadsIssue, CreateBeadsIssueInput, BeadsClientOptions } from './BeadsClient';

// Status mapping
export {
  mapHulyStatusToVibe,
  mapVibeStatusToHuly,
  mapHulyStatusToBeads,
  mapHulyStatusToBeadsSimple,
  mapBeadsStatusToHuly,
  mapBeadsStatusToVibe,
  mapHulyPriorityToBeads,
  mapBeadsPriorityToHuly,
  normalizeStatus,
  areStatusesEquivalent,
  getHulyStatusLabels,
} from './statusMapper';
export type { VibeStatus, BeadsStatus, BeadsStatusWithLabel } from './statusMapper';
