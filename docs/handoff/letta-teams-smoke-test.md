# Handoff — close out the letta-teams adoption epic

## Prompt (copy this to start a new session)

> I'm picking up `vibesync-6wn` (letta-teams adoption epic) on branch
> `codex/ts-bun-binary-migration`. All implementable journeys are
> closed; two issues remain, both gated on the same real-Letta-server
> smoke test:
>
> - `vibesync-6wn.8` (P3) — Retire `LettaCodeSubagentProvider`.
> - `vibesync-brd` (decision, P1) — Closes when the migration is
>   fully realized via `.8`.
>
> Run the smoke test in `docs/handoff/letta-teams-smoke-test.md`, then
> either land the retirement commit (delete the file, drop the export,
> remove its tests) and close both issues, or open a follow-up bead if
> the smoke test surfaces a blocker. Do not skip the smoke test —
> closing `.8` without external validation is what the journey
> pre-conditions explicitly forbid.
>
> When you start: `bd ready`, then `bd show vibesync-6wn`.

## State of the branch when this was written

- Branch: `codex/ts-bun-binary-migration` (pushed to `origin`).
- HEAD: `622cf63 feat(letta): detect ~/.lteams/ ↔ Letta server drift + ship runbook`.
- 10 commits land the epic (all on this branch since `7c3b902`):
  - docs codify the decision (`5679348`)
  - `observe()` polls real task progress (`2cc0f0d`)
  - provider events → EventBus (`dd0083b`)
  - molecule-scoped teammate names (`55e4423`)
  - daemon under HealthPatrol (`7da74da`)
  - `skipInit: true` so role packs own memory (`09da955`)
  - `memfsStartup` forwarding (`0196ea8`)
  - role-pack memory-block seeding (`6be18c8`)
  - `LettaTeamsBackendConfig` single-source env (`bd2e1b4`)
  - `TeammateDriftAuditor` + runbook (`622cf63`)
- Test scope (orchestration + new letta files): **138/138** under vitest. Type-check clean.
- Out-of-scope failures: `tests/unit/LettaService.test.ts` and `tests/unit/LettaMemoryBuilders.test.ts` have ~50 pre-existing failures from the JS→TS migration. Not touched by this epic.

## Open beads after this handoff

| ID | Type | Priority | Status |
|---|---|---|---|
| `vibesync-6wn` | epic | P1 | in_progress |
| `vibesync-6wn.8` | task | P3 | open — needs smoke test |
| `vibesync-brd` | decision | P1 | open — closes with `.8` |

## The smoke test

### Prerequisites

1. A reachable Letta server. Either:
   - Self-hosted Python Letta at e.g. `https://letta.oculair.ca`, OR
   - Letta Cloud at `https://api.letta.com` (default).
2. An API key for that server (`LETTA_API_KEY`, or `LETTA_PASSWORD`
   as a fallback for self-hosted boxes that use the legacy env name).
3. `@letta-ai/letta-code` installed somewhere `letta-code-sdk` can
   resolve it, or `LETTA_CLI_PATH` set to the CLI entry point.

### One-time setup

```bash
export LETTA_BASE_URL='https://letta.oculair.ca'          # or your server
export LETTA_API_KEY='sk-...'                              # or LETTA_PASSWORD
# Optional: export LETTA_CLI_PATH=/path/to/letta-code/letta.js

cd /opt/stacks/vibesync
git switch codex/ts-bun-binary-migration
bun install
bunx tsc -p tsconfig.json --noEmit                         # expect: clean
bunx vitest run tests/unit/orchestration tests/integration/orchestration \
  tests/unit/letta/LettaTeamsBackendConfig.test.ts \
  tests/unit/letta/LettaTeamsMemoryBlockSeeder.test.ts \
  tests/unit/letta/TeammateDriftAuditor.test.ts
# Expect: 138 passed
```

### Smoke test script

The goal: drive `formulas/code-review.toml` against the `gastown`
pack end-to-end through `LettaTeamsProvider`, with real Letta agents
spawned by the teams daemon, real memory blocks seeded by the
seeder, real events landing on the orchestration bus. Save the
script under `scripts/smoke/letta-teams-code-review.ts` (it does
not exist yet — author it as part of running the smoke test).

```ts
// scripts/smoke/letta-teams-code-review.ts
import { LettaTeamsBackendConfig } from '../../src/letta/LettaTeamsBackendConfig.js';
import { LettaTeamsProvider } from '../../src/orchestration/runtime/index.js';
import { EventBus } from '../../src/orchestration/events/index.js';
import { HealthPatrol } from '../../src/orchestration/health/index.js';
import { loadPack } from '../../src/orchestration/packs/index.js';
import { auditTeammateState } from '../../src/letta/TeammateDriftAuditor.js';

const backend = new LettaTeamsBackendConfig();
backend.applyToProcessEnv();

const bus = new EventBus({ noPersist: true });
bus.subscribe((e) => console.log(`[${e.layer}] ${e.kind}`, e.payload ?? {}));

const seeder = backend.buildSeeder();
const provider = new LettaTeamsProvider({ eventBus: bus, memoryBlockSeeder: seeder });

const patrol = new HealthPatrol(bus, { probeIntervalMs: 30_000 });
patrol.trackDaemon(provider.daemonSupervisor());
patrol.start();

await provider.ensureDaemonRunning();

const pack = loadPack('packs/gastown', 'project');
const reviewer = pack.roles.find((r) => r.name === 'reviewer');
if (!reviewer) throw new Error('reviewer role missing from gastown pack');

const handle = await provider.start({
  role: 'reviewer',
  extra: {
    moleculeId: 'smoke-1',
    ...(reviewer.memoryBlocks ? { memoryBlocks: reviewer.memoryBlocks } : {}),
  },
});

await provider.prompt(handle, [
  { type: 'text', text: 'Review this change: `console.log("hello")` was added to src/index.ts.' },
]);

for await (const ev of provider.observe(handle)) {
  console.log('event:', ev.kind, 'ts:', ev.ts);
  if (ev.kind === 'turn-done' || ev.kind === 'error' || ev.kind === 'stopped') break;
}

await provider.stop(handle);
patrol.stop();
```

