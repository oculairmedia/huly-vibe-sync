/**
 * LettaTeamsProvider — wraps `letta-teams-sdk` behind the
 * RuntimeProvider seam.
 *
 * Brings the SDK's TeamsRuntime (daemon + teammates + tasks) into
 * VibeSync's orchestration plane as one provider implementation
 * alongside LettaPMAgentProvider.
 *
 * Provider-specific start-spec extra fields:
 *   - extra.moleculeId?: string — molecule the session belongs to.
 *     Used to scope the teammate name (see Naming below) and tagged
 *     onto every event emitted to the orchestration EventBus.
 *   - extra.target?: string — explicit target name; overrides both
 *     `role` and the moleculeId-derived default. Use this only when a
 *     caller needs to attach to a pre-existing teammate by name.
 *   - extra.model?: string — LLM model handle.
 *   - extra.contextWindowLimit?: number — context window override.
 *   - extra.spawnPrompt?: string — rich init prompt.
 *   - extra.memfsEnabled?: boolean — memfs lifecycle (default false).
 *
 * Naming (vibesync-6wn.4):
 *   letta-teams' teammate namespace is flat and global per daemon.
 *   To keep concurrent molecules from colliding on the same role
 *   teammate, the provider derives the target as:
 *
 *     extra.target ?? (extra.moleculeId ? `${moleculeId}-${role}` : role)
 *
 *   Two molecules running a "reviewer" role get distinct teammates
 *   (`mol-1-reviewer` vs `mol-2-reviewer`); stop() on one does not
 *   affect the other. Calls without a moleculeId fall back to the
 *   bare role name — backwards-compatible with the early skeleton
 *   tests and with any caller that has not yet adopted molecules.
 *
 * Discipline:
 *   - This file is in src/orchestration/runtime/; allowed to import the
 *     third-party SDK. Other layers MUST NOT import letta-teams-sdk
 *     directly; they go through this provider.
 *   - Daemon lifecycle: call ensureDaemonRunning() before first use.
 *     Idempotent; safe to call from multiple sites.
 *
 * Status: IN PROGRESS. start/stop/prompt wired against the SDK;
 * observe() now polls runtime.tasks.get to translate TaskState
 * transitions and tool-call frames into SessionEvent. Event-bus
 * publish is the next hop (vibesync-6wn.7).
 *
 * See vibesync-y0z, vibesync-6wn (epic), vibesync-6wn.2 (this journey).
 */

import type { EventBus, EventInput } from '../events/bus.js';
import type {
  ContentBlock,
  RuntimeProvider,
  SessionEvent,
  SessionHandle,
  SessionSpec,
} from './provider.js';

// Type-only imports — keep the SDK out of the runtime require graph
// until first construction.
type TeamsRuntime = import('letta-teams-sdk').TeamsRuntime;
type SpawnTeammateInput = import('letta-teams-sdk').SpawnTeammateInput;
type TaskState = import('letta-teams-sdk').TaskState;
type TaskStatus = import('letta-teams-sdk').TaskStatus;
type ToolCallEvent = NonNullable<TaskState['toolCalls']>[number];

interface LettaTeamsSessionHandle extends SessionHandle {
  readonly providerKind: 'letta-teams';
  /** Teammate name in letta-teams-sdk (also the dispatch target). */
  readonly target: string;
}

/** Per-session bookkeeping needed to stream events for the latest turn. */
interface SessionState {
  /** ID of the most recent task dispatched via prompt(). */
  activeTaskId: string | null;
  /** Tripped by stop(); observe() exits with a `stopped` event. */
  stopped: boolean;
  /** Optional molecule id sourced from SessionSpec.extra at start time. */
  moleculeId?: string;
}

export interface LettaTeamsProviderOptions {
  /** Poll cadence for runtime.tasks.get inside observe(). Default 250ms. */
  readonly pollIntervalMs?: number;
  /**
   * Max time observe() will wait for the first dispatched task on a
   * fresh handle before yielding a `stopped` event. Default 30s.
   * Set lower in tests via the constructor.
   */
  readonly initialTaskTimeoutMs?: number;
  /** Injectable sleep — tests pass a fake to avoid real timers. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Optional orchestration EventBus. When provided, every SessionEvent
   * yielded from observe() also publishes onto the bus as a
   * `runtime/session.<kind>` event tagged with the teammate target and
   * the active task id. Omitted in unit tests; supplied at production
   * wiring time so other layers (HealthPatrol, dispatcher, TUI) can
   * subscribe instead of polling.
   */
  readonly eventBus?: EventBus;
}

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_INITIAL_TASK_TIMEOUT_MS = 30_000;

