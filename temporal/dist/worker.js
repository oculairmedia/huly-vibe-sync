"use strict";
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
const orchestrationActivities = __importStar(require("./activities/orchestration"));
const agentProvisioningActivities = __importStar(require("./activities/agent-provisioning"));
const reconciliationActivities = __importStar(require("./activities/reconciliation"));
const syncDatabaseActivities = __importStar(require("./activities/sync-database"));
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'vibesync-queue';
const activities = {
    ...lettaActivities,
    ...issueSyncActivities,
    ...syncServiceActivities,
    ...orchestrationActivities,
    ...agentProvisioningActivities,
    ...reconciliationActivities,
    ...syncDatabaseActivities,
};
async function run() {
    console.log(`[Worker] Connecting to Temporal at ${TEMPORAL_ADDRESS}`);
    const connection = await worker_1.NativeConnection.connect({
        address: TEMPORAL_ADDRESS,
    });
    const worker = await worker_1.Worker.create({
        connection,
        namespace: 'default',
        taskQueue: TASK_QUEUE,
        workflowsPath: require.resolve('./workflows/index'),
        activities,
        maxConcurrentWorkflowTaskExecutions: 10,
        maxConcurrentActivityTaskExecutions: 5,
        maxConcurrentWorkflowTaskPolls: 2,
        maxConcurrentActivityTaskPolls: 2,
    });
    console.log(`[Worker] Started on task queue: ${TASK_QUEUE}`);
    console.log(`[Worker] Registered activities: ${Object.keys(activities).join(', ')}`);
    await worker.run();
}
run().catch(err => {
    console.error('[Worker] Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=worker.js.map