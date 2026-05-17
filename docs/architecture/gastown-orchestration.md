# Multi-Agent Orchestration in VibeSync

A pitch for evolving VibeSync into a mature multi-agent orchestration
plane by adopting the patterns Steve Yegge's
[Gas Town](https://github.com/steveyegge/gastown) iterated to over two
years, extracted by [Gas City](https://github.com/gastownhall/gascity)
into a "five primitives + four derived mechanisms" architecture.

**Where it lives:** VibeSync (this repo). VibeSync is the orchestration
host. We **consume** `letta-teams-sdk` from npm for the teammate
primitive (stateful Letta agents with role + memory + conversation
forking). We **do not fork letta-teams** — staying upstream-pure on
that dependency is non-negotiable. All the orchestration shape
(formulas, molecules, runtime providers, event bus, health patrol,
role packs, layering invariants) is built **here**, on top.

## Why this stack

```
┌───────────────────────────────────────────────────────────────────┐
│ VibeSync — Orchestration host                                     │
│   formulas · molecules · runtime providers · event bus            │
│   health patrol · role packs · layering invariants                │
│                                                                   │
│   src/letta/ already wraps Letta lifecycle + memory + tools       │
│   src/orchestration/ (new) hosts everything below the dotted line │
│                                                                   │
│   …………… RuntimeProvider interface ……………                          │
│   ┌─────────────────────┬──────────────────────┐                  │
│   │ LettaTeamsProvider  │ LettaCodeSubagent    │ ACPProvider  │ A2UI…
│   │ (via letta-teams-   │ Provider             │              │     │
│   │  sdk, primary)      │ (letta-code workers) │              │     │
│   └─────────────────────┴──────────────────────┴──────────────┴────┘
└───────────────────────────────────────────────────────────────────┘
            │                          │                  │
            ▼                          ▼                  ▼
   Letta server agents       letta-code subagents    third-party
   (memory, conv, tools)     (admin-shim path)        ACP agents
```

VibeSync gets to keep the integration code it already has
(`src/letta/`) and **adds** an orchestration plane that can dispatch
to multiple runtime backends. letta-teams-sdk becomes one backend
(the primary one for stateful chat agents); letta-code subagents
become another; ACP / A2UI providers slot in alongside.

## Why VibeSync is the right home

- **Already an orchestration service.** README: *"Project sync service
  with PM agent orchestration."* The PM-agent surface is exactly the
  orchestration primitive we want to expand.
- **Already speaks Letta.** `src/letta/` has lifecycle, persistence,
  memory, tools, PM-agent persona. Half the wiring is there.
- **Already runs Bun/TS.** Same ecosystem as letta-code,
  letta-code-parallel, letta-teams-sdk. No language wall.
- **Already uses bd.** New orchestration beads slot in with the
  existing project-registry beads under VibeSync's bd prefix.
- **Owned by the team.** No fork-coordination cost. We can iterate
  without negotiating direction with a third-party maintainer.

## Why not customize letta-teams directly

- **Maintenance cost.** letta-teams is a third-party package at v0.x.
  Carrying a fork means tracking upstream + rebasing every release.
  Not worth it.
- **Surface mismatch.** letta-teams-sdk's surface
  (`runtime.daemon/teammates/tasks`) is the teammate-management
  primitive — start/stop/dispatch to *one* agent at a time. The
  orchestration *above* that primitive (formulas, molecules, multi-
  agent workflows) is what we want to own. Owning the layer above is
  cleaner than customizing the layer below.
- **Reversibility.** If we own the orchestration plane and consume the
  SDK at arm's length, we can swap letta-teams-sdk for another
  teammate primitive later (raw Letta SDK, letta-code subagents,
  whatever) without rewriting our orchestrator. A fork loses that
  optionality.

## Where letta-teams-sdk fits

Consumed via `npm install letta-teams-sdk`. Wrapped by one VibeSync
RuntimeProvider implementation:

```ts
// src/orchestration/runtime/letta-teams-provider.ts
import { createTeamsRuntime, type TeamsRuntime } from "letta-teams-sdk";
import type { RuntimeProvider, SessionHandle, ... } from "./provider";

export class LettaTeamsProvider implements RuntimeProvider {
  private runtime: TeamsRuntime;
  constructor() { this.runtime = createTeamsRuntime(); }
  async start(spec) { /* runtime.teammates.spawn(...) */ }
  async prompt(handle, content) { /* runtime.tasks.dispatch(...) */ }
  async observe(handle) { /* yield events from runtime.tasks.wait */ }
  // ...
}
```

If the SDK's surface shifts between releases, only this file moves.
Everything above the `RuntimeProvider` interface stays stable.

## Where Gas Town's patterns fit

Same shape as the original letta-teams pitch, just hosted in VibeSync
instead of forking letta-teams.

### Five layering invariants (adopt verbatim)

Pin in `AGENTS.md` at the VibeSync repo root; cite in PR reviews:

1. **No upward dependencies.** Layer N never imports Layer N+1.
2. **Beads is the universal persistence substrate** for domain state.
   (VibeSync already uses bd; make it the only source of truth.)
3. **Event bus is the universal observation substrate.** All
   cross-layer visibility goes through it.
4. **Config is the universal activation mechanism.** Features turn on
   via config presence, not hardcoded branches.
5. **Zero hardcoded roles.** If a line of TS references a specific
   role name (`pm-agent`, `reviewer`, etc.), it's a bug. Role
   behavior lives in config and prompt templates, not code.

Gas Town accumulated two years of role-hardcoding debt before Steve
realized rule 5. VibeSync can skip the cost — note that
`controlAgentName` in `src/letta/LettaConfig.ts` is already an
escape hatch from hardcoding, but the discipline needs to extend
to all role references.

### Five primitives + four derived mechanisms

| Gas Town / Gas City pattern             | VibeSync home                          | Status |
|-----------------------------------------|----------------------------------------|--------|
| Session (start/stop/prompt agent)       | `src/orchestration/runtime/`           | New |
| Task store (beads)                      | `.beads/` (existing)                   | ✅ Native |
| Event bus                               | `src/orchestration/events/`            | New |
| Config (TOML)                           | `src/orchestration/formulas/*.toml`    | New |
| Prompt templates                        | `src/letta/pm-agent-persona.ts` + new  | Partial |
| Messaging (mail / nudge)                | Via RuntimeProvider.prompt/nudge       | New |
| Formulas & molecules                    | `src/orchestration/{formula,molecule}/`| New |
| Dispatch (sling)                        | `src/orchestration/dispatch.ts`        | New |
| Health patrol                           | `src/orchestration/health/`            | New |

### RuntimeProvider interface (the chokepoint refactor)

```ts
// src/orchestration/runtime/provider.ts
interface RuntimeProvider {
  start(spec: SessionSpec): Promise<SessionHandle>;
  stop(handle: SessionHandle): Promise<void>;
  prompt(handle: SessionHandle, content: ContentBlock[]): Promise<void>;
  nudge(handle: SessionHandle): Promise<void>;
  observe(handle: SessionHandle): AsyncIterable<SessionEvent>;
}
```

Initial impls (in order of priority):
- `LettaTeamsProvider` (via letta-teams-sdk) — primary stateful chat path
- `LettaCodeSubagentProvider` — spawn letta-code workers for code-focused turns
- `ACPProvider` — JSON-RPC stdio for third-party agents
- `A2UIProvider` — server side for letta-mobile / web client UI rendering
- `FakeProvider` — for tests

Memory blocks, conversation IDs, fork semantics, A2UI capabilities all
belong **above** the interface, in formulas + role configs. Keep the
interface at five methods.

### Formulas + molecules

**Formula** = TOML workflow template (e.g. `formulas/code-review.toml`).
**Molecule** = runtime instance: root task + dependency-linked child
tasks in bd. Today's flat task list becomes a molecule-of-one —
strict generalization, backwards-compatible with the existing
vibesync beads.

```toml
[formula.code-review]
description = "Review a code change with a reviewer/coder/tester loop"

[[formula.code-review.steps]]
role = "reviewer"
prompt_template = "prompts/review.md"
wait_for = "completion"

[[formula.code-review.steps]]
role = "coder"
prompt_template = "prompts/fix.md"
depends_on = "reviewer"
wait_for = "completion"

[[formula.code-review.steps]]
role = "tester"
prompt_template = "prompts/verify.md"
depends_on = "coder"
```

Daemon (could live in `src/orchestration/daemon.ts`) walks the
molecule, dispatches steps in dep order, retries on failure, surfaces
one final result.

## Sequencing — shippable steps

Each is independently useful; stop at any point and the result still
ships.

1. **Pin layering invariants** in `AGENTS.md`. Zero code change.
2. **Define `RuntimeProvider` interface** in
   `src/orchestration/runtime/provider.ts`. Wrap current Letta
   lifecycle service as `LettaPMAgentProvider` (uses existing
   `src/letta/` code as backend).
3. **Add `LettaTeamsProvider`** that consumes `letta-teams-sdk`.
   This is the new path; existing PM-agent code keeps working under
   `LettaPMAgentProvider`.
4. **Add molecules** — extend bd usage so a single dispatched workflow
   becomes a tree of child issues with `depends_on` / `parent_task_id`.
   Today's flat work items become molecules-of-one.
5. **Add formulas** — TOML templates parsed by the orchestration
   daemon. Use Gas City's `internal/formula/` field names for
   conceptual interop.
6. **Add event bus** — append-only event log (`.beads/events.jsonl`
   or postgres table) that every layer emits to. Replaces polled
   state for TUI / dashboards.
7. **Add health patrol** — probe RuntimeProvider liveness; restart on
   stall with backoff.
8. **Add pack mechanism** — install/register/scope discoverable role +
   formula bundles, mirroring Gas City's pack discovery.
9. **Add A2UI runtime provider** — server side of the rendering work
   Codex is doing on letta-mobile.
10. **Add ACP runtime provider** — JSON-RPC stdio per the Gas City
    `internal/runtime/acp/` reference. Lets VibeSync orchestrate
    third-party agents.
11. **Role packs** — Gas Town role catalog (Mayor / Deacon / Polecat /
    …) as a published VibeSync pack, validating the abstractions
    against a mature, non-trivial role set.

## Non-goals

- **Don't fork letta-teams.** Consume it via npm. If we hit a wall,
  open an upstream issue first, fork second.
- **Don't put role names in core code.** Roles live in packs and
  prompt templates. Cite layering invariant #5 in reviews.
- **Don't invent a new TOML schema** that competes with Gas City's.
  Use the same field names — conceptual interop has value even
  without binary interop.
- **Don't try to be Gas City.** We're building a different stack on a
  different substrate (stateful Letta agents, not stateless CLI
  processes). Borrow patterns; don't port code.
- **Don't merge orchestration into `src/letta/`.** Keep the new code
  in `src/orchestration/` so the layering is visible in the file tree.

## References

- Gas Town (origin): https://github.com/steveyegge/gastown
- Gas City (extracted SDK): https://github.com/gastownhall/gascity
- Gas City layering invariants: `AGENTS.md` in the Gas City repo
- Gas City formulas: `internal/formula/`
- Gas City runtime providers: `internal/runtime/`
- Gas City ACP provider: `internal/runtime/acp/`
- letta-teams-sdk:
  https://github.com/Vedant020000/letta-teams ·
  https://www.npmjs.com/package/letta-teams-sdk
- A2UI protocol: https://a2ui.org/ ·
  https://github.com/google/A2UI
- Original letta-teams pitch (now superseded by this doc):
  https://github.com/oculairmedia/letta-teams/blob/docs/gastown-on-teams-pitch/docs/gastown-on-teams.md
