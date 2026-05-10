# Proposal: Per‑Project Letta “PM” Agent Integration for Legacy ↔ VibeKanban Sync

## Summary
Introduce one dedicated Letta “PM” agent per Legacy project. The agent is read–write by way of attached MCP servers (Legacy + VibeKanban), and is continuously fed with a structured, high‑signal Kanban state snapshot derived from both systems. As a first step, upload the repository README.md to the agent (expandable to more docs later).

## Goals
- 1 project → 1 persistent Letta agent (idempotent creation; persisted in DB)
- Agents are read–write via MCP tools for Legacy and VibeKanban (safe/gated)
- Build a “PM harness” that composes a project state snapshot and updates agent memory blocks every sync
- Seed agent context with README.md now, expandable to more repo docs later

## Non‑Goals (Initial Phase)
- Autonomous write‑back without human gate (we’ll design for gated/approved actions)
- Full document ingestion beyond README.md (comes in later milestone)

---

## Architecture Overview
- Extend existing Node.js sync service (index.js) to:
  - Ensure Vibe project exists (already implemented)
  - Ensure/track a Letta agent per Legacy project
  - Build a “Project State Snapshot” from Legacy issues + Vibe tasks
  - Upsert structured memory blocks into the agent each sync
  - Upload README.md, keeping per‑project Letta folder/source for files
- Persist Letta identifiers in SQLite (`projects` table)

Data Flow (simplified):
1) Legacy projects/issues + Vibe projects/tasks → Sync Service
2) Sync Service → DB (state, last sync) + Letta (agent/memory/optional sources)
3) Letta agent tools → MCP servers (Legacy/Vibe) for read–write when invoked

---
## Alignment with Letta Code (Research Preview)
- Memory model alignment:
  - Use standard blocks: `persona` (global), `human` (optional global), `project` (shared project memory)
  - The PM harness writes structured state into `project` plus domain blocks: `board_metrics`, `hotspots`, `backlog_summary`, `change_log`
- Persistence interop:
  - Primary persistence remains in this service's SQLite DB (per‑project `letta_agent_id`)
  - Optional synergy: write `.letta/settings.local.json` in each repo so Letta Code auto‑resumes the same agent (behind a config flag, default OFF)
- Tools and permissions:
  - Attach only MCP tools (Legacy/Vibe) to the PM agent; do not attach local dev tools (Bash/Read/Write) in the service context
  - Default to plan‑like gating; writes only via explicit MCP calls that the service mediates
- Developer workflow:
  - Developers can connect via the Letta Code CLI to the same agent for collaboration. Example:

```bash
letta -p "Show board metrics" --agent <AGENT_ID> --tools ""
```

---


## Database Changes
Add columns to `projects` to track the per‑project agent and optional file store:
- `letta_agent_id` TEXT
- `letta_folder_id` TEXT NULL
- `letta_source_id` TEXT NULL
- `letta_last_sync_at` INTEGER

One‑time migration SQL (run once in prod/staging):
```sql
ALTER TABLE projects ADD COLUMN letta_agent_id TEXT;
ALTER TABLE projects ADD COLUMN letta_folder_id TEXT;
ALTER TABLE projects ADD COLUMN letta_source_id TEXT;
ALTER TABLE projects ADD COLUMN letta_last_sync_at INTEGER;
```

Code updates in `lib/database.js`:
- Include these columns in `createTables()` for fresh installs
- Add helpers:
  - `getProjectLettaInfo(identifier)` => agentId/folderId/sourceId/lastSync
  - `setProjectLettaAgent(identifier, { agentId, folderId, sourceId })`
  - `setProjectLettaSyncAt(identifier, timestamp)`

---

## Letta Client Integration
Preferred: Letta Node SDK for correctness/maintainability.
- Package (requires approval and install):
  - `npm install @letta-ai/letta-client`
- Environment:
  - `LETTA_BASE_URL=https://letta2.oculair.ca/v1`
  - `LETTA_PASSWORD=lettaSecurePass123`
  - Optional: `LETTA_MODEL=openai/gpt-4.1`, `LETTA_EMBEDDING=openai/text-embedding-3-small`

