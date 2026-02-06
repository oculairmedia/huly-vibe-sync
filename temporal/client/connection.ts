/**
 * Temporal Client Connection
 *
 * Shared singleton client instance and utility helpers.
 */

import { Client, Connection } from '@temporalio/client';

export const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
export const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'vibesync-queue';

let clientInstance: Client | null = null;

/**
 * Get or create the Temporal client instance
 */
export async function getClient(): Promise<Client> {
  if (!clientInstance) {
    const connection = await Connection.connect({
      address: TEMPORAL_ADDRESS,
    });
    clientInstance = new Client({ connection });
  }
  return clientInstance;
}

/**
 * Check if Temporal is enabled via feature flag
 */
export function isTemporalEnabled(): boolean {
  return process.env.USE_TEMPORAL_SYNC === 'true';
}

/**
 * Check if Temporal is available (can connect)
 */
export async function isTemporalAvailable(): Promise<boolean> {
  try {
    await getClient();
    return true;
  } catch {
    return false;
  }
}
