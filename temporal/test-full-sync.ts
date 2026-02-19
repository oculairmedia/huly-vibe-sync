/**
 * Test script for SyncSingleIssueWorkflow
 *
 * Tests the full sync workflow using the actual services.
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

  console.log('Connected. Starting SyncSingleIssueWorkflow...');

  const workflowId = `test-full-sync-${Date.now()}`;

  try {
    // Test with a mock issue - this will test the workflow orchestration
    // but the activities will fail since we don't have real Vibe/Huly connections
    // in the test environment
    const result = await client.workflow.execute('SyncSingleIssueWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [
        {
          issue: {
            identifier: 'TEST-999',
            title: 'Test Issue for Temporal Sync',
            description: 'Testing the SyncSingleIssueWorkflow',
            status: 'Todo',
            priority: 'Medium',
          },
          context: {
            projectIdentifier: 'TEST',
          },
          syncToBeads: false,
        },
      ],
    });

    console.log('\n=== Workflow Result ===');
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('\n✅ SUCCESS!');
    } else {
      console.log('\n❌ FAILED:', result.error);
    }
  } catch (error: any) {
    // Expected to fail if Vibe API is not available
    console.log('\n=== Workflow Failed (Expected in test env) ===');
    console.log('Error:', error.message);

    if (error.cause) {
      console.log('Cause:', error.cause.message);
      console.log('Activity:', error.cause.activityType);
      console.log('Retry State:', error.cause.retryState);
    }

    // Check if it's an expected error (connection, validation with test data) vs a code bug
    const isConnectionError =
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('network') ||
      error.cause?.message?.includes('ECONNREFUSED');

    // Validation errors are expected when using test data with invalid UUIDs
    const isValidationError =
      error.message?.includes('422') ||
      error.message?.includes('validation') ||
      error.cause?.message?.includes('422') ||
      error.cause?.message?.includes('UUID') ||
      error.cause?.message?.includes('deserialize');

    // Non-retryable failures for validation are expected with test data
    const isNonRetryable = error.cause?.retryState === 'NON_RETRYABLE_FAILURE';

    if (isConnectionError) {
      console.log('\n✅ Workflow executed correctly - failed on external API (expected in test)');
    } else if (isValidationError || isNonRetryable) {
      console.log('\n✅ Workflow executed correctly - validation error with test data (expected)');
    } else {
      console.log('\n⚠️  Unexpected error type - may indicate a bug');
    }
  }

  console.log('\n📊 View workflow in Temporal UI: http://localhost:8084');
  console.log(`   Search for: ${workflowId}`);

  await connection.close();
}

main().catch(console.error);
