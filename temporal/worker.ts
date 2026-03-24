import { Worker, NativeConnection } from '@temporalio/worker';
import * as lettaActivities from './activities/letta';
import * as issueSyncActivities from './activities/issue-sync';
import * as syncServiceActivities from './activities/sync-services';
import * as orchestrationActivities from './activities/orchestration';
import * as agentProvisioningActivities from './activities/agent-provisioning';
import * as reconciliationActivities from './activities/reconciliation';
import * as syncDatabaseActivities from './activities/sync-database';

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

  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
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
