"use strict";
/**
 * Temporal Client Connection
 *
 * Shared singleton client instance and utility helpers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_QUEUE = exports.TEMPORAL_ADDRESS = void 0;
exports.getClient = getClient;
exports.isTemporalEnabled = isTemporalEnabled;
exports.isTemporalAvailable = isTemporalAvailable;
const client_1 = require("@temporalio/client");
exports.TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
exports.TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'vibesync-queue';
let clientInstance = null;
/**
 * Get or create the Temporal client instance
 */
async function getClient() {
    if (!clientInstance) {
        const connection = await client_1.Connection.connect({
            address: exports.TEMPORAL_ADDRESS,
        });
        clientInstance = new client_1.Client({ connection });
    }
    return clientInstance;
}
/**
 * Check if Temporal is enabled via feature flag
 */
function isTemporalEnabled() {
    return process.env.USE_TEMPORAL_SYNC === 'true';
}
/**
 * Check if Temporal is available (can connect)
 */
async function isTemporalAvailable() {
    try {
        await getClient();
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=connection.js.map