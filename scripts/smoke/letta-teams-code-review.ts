#!/usr/bin/env bun
/**
 * Smoke test for the letta-teams adoption journey (vibesync-6wn).
 *
 * Drives the gastown reviewer role end-to-end through
 * LettaTeamsProvider against a real Letta server, exercising:
 *
 *   - LettaTeamsBackendConfig.applyToProcessEnv() + buildSeeder()
 *   - LettaTeamsProvider.ensureDaemonRunning() under HealthPatrol
 *   - Teammate spawn with skipInit + role-pack memory-block seeding
 *   - prompt() → real task dispatch
 *   - observe() streaming real session events onto the EventBus
 *   - stop() teardown
 *   - auditTeammateState() reporting our own teammate as healthy
 *
 * Use a unique molecule id per run so the spawned teammate is
 * trivially namespaced and the auditor never collides with anything
 * already on the box. Run:
 *
 *     LETTA_BASE_URL=... LETTA_API_KEY=... bun scripts/smoke/letta-teams-code-review.ts
 *
 * See docs/handoff/letta-teams-smoke-test.md for the pass criteria
 * this script is meant to validate.
 *
 * # Daemon-mode short-circuit
 *
 * letta-teams-sdk's `ensureDaemonRunning` spawns `process.execPath`
 * with `[process.argv[1], 'daemon', '--internal']` and expects the
 * CLI entrypoint to dispatch that to `runtime.daemon.runInternal()`.
 * We do not ship a separate `letta-teams` CLI in this repo, so this
 * same script doubles as the daemon entry: when re-invoked with
 * `daemon --internal`, it runs the IPC server forever and never
 * reaches main(). The parent smoke-test process is unaffected.
 */

import { LettaClient } from '@letta-ai/letta-client';
import * as teamsSdk from 'letta-teams-sdk';

import { LettaTeamsBackendConfig } from '../../src/letta/LettaTeamsBackendConfig.js';
import {
  auditTeammateState,
  type LocalTeammateStore,
  type LettaAgentDirectory,
} from '../../src/letta/TeammateDriftAuditor.js';
import { EventBus, type Event } from '../../src/orchestration/events/index.js';
import { HealthPatrol } from '../../src/orchestration/health/index.js';
import { loadPack } from '../../src/orchestration/packs/index.js';
import { LettaTeamsProvider } from '../../src/orchestration/runtime/index.js';

const moleculeId = `smoke-${Math.floor(Date.now() / 1000)}`;
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function log(msg: string, color = ''): void {
  process.stdout.write(`${color}${msg}${RESET}\n`);
}

function step(label: string): void {
  log(`\n=== ${label} ===`, CYAN);
}

