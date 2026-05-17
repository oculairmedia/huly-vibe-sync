# Beads/Dolt migration findings

Date: 2026-05-11

## Executive summary

Vibesync currently treats 98 registered projects as Beads-backed. They are not all in the same operational state:

- 51 projects already have a clean local Dolt/server-backed `.beads` store.
- 31 projects have a local `.beads` directory but are legacy SQLite / `beads.db` stores or otherwise do not present the clean Dolt/server metadata shape.
- 15 registry entries advertise Beads but their configured filesystem path has no local `.beads` directory.
- 1 registry entry advertises Beads but has no filesystem path.

Yes: we should migrate this in stages. DoltHub does not replace local Beads/Dolt. The `bd` CLI still reads and writes the project-local `.beads` store; DoltHub is only a remote for push/pull backup and collaboration.

## Key findings

### Local `.beads` remains the source of truth

For Beads-backed projects, normal agent work should use project-local commands such as:

```bash
bd ready --json
bd show <id> --json
bd update <id> --claim
bd close <id> --reason="..."
bd dolt push
```

Those commands depend on the local `.beads` directory, not just on Vibesync registry metadata and not just on DoltHub.

### DoltHub is a remote, not the runtime database

DoltHub remote state matters for durability, but it is not a substitute for a healthy local `.beads/dolt` checkout. A project can have a DoltHub remote configured and still fail local work if:

- `/usr/local/bin/dolt` is missing in the runtime/container.
- `.beads` files are owned by `root` when the worker runs as uid `1000` / `mcp-user`.
- `.beads/metadata.json` contains deprecated `dolt_server_port`.
- A stale Dolt `sql-server` process is holding the local `.beads/dolt` lock.
- `.beads/dolt-server.port` / `.beads/dolt-server.pid` are missing or stale.

### Deprecated `dolt_server_port` is dangerous

`dolt_server_port` in `.beads/metadata.json` is deprecated and can cause cross-project data leakage or stale-port failures. The active server port should come from `.beads/dolt-server.port`, managed by `bd`.

Observed Vibesync recovery pattern:

1. Remove only `dolt_server_port` from `.beads/metadata.json`.
2. Identify the stale Dolt process by working directory, not by port alone:
   `pwdx <pid>` should point at the affected project, for example `/opt/stacks/vibesync/.beads/dolt`.
3. Stop only that project-specific stale process.
4. Run `bd list --json` or `bd dolt status --json` and let `bd` recreate managed pid/port files.
5. Verify with `bd list --json` and `bd dolt push`.

### Container/runtime needs both `bd` and `dolt`

Vibesync’s container previously had `/usr/local/bin/bd` but not `/usr/local/bin/dolt`, so Beads hydration worked only until Dolt-backed stores needed Dolt operations. The production compose runtime should mount both binaries read-only:

```yaml
- /usr/local/bin/bd:/usr/local/bin/bd:ro
- /usr/local/bin/dolt:/usr/local/bin/dolt:ro
```

### Use Vaultwarden-backed credentials for DoltHub

Do not put `DOLTHUB_API_TOKEN` in `.env`. Use the Vaultwarden-backed compose wrapper so the token exists only for the `docker compose` invocation.

## Required preflight before working in any Beads-backed project

Before claiming or closing issues in a project, run these checks from that project directory:

```bash
test -d .beads
bd list --json
bd dolt status --json   # for Dolt-backed stores
bd ready --json
```

If running through Vibesync/containerized hydration, also verify:

```bash
docker exec vibesync which bd
docker exec vibesync which dolt
```

Check metadata directly only for shape, not for data mutation:

```bash
python3 - <<'PY'
import json
from pathlib import Path
p = Path('.beads/metadata.json')
data = json.loads(p.read_text())
print(data)
assert 'dolt_server_port' not in data
PY
```

Do not read or mutate `.beads/dolt` internals directly. Use the `bd` CLI.

## Migration batches

### Batch A: already Dolt/server-backed, verify and harden

These projects already have local `.beads/dolt` plus `metadata.json` with `backend=dolt` and `dolt_mode=server`. They still need preflight, ownership, and remote verification.

