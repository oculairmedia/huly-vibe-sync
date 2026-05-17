/**
 * LettaCodeSubagentProvider — spawn letta-code workers as sessions.
 *
 * Mirrors the spawn pattern used in
 * /opt/stacks/letta-code-parallel/admin-shim/lib/agent-pool.ts so the
 * orchestration daemon can dispatch directly to letta-code subagents
 * without going through the Letta server agent path.
 *
 * Provider-specific start-spec extra fields:
 *   - extra.conversationId?: string — letta-code conversation to attach
 *     to (default: "default", which requires extra.agentId).
 *   - extra.agentId?: string — agent id (required when conversationId
 *     is "default" or unset).
 *   - extra.lettaBin?: string — override the `letta` binary path
 *     (defaults to env LETTA_BIN or "letta").
 *   - extra.cwd?: string — working dir for the spawned process.
 *
 * Wire shape on stdin/stdout matches admin-shim's worker exactly:
 *   stdin:  `{"type":"user","message":{"content":...}}\n` per turn
 *   stdout: stream-json frames, one per line
 *
 * Status: SKELETON. Spawn + stdin write + handle lifecycle wired;
 * stdout parsing → SessionEvent stream deferred to the daemon
 * integration (vibesync-uxx follow-up).
 *
 * See vibesync-rjg.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  ContentBlock,
  RuntimeProvider,
  SessionEvent,
  SessionHandle,
  SessionSpec,
} from './provider.js';

interface LettaCodeHandle extends SessionHandle {
  readonly providerKind: 'letta-code-subagent';
  readonly conversationId: string;
  readonly agentId: string | null;
}

interface SpawnedWorker {
  readonly child: ChildProcessWithoutNullStreams;
  stderrBuf: string;
}

export class LettaCodeSubagentProvider implements RuntimeProvider {
  readonly kind = 'letta-code-subagent';
  private readonly workers = new Map<string, SpawnedWorker>();

  async start(spec: SessionSpec): Promise<SessionHandle> {
    const conversationId = readStringExtra(spec, 'conversationId') ?? 'default';
    const agentId = readStringExtra(spec, 'agentId') ?? null;
    if (conversationId === 'default' && !agentId) {
      throw new Error(
        `LettaCodeSubagentProvider.start: extra.agentId is required when conversationId is "default"`,
      );
    }
    const lettaBin = readStringExtra(spec, 'lettaBin') ?? process.env['LETTA_BIN'] ?? 'letta';
    const cwd = readStringExtra(spec, 'cwd') ?? process.cwd();

    // letta-code CLI rules (per admin-shim agent-pool.ts:206-212):
    // --conversation "default" REQUIRES --agent. Other conv ids
    // REJECT --agent.
    const scope: string[] =
      conversationId === 'default' && agentId
        ? ['--agent', agentId, '--conversation', 'default']
        : ['--conversation', conversationId];
    const args = [
      '--backend',
      'local',
      ...scope,
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
    ];

    const child = spawn(lettaBin, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const worker: SpawnedWorker = { child, stderrBuf: '' };
    child.stderr.on('data', (chunk: Buffer | string) => {
      worker.stderrBuf += chunk.toString('utf8');
      if (worker.stderrBuf.length > 8192) {
        worker.stderrBuf = worker.stderrBuf.slice(-8192);
      }
    });

    const handleId = `letta-code:${agentId ?? 'noagent'}:${conversationId}`;
    const handle: LettaCodeHandle = {
      id: handleId,
      providerKind: 'letta-code-subagent',
      conversationId,
      agentId,
    };
    this.workers.set(handleId, worker);
    return handle;
  }

  async stop(handle: SessionHandle): Promise<void> {
    expectHandle(handle);
    const worker = this.workers.get(handle.id);
    if (!worker) return;
    this.workers.delete(handle.id);
    try {
      worker.child.kill('SIGTERM');
    } catch {
      // ignore — best-effort
    }
  }

  async prompt(handle: SessionHandle, content: readonly ContentBlock[]): Promise<void> {
    expectHandle(handle);
    const worker = this.workers.get(handle.id);
    if (!worker) {
      throw new Error(`LettaCodeSubagentProvider.prompt: no worker for handle ${handle.id}`);
    }
    const messageContent = toLettaCodeContent(content);
    const frame = JSON.stringify({ type: 'user', message: { content: messageContent } }) + '\n';
    if (!worker.child.stdin.writable) {
      throw new Error(`LettaCodeSubagentProvider.prompt: stdin not writable for ${handle.id}`);
    }
    worker.child.stdin.write(frame);
  }

  async nudge(_handle: SessionHandle): Promise<void> {
    // letta-code workers don't have a nudge verb; they wake on the next
    // stdin message. No-op preserves the interface contract.
  }

  /**
   * Skeleton observe — yields a started → turn-done bracket. Full
   * stream-json frame parsing → SessionEvent translation lands when
   * the daemon integrates this provider end-to-end. The admin-shim's
   * /opt/stacks/letta-code-parallel/admin-shim/lib/agent-pool.ts has
   * the parsing logic to mirror.
   */
  async *observe(handle: SessionHandle): AsyncIterable<SessionEvent> {
    expectHandle(handle);
    const ts = new Date().toISOString();
    yield { kind: 'started', ts };
    yield { kind: 'turn-done', ts };
  }
}

function expectHandle(handle: SessionHandle): LettaCodeHandle {
  if (handle.providerKind !== 'letta-code-subagent') {
    throw new Error(
      `LettaCodeSubagentProvider: handle from wrong provider (got ${handle.providerKind}, want letta-code-subagent)`,
    );
  }
  return handle as LettaCodeHandle;
}

function readStringExtra(spec: SessionSpec, key: string): string | undefined {
  const v = spec.extra?.[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Map orchestration ContentBlock array to letta-code's stream-json
 * user-message content shape. letta-code accepts either a plain string
 * or an Anthropic-style content_parts array; we use the array shape
 * for any non-trivial input so multimodal works.
 */
function toLettaCodeContent(content: readonly ContentBlock[]): unknown {
  const onlyPart = content[0];
  if (content.length === 1 && onlyPart && onlyPart.type === 'text') {
    return onlyPart.text;
  }
  return content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    return {
      type: 'image',
      source: { type: 'base64', media_type: block.mimeType, data: block.data },
    };
  });
}