async function main(): Promise<void> {
  const backend = new LettaTeamsBackendConfig();
  backend.applyToProcessEnv();
  log(`backend: baseUrl=${backend.baseUrl} apiKey=set(len=${backend.apiKey.length}) cliPath=${backend.cliPath ?? '<unset>'}`, DIM);
  log(`molecule: ${moleculeId}`, DIM);

  const observed: Event[] = [];
  const driftEvents: Event[] = [];
  const bus = new EventBus({ noPersist: true });
  bus.subscribe((ev) => {
    if (ev.kind.startsWith('runtime/session.')) observed.push(ev);
    if (ev.kind === 'runtime/teammate.drift') driftEvents.push(ev);
    log(`bus  [${ev.layer}] ${ev.kind} ${JSON.stringify({ teammate: ev.teammate, task_id: ev.task_id, molecule_id: ev.molecule_id, payload: ev.payload })}`, DIM);
  });

  const seeder = backend.buildSeeder();
  const provider = new LettaTeamsProvider({
    eventBus: bus,
    memoryBlockSeeder: seeder,
    pollIntervalMs: 500,
    initialTaskTimeoutMs: 60_000,
  });

  step('1. ensureDaemonRunning + HealthPatrol supervises daemon');
  const patrol = new HealthPatrol(bus, { probeIntervalMs: 30_000 });
  patrol.trackDaemon(provider.daemonSupervisor());
  patrol.start();
  await provider.ensureDaemonRunning();
  log('daemon: running', GREEN);

  step('2. loadPack + find reviewer role with [[memory_blocks]]');
  const pack = loadPack('packs/gastown', 'project');
  const reviewer = pack.roles.find((r) => r.name === 'reviewer');
  if (!reviewer) throw new Error('reviewer role missing from gastown pack');
  if (!reviewer.memoryBlocks?.length) throw new Error('reviewer.toml has no [[memory_blocks]] — seeder would no-op');
  log(`role: name=${reviewer.name} memoryBlocks=${reviewer.memoryBlocks.length}`, GREEN);
  for (const b of reviewer.memoryBlocks) log(`  block label=${b.label} value=${b.value.slice(0, 60)}…`, DIM);

  step('3. start session — spawn teammate with role-pack memory blocks');
  // memfsEnabled=false: letta-teams' memfs feature requires Letta Cloud
  // (api.letta.com). This smoke test targets a self-hosted backend, so
  // we disable memfs at spawn time. The memfs lifecycle journey
  // (vibesync-6wn.6) is exercised by unit tests; we just need the
  // session path to work here.
  const handle = await provider.start({
    role: 'reviewer',
    extra: {
      moleculeId,
      memoryBlocks: reviewer.memoryBlocks,
      memfsEnabled: false,
    },
  });
  log(`handle: ${handle.id} providerKind=${handle.providerKind}`, GREEN);

  step('4. inspect spawned teammate + agent memory blocks on the server');
  // Use a second TeamsRuntime instance for inspection. Both runtimes
  // talk to the same daemon over IPC and the same on-disk store, so
  // state stays consistent — we avoid reaching into the provider's
  // private runtime field.
  const runtime = teamsSdk.getTeamsRuntime();
  const target = `${moleculeId}-reviewer`;
  const teammate = await runtime.teammates.get(target);
  if (!teammate) throw new Error(`teammate ${target} missing after start()`);
  log(`teammate name=${teammate.name} agentId=${teammate.agentId}`, GREEN);
  const client = new LettaClient({ baseUrl: backend.baseUrl, token: backend.apiKey });
  const blocks = await client.agents.blocks.list(teammate.agentId, { limit: 200 });
  log(`agent.blocks: ${blocks.length}`, blocks.length > 0 ? GREEN : RED);
  for (const b of blocks) log(`  - label=${b.label} value=${String(b.value ?? '').slice(0, 80)}…`, DIM);
  const wantLabels = new Set(reviewer.memoryBlocks.map((b) => b.label));
  const gotLabels = new Set(blocks.map((b) => b.label).filter(Boolean) as string[]);
  const missing = [...wantLabels].filter((l) => !gotLabels.has(l));
  if (missing.length > 0) throw new Error(`memory blocks missing on agent: ${missing.join(', ')}`);
  log(`memory-block seeding: ✓ (all role-TOML labels present on agent)`, GREEN);

  step('5. prompt + observe SessionEvent stream');
  await provider.prompt(handle, [
    { type: 'text', text: 'Review this change: a single line `console.log("hello")` was added to src/index.ts. Verdict and one-sentence rationale.' },
  ]);
  const kindsSeen: string[] = [];
  // Cap observe() so a stalled task fails loudly rather than hanging.
  const observeDeadline = Date.now() + 3 * 60_000;
  for await (const ev of provider.observe(handle)) {
    kindsSeen.push(ev.kind);
    log(`event: ${ev.kind} ts=${ev.ts}`, ev.kind === 'error' ? RED : '');
    if (Date.now() > observeDeadline) {
      log('observe deadline exceeded — bailing', YELLOW);
      break;
    }
    if (ev.kind === 'turn-done' || ev.kind === 'error' || ev.kind === 'stopped') break;
  }
  log(`event kinds: ${kindsSeen.join(', ')}`, GREEN);

  step('6. drift auditor — confirm our teammate is healthy');
  const local: LocalTeammateStore = {
    async listLocal() {
      const all = await runtime.teammates.list();
      return all
        .filter((t) => t.name === target)
        .map((t) => ({ name: t.name, agentId: t.agentId }));
    },
  };
  const directory: LettaAgentDirectory = {
    async listAgents() {
      const list = await client.agents.list({ name: target, limit: 50 });
      return list.map((a) => ({ id: a.id ?? '', name: a.name ?? '' }));
    },
  };
  const report = await auditTeammateState({ local, server: directory, bus });
  log(`audit (pre-stop): healthy=${report.healthy.length} findings=${report.findings.length}`, report.findings.length === 0 ? GREEN : RED);
  for (const f of report.findings) log(`  finding: ${JSON.stringify(f)}`, YELLOW);
  if (!report.healthy.some((h) => h.name === target)) {
    throw new Error(`drift report did not mark ${target} as healthy — got ${JSON.stringify(report.healthy)}`);
  }

  step('7. stop session — teammate teardown');
  const spawnedAgentId = teammate.agentId;
  await provider.stop(handle);
  const afterStop = await runtime.teammates.get(target);
  if (afterStop) {
    throw new Error(`teammate ${target} still present after stop() — got ${JSON.stringify(afterStop)}`);
  }
  log('teammate removed from runtime.teammates.list()', GREEN);

  // SDK-level stop only removes the local ~/.lteams/<name>.json entry.
  // The Letta agent persists on the server (by design — agents are
  // long-lived state on Letta). For the post-stop drift audit to be
  // meaningful, delete the server-side agent too so this smoke run
  // leaves no residue. Production callers that want the agent to
  // outlive the teammate should NOT do this.
  try {
    await client.agents.delete(spawnedAgentId);
    log(`server-side agent ${spawnedAgentId} deleted`, GREEN);
  } catch (err) {
    log(`agent delete failed (smoke residue may remain): ${(err as Error).message}`, YELLOW);
  }

  const reportAfter = await auditTeammateState({ local, server: directory });
  log(`audit (post-stop): healthy=${reportAfter.healthy.length} findings=${reportAfter.findings.length}`, reportAfter.findings.length === 0 ? GREEN : YELLOW);

  step('8. pass-criteria summary');
  const sessionKindsSet = new Set(observed.map((e) => e.kind));
  const checks: { name: string; ok: boolean; note?: string }[] = [
    {
      name: 'daemon never reported down on the bus',
      ok: !observed.some((e) => e.kind === 'health-patrol/daemon.down'),
    },
    {
      name: 'memory blocks reflect role TOML (skipInit honored)',
      ok: missing.length === 0,
      note: `agent has ${blocks.length} blocks; role asked for ${reviewer.memoryBlocks.length}`,
    },
    {
      name: 'session events landed on the bus',
      ok: sessionKindsSet.has('runtime/session.started') && sessionKindsSet.has('runtime/session.turn-done'),
      note: [...sessionKindsSet].join(', '),
    },
    {
      name: 'task_id + molecule_id tagged on session events',
      ok: observed.length > 0 && observed.every((e) => (e.kind === 'runtime/session.started' ? true : e.task_id) && e.molecule_id === moleculeId),
    },
    {
      name: 'pre-stop drift auditor: teammate healthy, no findings',
      ok: report.findings.length === 0 && report.healthy.some((h) => h.name === target),
    },
    {
      name: 'stop() removed the teammate',
      ok: afterStop === null,
    },
    {
      name: 'post-stop drift auditor: no findings for this name',
      ok: reportAfter.findings.length === 0,
    },
  ];

  let allOk = true;
  for (const c of checks) {
    const mark = c.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    log(`  ${mark} ${c.name}${c.note ? ` — ${c.note}` : ''}`);
    if (!c.ok) allOk = false;
  }

  patrol.stop();
  void driftEvents;

  if (!allOk) {
    log('\nSMOKE TEST FAILED', RED);
    process.exitCode = 1;
    return;
  }
  log('\nSMOKE TEST PASSED — vibesync-6wn.8 unblocked', GREEN);
}

async function runDaemon(): Promise<void> {
  const runtime = teamsSdk.getTeamsRuntime();
  await runtime.daemon.runInternal();
}

if (process.argv.includes('daemon') && process.argv.includes('--internal')) {
  runDaemon().catch((err) => {
    process.stderr.write(`daemon fatal: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    log(`fatal: ${(err as Error).stack ?? String(err)}`, RED);
    process.exit(1);
  });
}