Client init (example):
```ts
import { LettaClient } from '@letta-ai/letta-client';
export const letta = new LettaClient({
  baseURL: process.env.LETTA_BASE_URL!,
  password: process.env.LETTA_PASSWORD!,
});
```

Fallback (no new dep): direct REST with fetch to Letta endpoints. SDK is recommended.

---

## Agent Specification (One PM Agent per Project)
- Naming: `Legacy/<PROJECT_IDENTIFIER> PM Agent`
- Memory blocks (base):
  - persona: Project/Kanban PM; optimize flow, clarity, and actionability
  - human: Optional developer/team preferences (style, conventions) to align with Letta Code’s global memory model
- Models: From env (`LETTA_MODEL`, `LETTA_EMBEDDING`), aligned to your llms config
- Tools (read‑write via MCP):
  - Legacy MCP (e.g., `legacy_query`, `legacy_issue_ops`)
  - Vibe MCP (tasks CRUD)
- Idempotency: Store `letta_agent_id` in DB; reuse on subsequent runs

Create/ensure agent (conceptual):
```ts
const name = `Legacy/${project.identifier} PM Agent`;
const agent = await letta.agents.create({
  name,
  model: process.env.LETTA_MODEL,
  embedding: process.env.LETTA_EMBEDDING,
  memoryBlocks: [{ label: 'persona', value: 'Project PM for Kanban ops.' }],
});
```

Attach MCP tools (conceptual):
```ts
const legacyTool = await letta.tools.mcp.create({ name:'legacy', transport:'http', url:process.env.REMOVED_MCP_URL });
const vibeTool = await letta.tools.mcp.create({ name:'vibe', transport:'http', url:process.env.VIBE_MCP_URL });
await letta.agents.tools.add(agent.id, legacyTool.id);
await letta.agents.tools.add(agent.id, vibeTool.id);
```

---

## PM Harness: Project State Snapshot → Memory Blocks
On each sync for a project:
1) Ensure agent exists (store/reuse `letta_agent_id`)
2) Build snapshot from current Legacy issues and Vibe tasks:
   - `project`: project name, identifier, repo path, git URL, vibe project id
   - `board_config`: status mapping and WIP policies (from existing mapping functions)
   - `board_metrics`: counts by status, WIP, done rates (windowed if available)
   - `hotspots`: blocked items, ageing WIP, overdue (if due dates are present)
   - `backlog_summary`: top N backlog items by priority
   - `change_log`: diffs since last sync (status/description changes)
3) Upsert memory blocks on the agent (JSON)
4) Update `letta_last_sync_at`
5) Optional: send a short message to prompt analysis (disabled until ready)

Memory upsert (conceptual):
```ts
await letta.agents.blocks.upsert(agentId, [
  { label: 'project', value: JSON.stringify(meta) },
  { label: 'board_config', value: JSON.stringify(config) },
  { label: 'board_metrics', value: JSON.stringify(metrics) },
  { label: 'hotspots', value: JSON.stringify(hotspots) },
  { label: 'backlog_summary', value: JSON.stringify(backlog) },
  { label: 'change_log', value: JSON.stringify(deltas) },
]);
```

Snapshot sources (available from current code):
- Legacy issues (index.js → `fetchLegacyIssues()`)
- Vibe tasks (index.js → `listVibeTasks()`)
- Repo path/git URL (index.js → `extractFilesystemPath()`, `getGitUrl()`)

---

## README Upload (Now; Expand Later)
- If filesystem path exists and `README.md` is present:
  - Ensure a Letta folder/source per project (store IDs)
  - Upload README.md text (upsert semantics to avoid duplicates)
- Future expansion: docs/, ADRs, ROADMAP, CONTRIBUTING, etc. with allowlist

Example (conceptual):
```ts
const folderId = await ensureAgentFolder(agentId, project.identifier);
const text = fs.readFileSync(path.join(repoPath, 'README.md'), 'utf8');
await letta.sources.files.upsertText({ agentId, folderId, path: 'README.md', text });
```

