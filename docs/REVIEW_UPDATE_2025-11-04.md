# Systems Engineering Review Update — 2025-11-04

This document updates the prior systems engineering review after your major refactor. It captures what changed, current state, prioritized recommendations, and a 3‑PR plan to reach production‑grade reliability and observability.

## TL;DR

- You substantially improved structure and test coverage. The codebase now has:
  - Modular services (SyncOrchestrator, HealthService, Huly/Vibe Services, config, mappers, parsers)
  - Vitest test harness with coverage and CI (Codecov upload)
  - Type checking of JS via `tsc --noEmit`
- Remaining work is concentrated in observability, resilience, and data consistency:
  - Structured logging + correlation IDs, Prometheus metrics, real healthchecks
  - Retry/backoff and a simple circuit breaker around external calls
  - Idempotency/intent tracking across remote create + DB write
- Proposed plan: 3 short PRs (observability, resilience, idempotency) + a small CI tightening.

Overall score moves from ~7.5 → 7.8/10. You’re close to production-grade with a small reliability/ops push.

---

## Evidence of the refactor (files observed)

- Test harness and coverage
  - `package.json` scripts: `test`, `test:coverage`, `test:unit`, `test:integration`, `type-check`
  - `vitest.config.js` with V8 coverage, thresholds (Lines/Funcs/Stmts=60%, Branches=50%)
  - Tests present in `tests/unit`, `tests/integration`, `tests/performance`, `tests/mocks` with setup file
  - Coverage artifacts (`coverage/`) and HTML reports checked into workspace (should be ignored going forward)
- CI quality gates
  - `.github/workflows/test.yml` runs on push/PR; Node 18/20 matrix; runs lint, tests, coverage; Codecov upload
- Modularity
  - `lib/SyncOrchestrator.js` — orchestration for Phase 1 (Huly→Vibe) and Phase 2 (Vibe→Huly)
  - `lib/HealthService.js` — `/health` endpoint + in-process metrics object
  - `lib/config.js` — env loading/validation + summaries
  - `lib/HulyService.js`, `lib/VibeService.js` — client wrappers and sync helpers
  - `index.js` reduced to 387 LOC; delegates to modules
- Type checking
  - `tsconfig.json` with `allowJs` + `checkJs` and strictness dialed down for gradual adoption
- Lint/format tooling
  - ESLint config present; Prettier is installed; no `.prettierrc` yet

---

## Re‑scored categories

- Architecture & modularity: 8/10 (up) — Clear separation of concerns; orchestration extracted.
- Testing & QA: 7/10 (up) — Harness + coverage + CI in place; add a few missing Phase‑2/edge tests.
- Error handling & resilience: 5/10 — Add retry/backoff + circuit breaker + error taxonomy.
- Observability: 5/10 (up) — Health endpoint exists; add structured logging + Prometheus metrics.
- Data consistency & idempotency: 6/10 (slight up) — Implicit idempotency via detection, but no intent/WAL.
- Security & hardening: 4/10 — Health exposure, host networking; no auth on `/health`.
- Ops & runtime: 6/10 (up) — CI greatly improved; Docker healthcheck needs real probe.
- Overall: 7.8/10 (from ~7.5).

---

## Priority recommendations (actionable)

1) Structured logging with correlation IDs (pino)
- Create `lib/logger.js` exporting a configured pino logger (JSON, redaction for secrets).
- Attach a `syncId` (from `db.startSyncRun()`) to every log line in a sync cycle.
- Replace `console.*` with `logger.info/debug/warn/error`.

Minimal logger module:

```js
// lib/logger.js
import pino from 'pino';
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'huly-vibe-sync' },
  redact: ['letta.password']
});
```

2) Prometheus metrics (`prom-client`) and /metrics endpoint
- Add counters/gauges/histograms:
  - `sync_runs_total{status}` (success|error)
  - `sync_duration_ms` (histogram)
  - `huly_api_latency_ms`, `vibe_api_latency_ms` (histograms)
  - `projects_processed`, `issues_synced` (gauges during run, observe as counters on completion)
- Extend `HealthService` to expose `/metrics` via `register.metrics()`.

3) Retry with exponential backoff + simple circuit breaker
- Wrap external calls (Huly/Vibe) in a helper that:
  - Retries on transient errors (429/5xx/ECONNRESET/ETIMEDOUT), bounded attempts with jittered backoff
  - Trip a per-host breaker after N failures; half-open after cooldown
  - Classify errors into transient vs permanent via a small `SyncError` hierarchy

