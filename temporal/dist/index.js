"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFailedWorkflows = exports.listRecentWorkflows = exports.cancelWorkflow = exports.getWorkflowStatus = exports.executeMemoryUpdate = exports.scheduleBatchMemoryUpdate = exports.scheduleMemoryUpdate = void 0;
// Client functions for triggering workflows
var client_1 = require("./client");
Object.defineProperty(exports, "scheduleMemoryUpdate", { enumerable: true, get: function () { return client_1.scheduleMemoryUpdate; } });
Object.defineProperty(exports, "scheduleBatchMemoryUpdate", { enumerable: true, get: function () { return client_1.scheduleBatchMemoryUpdate; } });
Object.defineProperty(exports, "executeMemoryUpdate", { enumerable: true, get: function () { return client_1.executeMemoryUpdate; } });
Object.defineProperty(exports, "getWorkflowStatus", { enumerable: true, get: function () { return client_1.getWorkflowStatus; } });
Object.defineProperty(exports, "cancelWorkflow", { enumerable: true, get: function () { return client_1.cancelWorkflow; } });
Object.defineProperty(exports, "listRecentWorkflows", { enumerable: true, get: function () { return client_1.listRecentWorkflows; } });
Object.defineProperty(exports, "getFailedWorkflows", { enumerable: true, get: function () { return client_1.getFailedWorkflows; } });
//# sourceMappingURL=index.js.map