export class LettaTeamsProvider implements RuntimeProvider {
  readonly kind = 'letta-teams';
  private runtime: TeamsRuntime | null = null;
  private readonly sessions = new Map<string, SessionState>();
  private readonly pollIntervalMs: number;
  private readonly initialTaskTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly eventBus: EventBus | null;

  constructor(opts: LettaTeamsProviderOptions = {}) {
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.initialTaskTimeoutMs = opts.initialTaskTimeoutMs ?? DEFAULT_INITIAL_TASK_TIMEOUT_MS;
    this.sleep = opts.sleep ?? defaultSleep;
    this.eventBus = opts.eventBus ?? null;
  }

  /**
   * Lazily create the TeamsRuntime singleton. The SDK exposes a
   * shared `getTeamsRuntime()` accessor as well, but we own ours so
   * tests can inject.
   */
  private async getRuntime(): Promise<TeamsRuntime> {
    if (this.runtime) return this.runtime;
    const sdk = await import('letta-teams-sdk');
    this.runtime = sdk.createTeamsRuntime();
    return this.runtime;
  }

  /**
   * Ensure the SDK daemon is running. Call once on application startup
   * (or lazily on first session start; this method is idempotent).
   */
  async ensureDaemonRunning(): Promise<void> {
    const runtime = await this.getRuntime();
    await runtime.daemon.ensureRunning();
  }

  async start(spec: SessionSpec): Promise<SessionHandle> {
    const runtime = await this.getRuntime();
    await runtime.daemon.ensureRunning();
    const target = resolveTeammateTarget(spec);
    const exists = await runtime.teammates.exists(target);
    if (!exists) {
      const input: SpawnTeammateInput = {
        name: target,
        role: spec.role,
        ...(readStringExtra(spec, 'model') !== undefined ? { model: readStringExtra(spec, 'model')! } : {}),
        ...(readNumberExtra(spec, 'contextWindowLimit') !== undefined
          ? { contextWindowLimit: readNumberExtra(spec, 'contextWindowLimit')! }
          : {}),
        ...(readStringExtra(spec, 'spawnPrompt') !== undefined
          ? { spawnPrompt: readStringExtra(spec, 'spawnPrompt')! }
          : {}),
        ...(readBoolExtra(spec, 'memfsEnabled') !== undefined
          ? { memfsEnabled: readBoolExtra(spec, 'memfsEnabled')! }
          : {}),
      };
      await runtime.teammates.spawn(input);
    }
    const handle: LettaTeamsSessionHandle = {
      id: `letta-teams:${target}`,
      providerKind: 'letta-teams',
      target,
    };
    const moleculeId = readStringExtra(spec, 'moleculeId');
    const session: SessionState = { activeTaskId: null, stopped: false };
    if (moleculeId !== undefined) session.moleculeId = moleculeId;
    this.sessions.set(handle.id, session);
    return handle;
  }

  async stop(handle: SessionHandle): Promise<void> {
    const h = expectHandle(handle);
    const runtime = await this.getRuntime();
    const session = this.sessions.get(h.id);
    if (session) session.stopped = true;
    // Stop is teammate removal; the SDK does its own confirmation flow
    // for destructive operations. For VibeSync's lifecycle we just call
    // remove and accept the false result if it failed.
    await runtime.teammates.remove(h.target);
  }

  async prompt(handle: SessionHandle, content: readonly ContentBlock[]): Promise<void> {
    const h = expectHandle(handle);
    const runtime = await this.getRuntime();
    const message = contentToText(content);
    const { taskId } = await runtime.tasks.dispatch({ target: h.target, message });
    const session = this.sessions.get(h.id) ?? { activeTaskId: null, stopped: false };
    session.activeTaskId = taskId;
    this.sessions.set(h.id, session);
  }