- AUGMT — Augment MCP Tool — `/opt/stacks/augment-mcp-tool` — issues: 0
- BKMCP — BookStack MCP — `/opt/stacks/bookstack-mcp` — issues: 3
- CCMCP — Claude Code MCP — `/opt/stacks/claude-code-mcp` — issues: 0
- CCUI — Claude Code UI — `/opt/stacks/claudecodeui` — issues: 1
- CCXL — Claude Code X Letta — `/opt/stacks/Claude_code-X-Letta` — issues: 0
- CTX7 — Context7 — `/opt/stacks/context7` — issues: 0
- GPTR — GPT Researcher — `/opt/stacks/gpt-researcher` — issues: 0
- GRAPH — Graphiti Knowledge Graph Platform — `/opt/stacks/graphiti` — issues: 467
- HDMCP — Houdini MCP Server — `/opt/stacks/houdini-mcp` — issues: 1978
- INSTA — Instabot — `/opt/stacks/instabot` — issues: 0
- KOMOD — Komodo MCP — `/opt/stacks/komodo-mcp` — issues: 0
- KORCH — Kitchen Orchestrator — `/opt/stacks/kitchen-orchestrator` — issues: 51
- LETTA — Letta OpenCode Plugin — `/opt/stacks/letta-opencode-plugin` — issues: 718
- LMS — Letta MCP Server — `/opt/stacks/letta-MCP-server` — issues: 184
- LTSEL — Letta Tools Selector — `/opt/stacks/lettatoolsselector` — issues: 4340
- LWBHK — Letta Webhook Receiver — `/opt/stacks/letta-webhook-receiver-new` — issues: 19
- MCPIN — MCP Inspector — `/opt/stacks/mcp-inspector` — issues: 0
- MEILI — Meilisearch — `/opt/stacks/meilisearch` — issues: 0
- MMCP — MetaMCP — `/opt/stacks/metamcp` — issues: 1
- MMCPS — MetaMCP MCP Server — `/opt/stacks/metamcp-mcp-server` — issues: 0
- MXWGT — Matrix Widget Toolkit — `/opt/stacks/matrix-widget-toolkit` — issues: 0
- OPCDE — OpenCode Project — `/opt/stacks/opencode` — issues: 6
- PPMCP — PhotoPrism MCP Server — `/opt/stacks/photoprism-mcp` — issues: 57
- PSITE — Personal Site — `/opt/stacks/personal-site` — issues: 97
- PZMCP — Postiz MCP — `/opt/stacks/postiz-mcp` — issues: 0
- SFIN — SureFinance — `/opt/stacks/sure-finance` — issues: 0
- SFMCP — SureFinance MCP Server — `/opt/stacks/surefinance-mcp-server` — issues: 4213
- android-tools-mcp — `/opt/stacks/android-tools-mcp` — issues: 0
- beads — `/opt/stacks/beads` — issues: 435
- claudecode-graphiti-hook — `/opt/stacks/claudecode-graphiti-hook` — issues: 0
- claudia — `/opt/stacks/claudia` — issues: 0
- dockerfiles — `/opt/stacks/dockerfiles` — issues: 0
- letta — `/opt/stacks/letta` — issues: 0
- letta-mobile — `/opt/stacks/letta-mobile` — issues: 1122
- lettabot — `/opt/stacks/lettabot` — issues: 0
- matrix-appservice-discord — `/opt/stacks/matrix-appservice-discord` — issues: 0
- matrix-messaging-mcp — `/opt/stacks/matrix-messaging-mcp` — issues: 0
- matrix-tuwunel-deploy — `/opt/stacks/matrix-tuwunel-deploy` — issues: 0
- mautrix-manager — `/opt/stacks/mautrix-manager` — issues: 0
- mcp-playground — `/opt/stacks/mcp-playground` — issues: 0
- opencode-openai-codex-auth — `/opt/stacks/opencode-openai-codex-auth` — issues: 0
- radicale — `/opt/stacks/radicale` — issues: 0
- rust-sync-poc — `/opt/stacks/rust-sync-poc` — issues: 0
- serena — `/opt/stacks/serena` — issues: 0
- social-hause-frontend — `/opt/stacks/social-hause-frontend` — issues: 0
- surefinance-rails — `/opt/stacks/surefinance-rails` — issues: 0
- test — `/opt/stacks/test` — issues: 0
- turbomcp — `/opt/stacks/turbomcp` — issues: 0
- turbomcpstudio — `/opt/stacks/turbomcpstudio` — issues: 0
- vibe-kanban — `/opt/stacks/vibe-kanban` — issues: 0
- vibesync — `/opt/stacks/vibesync` — issues: 0

### Batch B: legacy SQLite / mixed stores, migrate or classify as placeholder

These projects have `.beads` but do not currently present the clean Dolt/server metadata shape. Some are placeholder paths from Huly sync and may not deserve full migration.

