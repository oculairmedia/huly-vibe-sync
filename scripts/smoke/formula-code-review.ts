#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
import { LettaClient } from '@letta-ai/letta-client';
import * as teamsSdk from 'letta-teams-sdk';

import { LettaTeamsBackendConfig } from '../../src/letta/LettaTeamsBackendConfig.js';
import { auditTeammateState } from '../../src/letta/TeammateDriftAuditor.js';
import { bootOrchestrationPlane } from '../../src/orchestration/boot.js';
import type { Event } from '../../src/orchestration/events/index.js';
import { loadPack } from '../../src/orchestration/packs/index.js';
import { DoltClient } from '../../src/orchestration/store/index.js';

const LOG_PATH = '/tmp/formula-smoke.log';
const BEADS_ROOT = '/opt/stacks/vibesync';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function log(message: string, color = ''): void {
  const clean = message.replace(/\x1b\[[0-9;]*m/g, '');
  writeFileSync(LOG_PATH, `${clean}\n`, { flag: 'a' });
  process.stdout.write(`${color}${message}${RESET}\n`);
}

function step(label: string): void {
  log(`\n=== ${label} ===`, CYAN);
}

async function main(): Promise<void> {
  writeFileSync(LOG_PATH, 'formula-code-review smoke\n');
  const backend = new LettaTeamsBackendConfig();
  backend.applyToProcessEnv();
  const client = new LettaClient({ baseUrl: backend.baseUrl, token: backend.apiKey });
  const dolt = new DoltClient({ beadsRoot: BEADS_ROOT });
  const handle = await bootOrchestrationPlane({ dolt, persistEvents: false, runDriftAuditOnBoot: false });
  const events: Event[] = [];
  const unsubscribe = handle.bus.subscribe((event) => {
    events.push(event);
    log(`bus [${event.layer}] ${event.kind} ${JSON.stringify({ molecule_id: event.molecule_id, task_id: event.task_id, teammate: event.teammate, payload: event.payload })}`, DIM);
  });

  let moleculeId = '';
  const agentIdsToDelete = new Set<string>();
  try {
    step('1. load gastown code-review formula');
    const pack = loadPack('packs/gastown', 'project');
    const formula = pack.formulas.find((candidate) => candidate.name === 'code-review');
    if (!formula) throw new Error('code-review formula missing from gastown pack');
    log(`formula: ${formula.name} steps=${formula.steps.map((s) => s.role).join(' → ')}`, GREEN);

    step('2. run dispatcher through booted orchestration plane');
    const result = await handle.dispatcher.run({
      formula,
      pack,
      input: 'review this change: a one-line console.log was added to src/index.ts; produce concise review, fix, and verification notes.',
      motivatingBeadId: 'formula-smoke',
    });
    moleculeId = result.moleculeId;
    log(`moleculeId: ${moleculeId}`, GREEN);
    log(`outputs: ${Object.keys(result.outputs).join(', ')}`, GREEN);

    step('3. verify dispatcher event sequence');
    const kinds = events.filter((event) => event.molecule_id === moleculeId).map((event) => event.kind);
    expectOne(kinds, 'dispatcher/formula.started');
    expectOne(kinds, 'dispatcher/formula.completed');
    const stepStarted = kinds.filter((kind) => kind === 'dispatcher/step.started');
    const stepFinished = kinds.filter((kind) => kind === 'dispatcher/step.finished');
    if (stepStarted.length !== 3 || stepFinished.length !== 3) {
      throw new Error(`expected 3 started/finished pairs; got ${stepStarted.length}/${stepFinished.length}`);
    }
    log(`events: ${kinds.join(', ')}`, GREEN);

    step('4. verify molecule persisted closed steps with outputs');
    const view = await handle.walker.load(moleculeId);
    if (!view) throw new Error(`walker.load(${moleculeId}) returned null`);
    const openSteps = view.steps.filter((row) => row.status !== 'closed');
    if (openSteps.length > 0) throw new Error(`steps not closed: ${openSteps.map((row) => row.id).join(', ')}`);
    for (const row of view.steps) {
      const exec = readExec(row);
      const output = readOutput(exec.output_payload);
      if (!output) throw new Error(`step ${row.id} has empty exec.output`);
    }
    log(`molecule steps closed: ${view.steps.length}`, GREEN);

    step('5. verify role TOML memory blocks reached each server-side agent');
    const runtime = teamsSdk.getTeamsRuntime();
    for (const stepSpec of formula.steps) {
      const target = `${moleculeId}-${stepSpec.role}`;
      const agents = await client.agents.list({ name: target, limit: 20 });
      const agent = agents.find((candidate) => candidate.name === target);
      if (!agent?.id) throw new Error(`server-side agent ${target} not found`);
      agentIdsToDelete.add(agent.id);
      const role = pack.roles.find((candidate) => candidate.name === stepSpec.role);
      const expectedLabels = new Set((role?.memoryBlocks ?? []).map((block) => block.label));
      const blocks = await client.agents.blocks.list(agent.id, { limit: 200 });
      const labels = new Set(blocks.map((block) => block.label).filter((label): label is string => typeof label === 'string'));
      const missing = [...expectedLabels].filter((label) => !labels.has(label));
      if (missing.length > 0) throw new Error(`${target} missing memory blocks: ${missing.join(', ')}`);
      log(`${target}: agent=${agent.id} memoryLabels=${[...expectedLabels].join(', ')}`, GREEN);

      const local = { async listLocal() { return [{ name: target, agentId: agent.id! }]; } };
      const server = { async listAgents() { return [{ id: agent.id!, name: target }]; } };
      const audit = await auditTeammateState({ local, server: server });
      if (audit.findings.length > 0) throw new Error(`drift findings for ${target}: ${JSON.stringify(audit.findings)}`);
      void runtime;
    }

    step('6. cleanup server-side agents');
    for (const agentId of agentIdsToDelete) {
      try {
        await client.agents.delete(agentId);
        log(`deleted agent ${agentId}`, GREEN);
      } catch (error) {
        log(`failed to delete agent ${agentId}: ${(error as Error).message}`, YELLOW);
      }
    }

    step('7. pass-criteria summary');
    log('✓ dispatcher/formula.started and dispatcher/formula.completed fired once', GREEN);
    log('✓ three dispatcher step started/finished pairs observed', GREEN);
    log('✓ all molecule steps closed with non-empty output', GREEN);
    log('✓ role memory blocks present on server-side agents', GREEN);
    log(`results captured in ${LOG_PATH}`, GREEN);
  } finally {
    unsubscribe();
    await cleanupMoleculeRows(dolt, moleculeId);
    await handle.shutdown();
    await dolt.close();
  }
}

function expectOne(kinds: readonly string[], kind: string): void {
  const count = kinds.filter((candidate) => candidate === kind).length;
  if (count !== 1) throw new Error(`expected exactly one ${kind}, got ${count}`);
}

function readExec(row: { readonly metadata: Record<string, unknown> }): Record<string, unknown> {
  const exec = row.metadata.exec;
  return exec && typeof exec === 'object' ? exec as Record<string, unknown> : {};
}

function readOutput(outputPayload: unknown): string {
  if (!outputPayload || typeof outputPayload !== 'object') return String(outputPayload ?? '');
  const output = (outputPayload as { readonly output?: unknown }).output;
  return typeof output === 'string' ? output : JSON.stringify(output ?? '');
}

async function cleanupMoleculeRows(dolt: DoltClient, moleculeId: string): Promise<void> {
  if (!moleculeId) return;
  try {
    const pool = (dolt as unknown as { readonly pool: { execute(query: string, params: readonly unknown[]): Promise<unknown> } }).pool;
    await pool.execute('DELETE FROM dependencies WHERE issue_id LIKE ? OR depends_on_id LIKE ?', [`${moleculeId}%`, `${moleculeId}%`]);
    await pool.execute('DELETE FROM issues WHERE id LIKE ?', [`${moleculeId}%`]);
  } catch (error) {
    log(`molecule row cleanup failed: ${(error as Error).message}`, YELLOW);
  }
}

async function runDaemon(): Promise<void> {
  const runtime = teamsSdk.getTeamsRuntime();
  await runtime.daemon.runInternal();
}

if (process.argv[2] === 'daemon' && process.argv[3] === '--internal') {
  await runDaemon();
} else {
  main().catch((error) => {
    log(`\nSMOKE TEST FAILED: ${(error as Error).message}`, RED);
    process.exitCode = 1;
  });
}
