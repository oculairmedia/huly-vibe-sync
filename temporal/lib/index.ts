/**
 * TypeScript Client Library for VibeSync Temporal Activities
 *
 * Re-exports all clients and utilities for easy importing.
 */

// Clients
export { HulyClient, createHulyClient } from './HulyClient';
export type { HulyProject, HulyIssue, CreateIssueInput, HulyClientOptions } from './HulyClient';

export { BeadsClient, createBeadsClient } from './BeadsClient';
export type { BeadsIssue, CreateBeadsIssueInput, BeadsClientOptions } from './BeadsClient';

// Status mapping
export {
  mapHulyStatusToBeads,
  mapHulyStatusToBeadsSimple,
  mapBeadsStatusToHuly,
  mapHulyPriorityToBeads,
  mapBeadsPriorityToHuly,
  normalizeStatus,
  getHulyStatusLabels,
} from './statusMapper';
export type { BeadsStatus, BeadsStatusWithLabel } from './statusMapper';