- CAGW — Claude API Gateway — `/opt/stacks/huly-sync-placeholders/CAGW` — issues: 0
- CGHOK — Claude Graphiti Hook — `/opt/stacks/huly-sync-placeholders/CGHOK` — issues: 0
- CLAUD — Claudia — `/opt/stacks/huly-sync-placeholders/CLAUD` — issues: 0
- DCKRF — Dockerfiles — `/opt/stacks/huly-sync-placeholders/DCKRF` — issues: 0
- DOCLN — Docling — `/opt/stacks/huly-sync-placeholders/DOCLN` — issues: 0
- GKMCP — Google Keep MCP — `/opt/stacks/Google Keep MCP` — issues: 1
- HULLY — Huly MCP Server — `/opt/stacks/huly-sync-placeholders/HULLY` — issues: 829
- LCORE — Letta Core Development — `/opt/stacks/letta/letta-repo` — issues: 83
- MCPPL — MCP Playground — `/opt/stacks/huly-sync-placeholders/MCPPL` — issues: 0
- MXDSC — Matrix Appservice Discord — `/opt/stacks/huly-sync-placeholders/MXDSC` — issues: 0
- MXMGR — Mautrix Manager — `/opt/stacks/huly-sync-placeholders/MXMGR` — issues: 0
- MXMSG — Matrix Messaging MCP — `/opt/stacks/huly-sync-placeholders/MXMSG` — issues: 34
- OCOAI — OpenCode OpenAI Codex Auth — `/opt/stacks/huly-sync-placeholders/OCOAI` — issues: 0
- RDCLE — Radicale — `/opt/stacks/huly-sync-placeholders/RDCLE` — issues: 0
- RSPOC — Rust Sync POC — `/opt/stacks/huly-sync-placeholders/RSPOC` — issues: 0
- SEREN — Serena — `/opt/stacks/huly-sync-placeholders/SEREN` — issues: 0
- SFRLS — SureFinance Rails — `/opt/stacks/huly-sync-placeholders/SFRLS` — issues: 0
- TESTP — Test Project — `/opt/stacks/huly-sync-placeholders/TESTP` — issues: 0
- TMCP — TurboMCP — `/opt/stacks/huly-sync-placeholders/TMCP` — issues: 0
- TMCPS — TurboMCP Studio — `/opt/stacks/huly-sync-placeholders/TMCPS` — issues: 0
- TSK — Default — `/opt/stacks/huly-sync-placeholders/TSK` — issues: 28
- VIBEK — Vibe Kanban — `/opt/stacks/huly-sync-placeholders/VIBEK` — issues: 69
- anthropic-claude-max-proxy — `/opt/stacks/anthropic-claude-max-proxy` — issues: 0
- claude api gateway — `/opt/stacks/claude api gateway` — issues: 0
- crawl4ai-mcp — `/opt/stacks/crawl4ai-mcp` — issues: 0
- docling-api — `/opt/stacks/docling-api` — issues: 0
- haystackproxy — `/opt/stacks/haystackproxy` — issues: 0
- letta-code — `/opt/stacks/letta-code` — issues: 0
- letta-switchboard — `/opt/stacks/letta-switchboard` — issues: 0
- mcp-filesystem-server — `/opt/stacks/mcp-filesystem-server` — issues: 0
- openapi-mcp — `/opt/stacks/openapi-mcp` — issues: 0

### Batch C: registry drift, fix registry or initialize Beads

These projects are advertised as Beads-backed by Vibesync, but the configured filesystem path has no local `.beads` directory.

- HVSYN — Huly-Vibe Sync Service — `/opt/stacks/huly-vibe-sync` — issues: 349
- gemini-api-proxy — `/opt/stacks/gemini-api-proxy` — issues: 0
- grocery-deals-scraper — `/opt/stacks/grocery-deals-scraper` — issues: 0
- grocy — `/opt/stacks/grocy` — issues: 0
- huly-test-v07 — `/opt/stacks/huly-test-v07` — issues: 0
- letta-proxy — `/opt/stacks/letta-proxy` — issues: 0
- letta-voice — `/opt/stacks/letta-voice` — issues: 0
- monica-cli — `/opt/stacks/monica-cli` — issues: 0
- openai-gemini — `/opt/stacks/openai-gemini` — issues: 0
- real-a2a — `/opt/stacks/real-a2a` — issues: 0
- rikkahub — `/opt/stacks/rikkahub` — issues: 0
- sentry — `/opt/stacks/sentry` — issues: 0
- skills — `/opt/stacks/skills` — issues: 0
- social-hause — `/opt/stacks/social-hause` — issues: 0
- social-hause-cms — `/opt/stacks/social-hause-cms` — issues: 0

### Batch D: missing path

- MXSYN — Matrix Synapse Deployment — no filesystem path — issues: 645

## Recommended migration order

1. Add/ship preflight diagnostics in Vibesync so agents can see unsafe Beads state before touching a project.
2. Harden high-issue Dolt/server projects first: LTSEL, SFMCP, HDMCP, letta-mobile, LETTA, GRAPH, beads.
3. Classify Batch B into real projects vs placeholder-only stores.
4. Migrate real Batch B stores to Dolt/server mode with preserved `issues.jsonl` and verified `bd list --json`.
5. Resolve Batch C registry drift by correcting paths, initializing Beads, or disabling tracker advertisement.
6. Verify DoltHub remotes and push state for migrated projects.

## Related Vibesync Beads issues

- `vibesync-bxe` — Plan Beads/Dolt migration for all registered projects
- `vibesync-8sz` — Migrate legacy Beads stores to Dolt server mode
- `vibesync-bi3` — Resolve registry drift for Beads projects without local `.beads` stores
- `vibesync-1sb` — Add Beads/Dolt preflight diagnostics before project work
- `vibesync-y9b` — Verify DoltHub remotes for migrated Beads projects
- `vibesync-v02` — Add project AGENTS.md Beads preflight guidance during migration