  async nudge(_handle: SessionHandle): Promise<void> {
    // letta-teams-sdk has no nudge verb; the daemon polls on its own.
  }

  /**
   * Stream SessionEvents derived from the most recently dispatched task
   * on this handle. Poll-based because letta-teams-sdk exposes no
   * progress callback — `runtime.tasks.get(id)` is the source of truth.
   *
   * Mapping:
   *   pending  → `started` (once, on first observation)
   *   running  → `first-token` (once, on the transition into running)
   *   toolCalls grown → emit `tool-call` then `tool-result` per new entry
   *   done     → `turn-done` (stopReason = 'done'), iterator ends
   *   error    → `error`, iterator ends
   *   stop()   → `stopped`, iterator ends
   *
   * The iterator ends naturally on a terminal task status or when stop()
   * trips the session flag. Callers can also break out of the for-await.
   */
  async *observe(handle: SessionHandle): AsyncIterable<SessionEvent> {
    const h = expectHandle(handle);
    const runtime = await this.getRuntime();
    const session = this.sessions.get(h.id);
    if (!session) {
      // Handle never went through start() on this provider instance.
      const ev: SessionEvent = { kind: 'error', ts: nowIso(), code: 'unknown_session', message: `No session for ${h.id}` };
      this.publish(h, session, ev);
      yield ev;
      return;
    }

    // Wait for an active task. prompt() may not have been called yet on
    // a freshly started handle; bail with `stopped` if we time out or
    // stop() trips first.
    const taskWaitStart = Date.now();
    while (!session.activeTaskId && !session.stopped) {
      if (Date.now() - taskWaitStart > this.initialTaskTimeoutMs) {
        const ev: SessionEvent = { kind: 'stopped', ts: nowIso() };
        this.publish(h, session, ev);
        yield ev;
        return;
      }
      await this.sleep(this.pollIntervalMs);
    }
    if (session.stopped) {
      const ev: SessionEvent = { kind: 'stopped', ts: nowIso() };
      this.publish(h, session, ev);
      yield ev;
      return;
    }
    const taskId = session.activeTaskId!;

    let lastStatus: TaskStatus | undefined;
    let lastToolCount = 0;
    let startedEmitted = false;

    while (true) {
      if (session.stopped) {
        const ev: SessionEvent = { kind: 'stopped', ts: nowIso() };
        this.publish(h, session, ev);
        yield ev;
        return;
      }

      const state = await runtime.tasks.get(taskId);
      if (!state) {
        const ev: SessionEvent = {
          kind: 'error',
          ts: nowIso(),
          code: 'task_vanished',
          message: `Task ${taskId} no longer present in runtime`,
        };
        this.publish(h, session, ev);
        yield ev;
        return;
      }

      if (!startedEmitted) {
        const ev: SessionEvent = { kind: 'started', ts: state.createdAt };
        this.publish(h, session, ev);
        yield ev;
        startedEmitted = true;
      }

      if (lastStatus !== 'running' && state.status === 'running') {
        const ev: SessionEvent = { kind: 'first-token', ts: state.startedAt ?? nowIso() };
        this.publish(h, session, ev);
        yield ev;
      }

      const toolCalls = state.toolCalls ?? [];
      for (let i = lastToolCount; i < toolCalls.length; i += 1) {
        for (const ev of toolCallEvents(toolCalls[i]!)) {
          this.publish(h, session, ev);
          yield ev;
        }
      }
      lastToolCount = toolCalls.length;

      if (state.status === 'done') {
        const ev: SessionEvent = {
          kind: 'turn-done',
          ts: state.completedAt ?? nowIso(),
          stopReason: 'done',
        };
        this.publish(h, session, ev);
        yield ev;
        // Clear the active task so the next observe() waits for the
        // following prompt() rather than re-streaming this turn.
        session.activeTaskId = null;
        return;
      }
      if (state.status === 'error') {
        const ev: SessionEvent = {
          kind: 'error',
          ts: state.completedAt ?? nowIso(),
          code: 'task_error',
          message: state.error ?? 'task error',
        };
        this.publish(h, session, ev);
        yield ev;
        session.activeTaskId = null;
        return;
      }

      lastStatus = state.status;
      await this.sleep(this.pollIntervalMs);
    }
  }