---

## Integration Points in Code
- `index.js` inside `processProject(legacyProject)` (after Vibe project ensure):
  1) Read `letta_agent_id` from DB; call `ensurePmAgent()` if missing
  2) Ensure MCP tools attached to the agent (Legacy + Vibe)
  3) Build snapshot from `legacyIssues` + `vibeTasks`
  4) Upsert memory blocks; update `letta_last_sync_at`
  5) Upload README.md if repo path exists; upsert per‑project folder/source
- `lib/database.js`:
  - Add columns in schema + helpers to get/set Letta fields
- New helper module (recommended): `lib/LettaService.js`
  - Wraps SDK calls: ensureAgent, attachTools, upsertBlocks, ensureFolder/Source, uploadReadme

---
## Developer CLI Interop with Letta Code
- Purpose: allow humans to collaborate with the per‑project PM agent directly from the repo directory
- How to connect:
  - Obtain the `agent_id` (logged by the service; also stored in DB `projects.letta_agent_id`)
  - From the repo root, run:

```bash
letta -p "Review current hotspots and suggest next actions" --agent <AGENT_ID> --tools ""
```

- Notes:
  - `--tools ""` prevents the CLI from loading local Bash/Write tools; the agent still has server‑side MCP tools attached
  - Model can be adjusted in‑session using `/model` in the CLI
  - Optional: we can emit `.letta/settings.local.json` so `letta` auto‑resumes the project agent (behind a config flag)

---


## Configuration
Required (Service):
- `LETTA_BASE_URL`, `LETTA_PASSWORD`
- `REMOVED_MCP_URL`, `VIBE_MCP_URL` (reachable by Letta for tool calling)

Optional (Service):
- `LETTA_MODEL`, `LETTA_EMBEDDING`
- `LETTA_ATTACH_REPO_DOCS=true|false` (default true for README only)
- Default permission semantics: “plan” (read/advise); write actions happen only via explicit MCP tool calls gated by the sync service

Developer CLI (Letta Code) compatibility:
- `LETTA_API_KEY` (for cloud) and/or `LETTA_BASE_URL` for self‑host
- Use: `letta -p "Show board metrics" --agent <AGENT_ID> --tools ""` to avoid loading local Bash/Write tools; the agent will still have MCP tools attached server‑side

Respect existing `DRY_RUN`: no Letta writes in dry‑run mode.

---

## Rollout Plan (Milestones)
- M1: DB migration + LettaService + agent creation + persona block
- M2: PM harness to compute snapshot + memory upserts each sync
- M3: README upload (folder/source management) per project
- M4: Optional: agent messages with change summary (monitor only)
- M5: Optional: gated tool flows (agent proposes; service applies after approval)

---

## Risks & Mitigations
- Duplicate agents → Idempotent creation, store `letta_agent_id`
- Large boards → Limit top‑N items; chunk large memory blocks; archive older `change_log`
- Rate limits → Batch/pace updates; update only changed blocks based on hashes
- Privacy → Allowlist files; keep repo uploads minimal (README first)
- Availability → Fallback/skip Letta ops if server unavailable; keep sync resilient

---

## Open Questions
1) Confirm MCP URLs for Legacy and Vibe accessible by Letta
2) Confirm default model/embedding (or keep env defaults)
3) Should we create a pinned “meta” Vibe task with agent link/ID? (optional)
4) What approval workflow for write‑backs do you prefer (Slack/CLI/UI)?

---

## Next Steps Checklist
- [ ] Approve adding dependency: `@letta-ai/letta-client`
- [ ] Provide/confirm `REMOVED_MCP_URL` and `VIBE_MCP_URL`
- [ ] Apply DB migration (add Letta columns)
- [ ] Implement `lib/LettaService.js` (ensureAgent, attachTools, upsertBlocks, uploadReadme)
- [ ] Wire `processProject()` in `index.js` to call the PM harness
- [ ] Enable DRY_RUN verification (logs only), then activate writes
- [ ] Observe agent behavior; iterate block contents and metrics as needed

