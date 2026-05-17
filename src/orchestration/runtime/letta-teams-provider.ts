/**
 * LettaTeamsProvider — wraps `letta-teams-sdk` behind the
 * RuntimeProvider seam.
 *
 * Brings the SDK's TeamsRuntime (daemon + teammates + tasks) into
 * VibeSync's orchestration plane as one provider implementation
 * alongside LettaPMAgentProvider.
 *
 * Provider-specific start-spec extra fields:
 *   - extra.target?: string — explicit target name (overrides role).
 *   - extra.model?: string — LLM model handle.
 *   - extra.contextWindowLimit?: number — context window override.
 *   - extra.spawnPrompt?: string — rich init prompt.
 *   - extra.memfsEnabled?: boolean — memfs lifecycle (default false).
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

  constructor(opts: LettaTeamsProviderOptions = {}) {
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.initialTaskTimeoutMs = opts.initialTaskTimeoutMs ?? DEFAULT_INITIAL_TASK_TIMEOUT_MS;
    this.sleep = opts.sleep ?? defaultSleep;
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
    const target = readStringExtra(spec, 'target') ?? spec.role;
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
    this.sessions.set(handle.id, { activeTaskId: null, stopped: false });
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
      yield { kind: 'error', ts: nowIso(), code: 'unknown_session', message: `No session for ${h.id}` };
      return;
    }

    // Wait for an active task. prompt() may not have been called yet on
    // a freshly started handle; bail with `stopped` if we time out or
    // stop() trips first.
    const taskWaitStart = Date.now();
    while (!session.activeTaskId && !session.stopped) {
      if (Date.now() - taskWaitStart > this.initialTaskTimeoutMs) {
        yield { kind: 'stopped', ts: nowIso() };
        return;
      }
      await this.sleep(this.pollIntervalMs);
    }
    if (session.stopped) {
      yield { kind: 'stopped', ts: nowIso() };
      return;
    }
    const taskId = session.activeTaskId!;

    let lastStatus: TaskStatus | undefined;
    let lastToolCount = 0;
    let startedEmitted = false;

    while (true) {
      if (session.stopped) {
        yield { kind: 'stopped', ts: nowIso() };
        return;
      }

      const state = await runtime.tasks.get(taskId);
      if (!state) {
        yield {
          kind: 'error',
          ts: nowIso(),
          code: 'task_vanished',
          message: `Task ${taskId} no longer present in runtime`,
        };
        return;
      }

      if (!startedEmitted) {
        yield { kind: 'started', ts: state.createdAt };
        startedEmitted = true;
      }

      if (lastStatus !== 'running' && state.status === 'running') {
        yield { kind: 'first-token', ts: state.startedAt ?? nowIso() };
      }

      const toolCalls = state.toolCalls ?? [];
      for (let i = lastToolCount; i < toolCalls.length; i += 1) {
        yield* toolCallEvents(toolCalls[i]!);
      }
      lastToolCount = toolCalls.length;

      if (state.status === 'done') {
        yield {
          kind: 'turn-done',
          ts: state.completedAt ?? nowIso(),
          stopReason: 'done',
        };
        // Clear the active task so the next observe() waits for the
        // following prompt() rather than re-streaming this turn.
        session.activeTaskId = null;
        return;
      }
      if (state.status === 'error') {
        yield {
          kind: 'error',
          ts: state.completedAt ?? nowIso(),
          code: 'task_error',
          message: state.error ?? 'task error',
        };
        session.activeTaskId = null;
        return;
      }

      lastStatus = state.status;
      await this.sleep(this.pollIntervalMs);
    }
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
