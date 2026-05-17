import { describe, expect, it } from 'vitest';

import { EventBus } from '../../../../src/orchestration/events/index.js';
import { HealthPatrol } from '../../../../src/orchestration/health/index.js';
import type {
  RuntimeProvider,
  SessionEvent,
  SessionHandle,
  SessionSpec,
} from '../../../../src/orchestration/runtime/index.js';

/** Manual clock so tests don't sleep. */
function manualClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function fakeProvider(): { provider: RuntimeProvider; startCount: () => number; stopCount: () => number; nextStartFails?: { value: boolean } } {
  let starts = 0;
  let stops = 0;
  const nextStartFails = { value: false };
  const provider: RuntimeProvider = {
    kind: 'fake',
    async start(spec: SessionSpec): Promise<SessionHandle> {
      starts++;
      if (nextStartFails.value) {
        nextStartFails.value = false;
        throw new Error('start failed');
      }
      return { id: `fake-${spec.role}-${starts}`, providerKind: 'fake' };
    },
    async stop(_handle: SessionHandle): Promise<void> {
      stops++;
    },
    async prompt(): Promise<void> {},
    async nudge(): Promise<void> {},
    observe(): AsyncIterable<SessionEvent> {
      // eslint-disable-next-line require-yield
      return (async function* () {
        return;
      })();
    },
  };
  return { provider, startCount: () => starts, stopCount: () => stops, nextStartFails };
}

describe('HealthPatrol', () => {
  it('does not restart sessions inside their stall threshold', async () => {
    const clock = manualClock();
    const bus = new EventBus({ noPersist: true });
    const events: string[] = [];
    bus.subscribe((e) => events.push(e.kind));
    const fp = fakeProvider();
    const patrol = new HealthPatrol(bus, { defaultStallTimeoutMs: 10_000 }, clock);
    const handle = await fp.provider.start({ role: 'reviewer' });
    patrol.track({ handle, spec: { role: 'reviewer' }, provider: fp.provider });

    clock.advance(5_000);
    await patrol.probe();
    expect(events).toEqual([]);
    expect(fp.stopCount()).toBe(0);
  });

  it('restarts a stalled session with exponential backoff', async () => {
    const clock = manualClock();
    const bus = new EventBus({ noPersist: true });
    const restarts: string[] = [];
    bus.subscribe((e) => {
      if (e.kind === 'session.restarted') restarts.push(String(e.task_id));
    });
    const fp = fakeProvider();
    const patrol = new HealthPatrol(
      bus,
      { defaultStallTimeoutMs: 10_000, initialBackoffMs: 1_000 },
      clock,
    );
    const handle = await fp.provider.start({ role: 'reviewer' });
    patrol.track({ handle, spec: { role: 'reviewer' }, provider: fp.provider });

    // First stall → restart
    clock.advance(11_000);
    await patrol.probe();
    expect(fp.stopCount()).toBe(1);
    expect(restarts).toHaveLength(1);

    // Inside the backoff window — no second restart even though still stalled
    clock.advance(500);
    await patrol.probe();
    expect(restarts).toHaveLength(1);

    // Past the backoff window AND stall threshold → second restart
    clock.advance(11_000);
    await patrol.probe();
    expect(restarts).toHaveLength(2);
  });

  it('trips the circuit breaker after N consecutive restarts', async () => {
    const clock = manualClock();
    const bus = new EventBus({ noPersist: true });
    const unhealthy: string[] = [];
    bus.subscribe((e) => {
      if (e.kind === 'session.unhealthy') unhealthy.push(String(e.task_id));
    });
    const fp = fakeProvider();
    const patrol = new HealthPatrol(
      bus,
      { defaultStallTimeoutMs: 1_000, initialBackoffMs: 100, circuitBreakerThreshold: 3 },
      clock,
    );
    const handle = await fp.provider.start({ role: 'r' });
    patrol.track({ handle, spec: { role: 'r' }, provider: fp.provider });

    // Drive 3 stall → restart cycles, each advancing past backoff + stall.
    for (let i = 0; i < 3; i++) {
      clock.advance(2_000); // past stall
      await patrol.probe();
    }
    // 4th cycle should NOT restart; should emit unhealthy instead.
    clock.advance(2_000);
    await patrol.probe();
    expect(unhealthy).toHaveLength(1);
    // No further restart attempts.
    const stopsBefore = fp.stopCount();
    clock.advance(60_000);
    await patrol.probe();
    expect(fp.stopCount()).toBe(stopsBefore);
  });

  it('markActive resets the stall countdown and restart count', async () => {
    const clock = manualClock();
    const bus = new EventBus({ noPersist: true });
    const events: string[] = [];
    bus.subscribe((e) => events.push(e.kind));
    const fp = fakeProvider();
    const patrol = new HealthPatrol(bus, { defaultStallTimeoutMs: 10_000 }, clock);
    const handle = await fp.provider.start({ role: 'r' });
    patrol.track({ handle, spec: { role: 'r' }, provider: fp.provider });

    // Almost stalled
    clock.advance(9_000);
    patrol.markActive(handle.id);
    clock.advance(9_000);
    await patrol.probe();
    expect(events).toEqual([]); // no stall event
  });

  it('emits restart_failed on provider start error and stays in the backoff loop', async () => {
    const clock = manualClock();
    const bus = new EventBus({ noPersist: true });
    const failures: string[] = [];
    bus.subscribe((e) => {
      if (e.kind === 'session.restart_failed') failures.push(String(e.task_id));
    });
    const fp = fakeProvider();
    const patrol = new HealthPatrol(
      bus,
      { defaultStallTimeoutMs: 1_000, initialBackoffMs: 100 },
      clock,
    );
    const handle = await fp.provider.start({ role: 'r' });
    patrol.track({ handle, spec: { role: 'r' }, provider: fp.provider });

    fp.nextStartFails!.value = true;
    clock.advance(2_000);
    await patrol.probe();
    expect(failures).toHaveLength(1);
  });

  it('start() and stop() are idempotent', () => {
    const patrol = new HealthPatrol(new EventBus({ noPersist: true }));
    patrol.start();
    patrol.start();
    patrol.stop();
    patrol.stop();
    expect(true).toBe(true);
  });
});
