/**
 * Temporal Worker for VibeSync
 *
 * Registers workflows and activities, polls for tasks.
 * Run with: npx ts-node temporal/worker.ts
 */

import { Worker, NativeConnection } from '@temporalio/worker';
import * as lettaActivities from './activities/letta';
import * as issueSyncActivities from './activities/issue-sync';
import * as syncServiceActivities from './activities/sync-services';
import * as bidirectionalActivities from './activities/bidirectional';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'vibesync-queue';

// Merge all activities
const activities = {
  ...lettaActivities,
  ...issueSyncActivities,
  ...syncServiceActivities,
  ...bidirectionalActivities,
};

async function run() {
  console.log(`[Worker] Connecting to Temporal at ${TEMPORAL_ADDRESS}`);

  // Connect to Temporal server
  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  // Create worker
  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows/index'),
    activities,
  });

  console.log(`[Worker] Started on task queue: ${TASK_QUEUE}`);
  console.log(`[Worker] Registered workflows: MemoryUpdateWorkflow, BatchMemoryUpdateWorkflow, IssueSyncWorkflow, BatchIssueSyncWorkflow, SyncSingleIssueWorkflow, SyncProjectWorkflow, SyncVibeToHulyWorkflow, BidirectionalSyncWorkflow, SyncFromVibeWorkflow, SyncFromHulyWorkflow, SyncFromBeadsWorkflow`);
  console.log(`[Worker] Registered activities: ${Object.keys(activities).join(', ')}`);

  // Run until interrupted
  await worker.run();
}

run().catch((err) => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});
