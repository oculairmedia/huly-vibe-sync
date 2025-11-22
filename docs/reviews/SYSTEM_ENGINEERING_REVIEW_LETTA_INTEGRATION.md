# System Engineering Review: Letta “PM” Agent Integration for Huly ↔ VibeKanban

## Executive Summary

This document provides an in‑depth review of the implemented per‑project Letta “PM” agent integration. Overall, the architecture and separation of concerns are solid, with idempotent agent creation, structured memory updates, and safe guardrails (DRY_RUN). A few P0 issues need fixing to avoid runtime failures and capability gaps, followed by P1 improvements for scale, resilience, and maintainability.

### Strengths
- Clear modularization: orchestration in `index.js`, SDK wrapper in `lib/LettaService.js`.
- Idempotent per‑project agent creation; persistence in DB.
- Structured memory block upserts with size caps and logging.
- Graceful degradation when Letta is unavailable; DRY_RUN mode.
- README upload workflow behind env‑gated flag.

### High‑priority fixes (P0)
- Missing DB methods referenced by `index.js` (will crash at runtime):
  - `setProjectLettaFolderId(identifier, folderId)`
  - `setProjectLettaSourceId(identifier, sourceId)`
- `ensureSource(folderId, name)` ignores `folderId`; sources are created globally, not scoped to folder.
- MCP tool attachment is stubbed out; the agent lacks read‑write capability unless attached manually.
- Verify Letta SDK initialization matches your server (baseUrl/token) and model/embedding defaults.

### Medium priorities (P1)
- Avoid global list() scans for idempotency (agents/sources) on large deployments; prefer server‑side filtering or rely on DB.
- Attach folder to agent idempotently; ensure source organization under folder.
- Add hashing/diff to skip unchanged memory block updates.
- Provide ALTER TABLE migration path for existing DBs.

### Nice‑to‑haves (P2)
- Optional Letta Code CLI interop (.letta/settings.local.json with last agent id).
- Structured logs + basic metrics; backoff/retry for Letta API.

---

## Detailed Findings

### 1) Orchestration (index.js)
- Good
  - Letta service initialization behind config; DRY_RUN guard.
  - Idempotent agent ensure with DB caching; memory update after data fetch.
  - README upload gated by `LETTA_ATTACH_REPO_DOCS` and existence of filesystem path.
- Risks/Improvements
  - MCP tools not actually attached (currently a stub in service) → agent won’t be read‑write as required.
  - When DB lacks agent id, `ensureAgent` falls back to listing all agents by name → O(N) on large installs.
  - Minor: avoid dynamic import for `path` in hot loop; negligible but can be simplified.

Code excerpt – missing DB setters (used but not implemented):

```javascript
// index.js
const folder = await lettaService.ensureFolder(projectIdentifier);
db.setProjectLettaFolderId(projectIdentifier, folder.id);

const source = await lettaService.ensureSource(folder.id, `${projectIdentifier}-README`);
db.setProjectLettaSourceId(projectIdentifier, source.id);
```

### 2) Letta Service (lib/LettaService.js)
- Good
  - Cohesive wrapper: ensureAgent, upsertMemoryBlocks, folder/source, README upload, attachments.
  - Memory upsert flow: fetch existing, update/attach; size cap with logging.
- Risks/Improvements
  - `ensureSource(folderId, name)` ignores `folderId`; creates global source → organization/uniqueness issues. Prefer folder‑scoped list/create if available; otherwise immediately attach source to folder.
  - `attachFolderToAgent` exists; use it consistently after `ensureFolder`.
  - Add content hashing to skip unchanged block updates; consider chunking if payload limits hit.
  - Validate default model/embedding vs server capabilities.

Code excerpt – `ensureSource` ignoring folder:

```javascript
// lib/LettaService.js
async ensureSource(folderId, sourceName) {
  const sources = await this.client.sources.list();
  const existingSource = sources.find(s => s.name === sourceName);
  if (existingSource) return existingSource;
  return await this.client.sources.create({ name: sourceName, description: `Source for ${sourceName}`, embedding: this.embedding });
}
```

Code excerpt – MCP tool attach stub (capability gap):

```javascript
// lib/LettaService.js
async attachMcpTools(agentId, hulyMcpUrl, vibeMcpUrl) {
  console.log(`[Letta] Skipping MCP tool attachment (not supported by SDK yet)`);
  // TODO: Implement via SDK tools.mcp.* or REST once available
}
```

Code excerpt – SDK client init and defaults:

```javascript
// lib/LettaService.js
this.client = new LettaClient({ baseUrl: baseURL, token: password });
this.model = options.model || process.env.LETTA_MODEL || 'anthropic/claude-sonnet-4-5-20250929';
this.embedding = options.embedding || process.env.LETTA_EMBEDDING || 'openai/text-embedding-3-small';
```