4) Tighten CI gates
- Remove `continue-on-error: true` from the lint step to fail PRs on lint errors.
- Keep Vitest thresholds authoritative (they already fail on low coverage).

5) Real health checks in Docker and Compose
- Dockerfile healthcheck should query `/health` and assert `"status": "healthy"`.
- docker-compose should use `CMD-SHELL` with `curl` against `${HEALTH_PORT}/health`.

Suggested Dockerfile healthcheck:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${HEALTH_PORT:-3099}/health | grep -q '"status": "healthy"' || exit 1
```

Compose healthcheck:

```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:${HEALTH_PORT:-3099}/health | grep -q '\"status\": \"healthy\"'"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 10s
```

6) Health endpoint security and bind address
- Bind health server to `127.0.0.1` internally.
- If you must expose it externally, require an API key header (simple shared secret).
- Revisit `network_mode: host`; prefer explicit port publishing for principle of least privilege.

7) Idempotency & intent tracking for create flows
- When creating Vibe projects/tasks, generate a deterministic idempotency key (if API supports) or record a `pending_ops` row in SQLite before remote call; reconcile on success/failure so a crash does not produce duplicates.

8) Single-run guard
- Prevent overlapping syncs when `SYNC_INTERVAL` < runtime. Use a DB advisory lock/flag or a lightweight file lock. Skip starting a new run if previous hasn’t completed.

9) Prettier config and git hygiene
- Add a `.prettierrc` for consistent formatting.
- Ensure `.gitignore` excludes `coverage/`, `logs/`, `.letta/`, and generated `html/` report artifacts.

10) Tests to add (short list)
- Phase 2 description change path (Vibe→Huly) including skip when Huly changed recently.
- Conflict resolution where both systems changed (“Huly wins”) ensures Vibe update is issued.
- Retry/backoff unit tests: transient 500, then success; breaker transitions (closed→open→half-open→closed).

---

## 3‑PR implementation plan

- PR 0.5 (quick CI polish; ~30–60 min)
  - Remove `continue-on-error` from lint step in `.github/workflows/test.yml`.
  - Add `.prettierrc` and `.gitignore` entries for coverage/logs/.letta/html.

- PR 1 — Observability foundation (1–2 days)
  - Add `lib/logger.js` (pino) and switch key modules (`index.js`, orchestrator, services) to structured logs with `syncId` context.
  - Add `prom-client`; implement `/metrics` in `HealthService` and instrument sync duration, counts, and API latencies.
  - Update Dockerfile/compose healthchecks to query `/health`.

- PR 2 — Resilience & error taxonomy (2–3 days)
  - Implement `fetchWithRetry` with jittered exponential backoff; wrap Huly/Vibe calls.
  - Add simple circuit breaker keyed by host.
  - Introduce `SyncError` classes for transient/permanent classification; refine orchestrator error handling.
  - Unit tests for retry policies and breaker states.

- PR 3 — Idempotency & concurrency guard (1–2 days)
  - Add `pending_ops` intent table; reconcile on startup.
  - DB/file lock to avoid overlapping sync cycles.
  - Tests for duplicate prevention and crash‑resume behavior.

---

## Risks and mitigations

- Added retries may increase API pressure → use bounded attempts, jitter, and per‑host breaker.
- Metrics endpoint exposure → bind to loopback by default; require auth if exposed.
- Idempotency storage complexity → keep schema minimal (op_id, type, payload, status, timestamps).

---

## Acceptance criteria

- PR 0.5: CI fails on lint; prettier formatting consistent; coverage artifacts not committed going forward.
- PR 1: `/metrics` returns Prometheus text; logs include `syncId`; Docker/compose healthcheck reflects real health.
- PR 2: Transient failures are retried; breaker prevents cascades; tests cover retry and breaker paths.
- PR 3: No duplicate project/task creation across crashes; subsequent runs reconcile cleanly; no overlapping sync cycles.

---

## Suggested .gitignore additions

```
coverage/
logs/
.letta/
html/
```

## Suggested `.prettierrc` (starter)

```
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100
}
```

---

## Next steps

- Approve the 3‑PR plan (plus the quick CI polish) and specify environment constraints for health/metrics exposure.
- Optionally share your Codecov target so we can adjust thresholds accordingly.

This document reflects the repo state as of 2025‑11‑04 and provides a focused path to production readiness with low blast radius.