  /**
   * Forward one SessionEvent to the orchestration EventBus, if one was
   * supplied at construction time. Tagged as `runtime/session.<kind>`
   * with the teammate target and the active task id; molecule_id is
   * carried over from SessionSpec.extra when present.
   *
   * No-op when no bus is wired (unit tests rely on this).
   */
  private publish(
    handle: LettaTeamsSessionHandle,
    session: SessionState | undefined,
    event: SessionEvent,
  ): void {
    if (!this.eventBus) return;
    const input: EventInput = {
      layer: 'runtime',
      kind: `runtime/session.${event.kind}`,
      teammate: handle.target,
      ...(session?.activeTaskId ? { task_id: session.activeTaskId } : {}),
      ...(session?.moleculeId ? { molecule_id: session.moleculeId } : {}),
      payload: sessionEventPayload(event),
    };
    this.eventBus.emit(input);
  }
}

/**
 * Strip the discriminant + ts from a SessionEvent so the remaining
 * fields ride as payload on the bus envelope. The envelope already
 * carries kind (via `runtime/session.<kind>`) and ts (auto-added by
 * EventBus.emit), so duplicating them in payload would be redundant.
 */
function sessionEventPayload(event: SessionEvent): Record<string, unknown> {
  switch (event.kind) {
    case 'message-delta':
      return { text: event.text };
    case 'tool-call':
      return { tool: event.tool, args: event.args };
    case 'tool-result':
      return { tool: event.tool, result: event.result, ok: event.ok };
    case 'usage':
      return { prompt: event.prompt, completion: event.completion };
    case 'turn-done':
      return event.stopReason !== undefined ? { stopReason: event.stopReason } : {};
    case 'error':
      return { code: event.code, message: event.message };
    case 'started':
    case 'first-token':
    case 'stopped':
      return {};
    default:
      return {};
  }
}

function* toolCallEvents(tc: ToolCallEvent): Iterable<SessionEvent> {
  const ts = nowIso();
  yield { kind: 'tool-call', ts, tool: tc.name, args: tc.input ?? null };
  yield {
    kind: 'tool-result',
    ts,
    tool: tc.name,
    result: tc.success ? null : (tc.error ?? null),
    ok: tc.success,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pick the teams teammate target name for a SessionSpec.
 *
 * Order:
 *   1. extra.target — explicit override; caller knows the exact target.
 *   2. `${moleculeId}-${role}` — default when running inside a molecule.
 *   3. role — bare fallback for sessions that do not belong to a molecule.
 *
 * Exported for unit-test introspection; production code goes through
 * LettaTeamsProvider.start.
 */
export function resolveTeammateTarget(spec: SessionSpec): string {
  const explicit = readStringExtra(spec, 'target');
  if (explicit) return explicit;
  const moleculeId = readStringExtra(spec, 'moleculeId');
  return moleculeId ? `${moleculeId}-${spec.role}` : spec.role;
}

function expectHandle(handle: SessionHandle): LettaTeamsSessionHandle {
  if (handle.providerKind !== 'letta-teams') {
    throw new Error(
      `LettaTeamsProvider: handle from wrong provider (got ${handle.providerKind}, want letta-teams)`,
    );
  }
  return handle as LettaTeamsSessionHandle;
}

function readStringExtra(spec: SessionSpec, key: string): string | undefined {
  const v = spec.extra?.[key];
  return typeof v === 'string' ? v : undefined;
}
function readNumberExtra(spec: SessionSpec, key: string): number | undefined {
  const v = spec.extra?.[key];
  return typeof v === 'number' ? v : undefined;
}
function readBoolExtra(spec: SessionSpec, key: string): boolean | undefined {
  const v = spec.extra?.[key];
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * letta-teams-sdk's DispatchTaskInput.message is a string. Image
 * content blocks are not supported on this provider yet — they get
 * surfaced as a `[image: <media-type>]` placeholder in the text body
 * so the caller can spot the missing modality without crashing.
 */
function contentToText(content: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text);
    else if (block.type === 'image') parts.push(`[image: ${block.mimeType}]`);
  }
  return parts.join('\n');
}
