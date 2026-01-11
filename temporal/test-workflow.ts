/**
 * Test script for MemoryUpdateWorkflow
 *
 * Run with: npx ts-node --esm temporal/test-workflow.ts
 */

import { Client, Connection } from '@temporalio/client';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = 'vibesync-queue';

// Test with VibeSync agent
const TEST_AGENT_ID = 'agent-b417b8da-84d2-40dd-97ad-3a35454934f7';
const TEST_BLOCK_LABEL = 'persona'; // Test with persona block
const TEST_VALUE = `[Temporal POC Test - ${new Date().toISOString()}]\n\nThis is a test update from the Temporal workflow POC to validate the Letta SDK integration.`;

async function main() {
  console.log(`Connecting to Temporal at ${TEMPORAL_ADDRESS}...`);

  const connection = await Connection.connect({
    address: TEMPORAL_ADDRESS,
  });

  const client = new Client({ connection });

  console.log('Connected. Starting workflow...');

  const workflowId = `test-memory-update-${Date.now()}`;

  try {
    // Start workflow and wait for result
    const result = await client.workflow.execute('MemoryUpdateWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [{
        agentId: TEST_AGENT_ID,
        blockLabel: TEST_BLOCK_LABEL,
        newValue: TEST_VALUE,
        source: 'test-script',
      }],
    });

    console.log('\n=== Workflow Result ===');
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('\n✅ SUCCESS! Workflow completed successfully.');
      console.log(`   Agent: ${result.agentId}`);
      console.log(`   Block: ${result.blockLabel}`);
      console.log(`   Attempts: ${result.attempts}`);
    } else {
      console.log('\n❌ FAILED! Workflow completed with error.');
      console.log(`   Error: ${result.error}`);
      console.log(`   Attempts: ${result.attempts}`);
    }

  } catch (error) {
    console.error('\n❌ Workflow execution failed:', error);
  }

  // Check Temporal UI
  console.log('\n📊 View workflow in Temporal UI: http://localhost:8084');
  console.log(`   Search for: ${workflowId}`);

  await connection.close();
}

main().catch(console.error);