### 3) Database (lib/database.js)
- Good
  - Schema columns present: `letta_agent_id`, `letta_folder_id`, `letta_source_id`, `letta_last_sync_at`.
  - Helpful getters/setters like `getProjectLettaInfo`, `setProjectLettaSyncAt`.
- Risks/Improvements
  - P0: Missing `setProjectLettaFolderId` and `setProjectLettaSourceId` used by `index.js`.
  - Migrations: `CREATE TABLE IF NOT EXISTS` won’t add columns to existing tables; add `ALTER TABLE` path conditional on `PRAGMA table_info`.
  - Consider a table for block hashes `(project_identifier, label, hash, updated_at)` to skip unnecessary upserts.

Schema excerpt:

```sql
letta_agent_id TEXT,
letta_folder_id TEXT,
letta_source_id TEXT,
letta_last_sync_at INTEGER
```

### 4) Huly REST Client (lib/HulyRestClient.js)
- Good
  - Explicit health checks and timeouts.
  - Incremental sync support via `modifiedAfter`.
  - Tool call bridge returns normalized MCP‑style text.
- Improvements
  - Add backoff/retry on 429/5xx; unify rate‑limit handling if expanding usage.

---

## Security and Secrets
- Avoid logging secrets (`LETTA_PASSWORD`); currently safe.
- Consider supporting `LETTA_API_KEY` for Letta Cloud vs self‑host.
- Default `HULY_MCP_URL` is LAN IP; document environment expectations.
- Filesystem path is parsed from Huly descriptions; ensure this is trusted input.

## Observability and Operability
- Logging is descriptive; consider structured JSON logs tagged with `project_identifier`, `agent_id`.
- Add lightweight metrics:
  - Counters: `memory_upserts_total`, `readme_uploads_total`, `letta_requests_total`
  - Histogram: `letta_request_duration_ms` by endpoint
  - Gauge: `blocks_updated_on_last_sync`
- Optional: a `letta_ops` table to capture Letta actions/failures per project for audits.

## Performance and Scale
- Avoid `list()` across all agents/sources; use DB as source of truth or server‑side filters.
- Hash/diff memory blocks to skip no‑ops; prune long arrays consistently.
- Folder‑scoped source listing/creation to reduce O(N) global scans.

## Compatibility with Letta Code (CLI)
- Optional developer interop: write `.letta/settings.local.json` with `{ "last_agent_id": "<id>" }` per repo for quick CLI attach.
- When using CLI alongside this service, consider `--tools ""` to avoid local write tools; rely on server MCP.

---

## Actionable Recommendations

### P0 — Fix now
1) Implement DB setters or consolidate into `setProjectLettaAgent`:
   - `setProjectLettaFolderId(identifier, folderId)`
   - `setProjectLettaSourceId(identifier, sourceId)`
2) Fix `ensureSource` to respect `folderId`; use folder‑scoped list/create APIs if available; attach folder to agent idempotently.
3) Implement MCP tool attachment via SDK or REST; if blocked, add a verification step and a doc for manual attachment.
4) Confirm Letta client initialization (`baseUrl`, `token`) and model/embedding compatibility with the deployed server.

### P1 — Improve next
1) Add `ALTER TABLE` migration path for existing DBs.
2) Add block hashing/diffing to `upsertMemoryBlocks` to avoid unnecessary updates.
3) Replace global list() for agents/sources with filtered or folder‑scoped operations; or rely solely on DB presence.

### P2 — Nice to have
1) Structured logs + metrics; possibly a small metrics endpoint.
2) Optional CLI interop file per project.

---

## Appendix: Representative Code Excerpts

A) Missing DB setters in `index.js`:
```javascript
// index.js
const folder = await lettaService.ensureFolder(projectIdentifier);
db.setProjectLettaFolderId(projectIdentifier, folder.id);
const source = await lettaService.ensureSource(folder.id, `${projectIdentifier}-README`);
db.setProjectLettaSourceId(projectIdentifier, source.id);
```

B) `ensureSource` ignoring folder in `lib/LettaService.js`:
```javascript
// lib/LettaService.js
const sources = await this.client.sources.list();
const existingSource = sources.find(s => s.name === sourceName);
// create source without folder association
```

C) MCP tool attachment stub in `lib/LettaService.js`:
```javascript
// lib/LettaService.js
console.log(`[Letta] Skipping MCP tool attachment (not supported by SDK yet)`);
// TODO: implement when SDK or REST supports it
```

D) SDK init in `lib/LettaService.js`:
```javascript
// lib/LettaService.js
new LettaClient({ baseUrl: baseURL, token: password });
```

