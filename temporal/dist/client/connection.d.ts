/**
 * Temporal Client Connection
 *
 * Shared singleton client instance and utility helpers.
 */
import { Client } from '@temporalio/client';
export declare const TEMPORAL_ADDRESS: string;
export declare const TASK_QUEUE: string;
/**
 * Get or create the Temporal client instance
 */
export declare function getClient(): Promise<Client>;
/**
 * Check if Temporal is enabled via feature flag
 */
export declare function isTemporalEnabled(): boolean;
/**
 * Check if Temporal is available (can connect)
 */
export declare function isTemporalAvailable(): Promise<boolean>;
//# sourceMappingURL=connection.d.ts.map