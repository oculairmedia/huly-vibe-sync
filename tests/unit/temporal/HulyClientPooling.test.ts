import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createdPools: Array<{
  origin: string;
  options: Record<string, unknown>;
  close: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('undici', () => ({
  Pool: class MockPool {
    origin: string;
    options: Record<string, unknown>;
    close: ReturnType<typeof vi.fn>;

    constructor(origin: string, options: Record<string, unknown>) {
      this.origin = origin;
      this.options = options;
      this.close = vi.fn().mockResolvedValue(undefined);
      createdPools.push(this);
    }
  },
}));

import {
  HulyClient,
  clearHulyClientCache,
  createHulyClient,
} from '../../../temporal/lib/HulyClient';
import { clearPooledDispatchers } from '../../../temporal/lib/httpPool';

describe('Temporal HulyClient pooling', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    createdPools.length = 0;
    clearHulyClientCache();
    clearPooledDispatchers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearHulyClientCache();
    clearPooledDispatchers();
    vi.clearAllMocks();
  });

  it('reuses a singleton client for the same normalized endpoint and options', () => {
    const first = createHulyClient('http://huly.internal:9999/mcp', { timeout: 30_000 });
    const second = createHulyClient('http://huly.internal:3458/api', { timeout: 30_000 });

    expect(first).toBe(second);
    expect(createdPools).toHaveLength(1);
    expect(createdPools[0]).toMatchObject({
      origin: 'http://huly.internal:3458',
      options: {
        connections: 10,
        pipelining: 1,
        keepAliveTimeout: 300_000,
        keepAliveMaxTimeout: 600_000,
      },
    });
  });

  it('passes the shared dispatcher on API requests', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [] }),
    });

    const client = new HulyClient('http://localhost:3458');
    await client.listProjects();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3458/api/projects',
      expect.objectContaining({
        dispatcher: expect.any(Object),
      })
    );
    expect(createdPools).toHaveLength(1);
    expect((global.fetch as any).mock.calls[0][1].dispatcher).toBe(createdPools[0]);
  });

  it('uses the same dispatcher for health checks', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', connected: true }),
    });

    const client = new HulyClient('http://localhost:3458');
    await client.healthCheck();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3458/health',
      expect.objectContaining({
        dispatcher: expect.any(Object),
      })
    );
    expect((global.fetch as any).mock.calls[0][1].dispatcher).toBe(createdPools[0]);
  });
});
