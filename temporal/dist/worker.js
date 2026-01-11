"use strict";
/**
 * Temporal Worker for VibeSync
 *
 * Registers workflows and activities, polls for tasks.
 * Run with: npx ts-node temporal/worker.ts
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const worker_1 = require("@temporalio/worker");
const lettaActivities = __importStar(require("./activities/letta"));
const issueSyncActivities = __importStar(require("./activities/issue-sync"));
const syncServiceActivities = __importStar(require("./activities/sync-services"));
const bidirectionalActivities = __importStar(require("./activities/bidirectional"));
const orchestrationActivities = __importStar(require("./activities/orchestration"));
const agentProvisioningActivities = __importStar(require("./activities/agent-provisioning"));
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'vibesync-queue';
// Merge all activities
const activities = {
    ...lettaActivities,
    ...issueSyncActivities,
    ...syncServiceActivities,
    ...bidirectionalActivities,
    ...orchestrationActivities,
    ...agentProvisioningActivities,
};
async function run() {
    console.log(`[Worker] Connecting to Temporal at ${TEMPORAL_ADDRESS}`);
    // Connect to Temporal server
    const connection = await worker_1.NativeConnection.connect({
        address: TEMPORAL_ADDRESS,
    });
    // Create worker
    const worker = await worker_1.Worker.create({
        connection,
        namespace: 'default',
        taskQueue: TASK_QUEUE,
        workflowsPath: require.resolve('./workflows/index'),
        activities,
    });
    console.log(`[Worker] Started on task queue: ${TASK_QUEUE}`);
    console.log(`[Worker] Registered workflows: MemoryUpdateWorkflow, BatchMemoryUpdateWorkflow, IssueSyncWorkflow, BatchIssueSyncWorkflow, SyncSingleIssueWorkflow, SyncProjectWorkflow, SyncVibeToHulyWorkflow, BidirectionalSyncWorkflow, SyncFromVibeWorkflow, SyncFromHulyWorkflow, SyncFromBeadsWorkflow, BeadsFileChangeWorkflow, VibeSSEChangeWorkflow, HulyWebhookChangeWorkflow, FullOrchestrationWorkflow, ScheduledSyncWorkflow, ProjectSyncWorkflow, ProvisionAgentsWorkflow, ProvisionSingleAgentWorkflow, CleanupFailedProvisionsWorkflow`);
    console.log(`[Worker] Registered activities: ${Object.keys(activities).join(', ')}`);
    // Run until interrupted
    await worker.run();
}
run().catch((err) => {
    console.error('[Worker] Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=worker.js.map