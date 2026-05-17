/**
 * HealthPatrol — probe RuntimeProvider liveness; restart on stall with
 * exponential backoff + circuit-breaker.
 *
 * Subscribes to the EventBus to learn when sessions have activity, then
 * checks each tracked session at a configurable interval. If a session
 * has been idle longer than its stall threshold mid-task, the patrol
 * publishes `health-patrol/session.stalled`, attempts a graceful stop
 * + restart, and tracks consecutive restart counts. After N restarts
 * the session is marked `unhealthy` and auto-restart stops; manual
 * intervention required.
 *
 * Layering invariants:
 *   - Reads session state ONLY via the RuntimeProvider seam (no peeking
 *     into provider internals)
 *   - Publishes all observations on the EventBus (no direct callbacks
 *     into higher layers)
 *   - Config-driven (per-session stall thresholds + circuit breaker
 *     limits), no hardcoded values for specific providers or roles
 *
 * See vibesync-458.
 */

import type { EventBus } from '../events/index.js';
import type { RuntimeProvider, SessionHandle, SessionSpec } from '../runtime/index.js';

export interface HealthPatrolConfig {
  /** Probe interval in ms (default 30s). */
  readonly probeIntervalMs?: number;
  /** Default stall timeout in ms before a session is considered stalled (default 2 min). */
  readonly defaultStallTimeoutMs?: number;
  /** Initial restart backoff in ms (default 10s). */
  readonly initialBackoffMs?: number;
  /** Max restart backoff in ms (default 5 min). */
  readonly maxBackoffMs?: number;
  /** Restarts before tripping the circuit breaker (default 5). */
  readonly circuitBreakerThreshold?: number;
}

interface TrackedSession {
  readonly handle: SessionHandle;
  readonly spec: SessionSpec;
  readonly provider: RuntimeProvider;
  readonly stallTimeoutMs: number;
  /** ms epoch of last observed activity. */
  lastActiveAt: number;
  /** Consecutive restart attempts at the current circuit-breaker state. */
  restartCount: number;
  /** ms epoch when the next restart is permitted (backoff gate). */
  nextRestartAt: number;
  /** Marked unhealthy after circuit breaker trips. */
  unhealthy: boolean;
}

/**
 * Test-time clock seam. Lets unit tests advance time without real sleeps.
 */
export interface Clock {
  now(): number;
}
const defaultClock: Clock = { now: () => Date.now() };

export class HealthPatrol {
  private readonly bus: EventBus;
  private readonly cfg: Required<HealthPatrolConfig>;
  private readonly clock: Clock;
  private readonly sessions = new Map<string, TrackedSession>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(bus: EventBus, cfg: HealthPatrolConfig = {}, clock: Clock = defaultClock) {
    this.bus = bus;
    this.clock = clock;
    this.cfg = {
      probeIntervalMs: cfg.probeIntervalMs ?? 30_000,
      defaultStallTimeoutMs: cfg.defaultStallTimeoutMs ?? 120_000,
      initialBackoffMs: cfg.initialBackoffMs ?? 10_000,
      maxBackoffMs: cfg.maxBackoffMs ?? 5 * 60_000,
      circuitBreakerThreshold: cfg.circuitBreakerThreshold ?? 5,
    };
  }

  /** Start the periodic probe loop. Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.probe(), this.cfg.probeIntervalMs);
  }

  /** Stop the periodic probe loop. Idempotent. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Begin tracking a session. Configurable stall timeout per session. */
  track(args: {
    readonly handle: SessionHandle;
    readonly spec: SessionSpec;
    readonly provider: RuntimeProvider;
    readonly stallTimeoutMs?: number;
  }): void {
    this.sessions.set(args.handle.id, {
      handle: args.handle,
      spec: args.spec,
      provider: args.provider,
      stallTimeoutMs: args.stallTimeoutMs ?? this.cfg.defaultStallTimeoutMs,
      lastActiveAt: this.clock.now(),
      restartCount: 0,
      nextRestartAt: 0,
      unhealthy: false,
    });
  }

  /** Stop tracking a session. */
  untrack(handleId: string): void {
    this.sessions.delete(handleId);
  }

  /**
   * Record activity for a session, resetting its stall countdown. Call
   * this from the daemon whenever observe() yields a SessionEvent for
   * the session.
   */
  markActive(handleId: string): void {
    const s = this.sessions.get(handleId);
    if (!s) return;
    s.lastActiveAt = this.clock.now();
    // Activity also resets the consecutive-restart counter — the session
    // is recovering on its own.
    s.restartCount = 0;
  }

  /**
   * One probe pass. Public so tests can drive it without waiting on
   * setInterval.
   */
  async probe(): Promise<void> {
    const now = this.clock.now();
    const toRestart: TrackedSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.unhealthy) continue;
      const idleFor = now - s.lastActiveAt;
      if (idleFor < s.stallTimeoutMs) continue;
      this.bus.emit({
        layer: 'health-patrol',
        kind: 'session.stalled',
        task_id: s.handle.id,
        payload: {
          provider: s.provider.kind,
          idle_ms: idleFor,
          stall_timeout_ms: s.stallTimeoutMs,
          restart_count: s.restartCount,
        },
      });
      if (now < s.nextRestartAt) continue;
      if (s.restartCount >= this.cfg.circuitBreakerThreshold) {
        s.unhealthy = true;
        this.bus.emit({
          layer: 'health-patrol',
          kind: 'session.unhealthy',
          task_id: s.handle.id,
          payload: {
            provider: s.provider.kind,
            restart_count: s.restartCount,
            threshold: this.cfg.circuitBreakerThreshold,
          },
        });
        continue;
      }
      toRestart.push(s);
    }
    // Restart outside the iteration in case provider.stop/start triggers
    // markActive on the same session.
    for (const s of toRestart) {
      await this.restart(s, now);
    }
  }

  private async restart(s: TrackedSession, now: number): Promise<void> {
    const backoff = Math.min(
      this.cfg.initialBackoffMs * 2 ** s.restartCount,
      this.cfg.maxBackoffMs,
    );
    s.restartCount += 1;
    s.nextRestartAt = now + backoff;
    this.bus.emit({
      layer: 'health-patrol',
      kind: 'session.restarting',
      task_id: s.handle.id,
      payload: {
        provider: s.provider.kind,
        restart_count: s.restartCount,
        backoff_ms: backoff,
      },
    });
    try {
      await s.provider.stop(s.handle);
      const newHandle = await s.provider.start(s.spec);
      // Replace the tracked handle (new id) with the same TrackedSession.
      this.sessions.delete(s.handle.id);
      this.sessions.set(newHandle.id, { ...s, handle: newHandle, lastActiveAt: this.clock.now() });
      this.bus.emit({
        layer: 'health-patrol',
        kind: 'session.restarted',
        task_id: newHandle.id,
        payload: { provider: s.provider.kind, previous_handle_id: s.handle.id },
      });
    } catch (err) {
      this.bus.emit({
        layer: 'health-patrol',
        kind: 'session.restart_failed',
        task_id: s.handle.id,
        payload: {
          provider: s.provider.kind,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  /** Diagnostic: snapshot of currently tracked sessions. */
  snapshot(): readonly { readonly id: string; readonly restartCount: number; readonly unhealthy: boolean }[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.handle.id,
      restartCount: s.restartCount,
      unhealthy: s.unhealthy,
    }));
  }
}
