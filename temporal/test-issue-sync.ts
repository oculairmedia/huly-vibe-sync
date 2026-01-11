/**
 * Test script for IssueSyncWorkflow
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

  console.log('Connected. Starting IssueSyncWorkflow...');

  const workflowId = `test-issue-sync-${Date.now()}`;

  try {
    const result = await client.workflow.execute('IssueSyncWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [{
        issue: {
          identifier: 'TEST-001',
          title: 'Test Issue from Temporal',
          description: 'This is a test issue created via Temporal workflow',
          status: 'Todo',
          priority: 'Medium',
          projectId: 'test-project',
          projectIdentifier: 'TEST',
        },
        operation: 'create',
        source: 'huly',  // Pretend it came from Huly, so it syncs to Vibe
      }],
    });

    console.log('\n=== Workflow Result ===');
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('\n✅ SUCCESS! IssueSyncWorkflow completed.');
      console.log(`   Huly: ${result.hulyResult?.success ? 'skipped (source)' : 'synced'}`);
      console.log(`   Vibe: ${result.vibeResult?.success ? 'synced' : 'failed'}`);
      console.log(`   Beads: ${result.beadsResult?.success ? 'synced' : 'skipped'}`);
    } else {
      console.log('\n❌ FAILED!');
      console.log(`   Error: ${result.error}`);
    }

  } catch (error) {
    console.error('\n❌ Workflow execution failed:', error);
  }

  console.log('\n📊 View workflow in Temporal UI: http://localhost:8084');
  console.log(`   Search for: ${workflowId}`);

  await connection.close();
}

main().catch(console.error);
