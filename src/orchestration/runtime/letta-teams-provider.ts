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
 * Status: SKELETON. observe() yields synthetic started/turn-done; the
 * SDK's task-progress hooks are reachable via runtime.tasks.wait() but
 * full event-bus mapping is deferred to the daemon (vibesync-uxx
 * follow-up).
 *
 * See vibesync-y0z.
 */

import type {
  ContentBlock,
  RuntimeProvider,
  SessionEvent,
  SessionHandle,
  SessionSpec,
} from './provider.js';

// Type-only import — keeps the SDK out of the runtime require graph
// until first construction.
type TeamsRuntime = import('letta-teams-sdk').TeamsRuntime;
type SpawnTeammateInput = import('letta-teams-sdk').SpawnTeammateInput;

interface LettaTeamsSessionHandle extends SessionHandle {
  readonly providerKind: 'letta-teams';
  /** Teammate name in letta-teams-sdk (also the dispatch target). */
  readonly target: string;
}

export class LettaTeamsProvider implements RuntimeProvider {
  readonly kind = 'letta-teams';
  private runtime: TeamsRuntime | null = null;

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
    return handle;
  }

  async stop(handle: SessionHandle): Promise<void> {
    const h = expectHandle(handle);
    const runtime = await this.getRuntime();
    // Stop is teammate removal; the SDK does its own confirmation flow
    // for destructive operations. For VibeSync's lifecycle we just call
    // remove and accept the false result if it failed.
    await runtime.teammates.remove(h.target);
  }

  async prompt(handle: SessionHandle, content: readonly ContentBlock[]): Promise<void> {
    const h = expectHandle(handle);
    const runtime = await this.getRuntime();
    const message = contentToText(content);
    await runtime.tasks.dispatch({ target: h.target, message });
  }

  async nudge(_handle: SessionHandle): Promise<void> {
    // letta-teams-sdk has no nudge verb; the daemon polls on its own.
  }

  /**
   * Skeleton observe — yields a started → turn-done bracket so callers
   * can integration-test the lifecycle. Full event mapping (tasks.wait
   * progress → SessionEvent stream) lands when the daemon integrates
   * this provider end-to-end.
   */
  async *observe(handle: SessionHandle): AsyncIterable<SessionEvent> {
    expectHandle(handle);
    const ts = new Date().toISOString();
    yield { kind: 'started', ts };
    yield { kind: 'turn-done', ts };
    // TODO(vibesync-uxx follow-up): subscribe to runtime.tasks
    // updates and translate into SessionEvent.
  }
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
