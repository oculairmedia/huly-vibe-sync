/**
 * Test script for SyncSingleIssueWorkflow with REAL data
 *
 * Uses actual Vibe project ID for proper end-to-end testing.
 */

import { Client, Connection } from '@temporalio/client';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = 'vibesync-queue';

async function main() {
  console.log(`Connecting to Temporal at ${TEMPORAL_ADDRESS}...`);

  const connection = await Connection.connect({
    address: TEMPORAL_ADDRESS,
  });

  const client = new Client({ connection });

  console.log('Connected. Starting SyncSingleIssueWorkflow with REAL project...');

  const workflowId = `test-real-sync-${Date.now()}`;

  try {
    const result = await client.workflow.execute('SyncSingleIssueWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [
        {
          issue: {
            identifier: 'VIBESYNC-TEST',
            title: 'Temporal Integration Test',
            description: 'Testing the SyncSingleIssueWorkflow with real Vibe API',
            status: 'Todo',
            priority: 'Medium',
          },
          context: {
            projectIdentifier: 'VIBESYNC',
          },
          syncToBeads: false,
        },
      ],
    });

    console.log('\n=== Workflow Result ===');
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('\n✅ SUCCESS! Task synced to Vibe.');
      if (result.vibeResult?.id) {
        console.log(`   Task ID: ${result.vibeResult.id}`);
      }
      if (result.vibeResult?.skipped) {
        console.log('   (Task already existed - skipped creation)');
      }
      if (result.vibeResult?.created) {
        console.log('   (New task created)');
      }
    } else {
      console.log('\n❌ FAILED:', result.error);
    }
  } catch (error: any) {
    console.log('\n=== Workflow Failed ===');
    console.log('Error:', error.message);

    if (error.cause) {
      console.log('Cause:', error.cause.message);
      console.log('Activity:', error.cause.activityType);
      console.log('Retry State:', error.cause.retryState);
    }
  }

  console.log('\n📊 View workflow in Temporal UI: http://localhost:8084');
  console.log(`   Search for: ${workflowId}`);

  await connection.close();
}

main().catch(console.error);
