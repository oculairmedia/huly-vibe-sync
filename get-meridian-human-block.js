#!/usr/bin/env node
import { createLettaService } from './lib/LettaService.js';
import dotenv from 'dotenv';
dotenv.config();

const lettaService = createLettaService();

async function main() {
  const meridianId = 'agent-597b5756-2915-4560-ba6b-91005f085166';
  const blocks = await lettaService.client.agents.blocks.list(meridianId);
  const humanBlock = blocks.find(b => b.label === 'human');

  if (humanBlock) {
    console.log('='.repeat(80));
    console.log('MERIDIAN HUMAN BLOCK');
    console.log('='.repeat(80));
    console.log(humanBlock.value);
    console.log('='.repeat(80));
    console.log(`Block ID: ${humanBlock.id}`);
  } else {
    console.log('Human block not found');
  }
}

main().catch(console.error);