Run it:

```bash
bun scripts/smoke/letta-teams-code-review.ts
```

### What to verify (pass criteria)

1. **Daemon starts.** No `daemon.down` events on the bus. `bd events`
   shows zero `health-patrol/daemon.*` for the run.
2. **Teammate spawns with `skipInit: true`.** Inspect the Letta agent
   (`curl $LETTA_BASE_URL/v1/agents/<id>`) — memory blocks should
   reflect the role TOML's `[[memory_blocks]]`, not teams' default
   "you are running inside letta-teams" prompts.
3. **Events land on the bus.** Tail shows
   `runtime/session.started → runtime/session.first-token →
   runtime/session.turn-done` in order. `task_id` is set on every
   event; `molecule_id` is `'smoke-1'`.
4. **Drift auditor is clean.** Pipe the report from
   `auditTeammateState({ local, server, bus })` through; `findings`
   should be `[]` if this is a fresh run.
5. **Stop tears down cleanly.** The teammate is removed from
   `runtime.teammates.list()`; `~/.lteams/reviewer.json` or the
   molecule-scoped variant is gone.

### If the smoke test fails

Capture the failure mode in `bd notes vibesync-6wn.8 --append`, then:

- **Daemon won't start** → check `LETTA_CLI_PATH` or that
  `@letta-ai/letta-code` is npm-installed. Run `letta --version`
  out-of-band first.
- **Spawn 401/403** → `LETTA_API_KEY` not propagating. Check
  `backend.daemonEnv()` output and that `applyToProcessEnv()` ran
  before `ensureDaemonRunning()`.
- **`seed()` 404s** → drift between the CLI subprocess's backend
  and the seeder's client. Run the auditor and follow
  `docs/architecture/letta-teams-state-drift.md`.
- **No events on the bus** → confirm `eventBus` was passed to
  `LettaTeamsProvider`. The provider's no-op path is intentional —
  forgetting the wiring just silently swallows events.
- **Unfixable upstream blocker** → open a follow-up bead and revise
  `vibesync-brd` with the new constraint rather than closing it.

### Closing `.8` and `vibesync-brd`

Once the smoke test passes:

```bash
# 1. Apply the retirement.
git rm src/orchestration/runtime/letta-code-subagent-provider.ts
# Update src/orchestration/runtime/index.ts: drop the LettaCodeSubagentProvider export.
# Update tests/unit/orchestration/runtime/extra-providers.test.ts: drop the
# LettaCodeSubagent describe block, keep ACP + A2UI cases.
# Update src/orchestration/runtime/provider.ts header: remove the "Retired:" line.

# 2. Verify nothing else references the deleted symbol.
grep -rn "LettaCodeSubagent" src/ tests/ docs/
# Expect: zero matches except possibly archived docs.

# 3. Type-check + test.
bunx tsc -p tsconfig.json --noEmit
bunx vitest run tests/unit/orchestration tests/integration/orchestration tests/unit/letta

# 4. Commit + close.
git add -A
git commit -m "feat(orchestration): retire LettaCodeSubagentProvider

Closes vibesync-6wn.8 and vibesync-brd. Smoke test in
<notes on the bead> validated code-review formula end-to-end via
LettaTeamsProvider; the CLI-subagent path is no longer reachable
through any public seam.
"
bd close vibesync-6wn.8 vibesync-6wn vibesync-brd --reason='Smoke test green; CLI-subagent path retired in <commit>.'
git push origin codex/ts-bun-binary-migration
```

## Files most relevant to the smoke test

- `src/orchestration/runtime/letta-teams-provider.ts` — the provider
- `src/letta/LettaTeamsBackendConfig.ts` — env helper, `daemonEnv()`, `buildSeeder()`
- `src/letta/LettaTeamsMemoryBlockSeeder.ts` — REST adapter
- `src/letta/TeammateDriftAuditor.ts` — drift detector
- `src/orchestration/events/bus.ts` — EventBus
- `src/orchestration/health/patrol.ts` — `trackDaemon(supervisor)`
- `src/orchestration/packs/pack.ts` — `loadPack` returns `RoleConfig.memoryBlocks`
- `packs/gastown/roles/reviewer.toml` — needs `[[memory_blocks]]` added before the smoke test if you want to verify the seeder path; without it, the seeder is a no-op.
- `docs/architecture/gastown-orchestration.md` — design context
- `docs/architecture/letta-teams-state-drift.md` — drift cleanup runbook
- `AGENTS.md` — RuntimeProvider discipline non-goals
