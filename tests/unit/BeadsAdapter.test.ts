import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BeadsAdapter } from '../../src/beads/BeadsAdapter.js';

describe('BeadsAdapter cache controls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('proactively evicts expired entries during writes', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);

    const adapter = new BeadsAdapter({ cacheTtlMs: 50, cacheMaxEntries: 10, runCommand: vi.fn() });
    adapter.setCache('project-a:work-items', [{ id: 'a' }]);

    nowSpy.mockReturnValue(1_100);
    adapter.setCache('project-b:work-items', [{ id: 'b' }]);

    expect(adapter.cache.has('project-a:work-items')).toBe(false);
    expect(adapter.cache.has('project-b:work-items')).toBe(true);
    expect(adapter.cache.size).toBe(1);
  });

  it('bounds cache size and evicts the oldest entry first', () => {
    const adapter = new BeadsAdapter({ cacheTtlMs: 10_000, cacheMaxEntries: 2, runCommand: vi.fn() });

    adapter.setCache('project-a:work-items', [{ id: 'a' }]);
    adapter.setCache('project-b:work-items', [{ id: 'b' }]);
    adapter.setCache('project-c:work-items', [{ id: 'c' }]);

    expect(adapter.cache.has('project-a:work-items')).toBe(false);
    expect(adapter.cache.has('project-b:work-items')).toBe(true);
    expect(adapter.cache.has('project-c:work-items')).toBe(true);
    expect(adapter.cache.size).toBe(2);
  });

  it('reuses normalized work items from cache until force refresh', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'issue-1',
          title: 'Ready work',
          status: 'todo',
          priority: 'P1',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'issue-2',
          title: 'Fresh work',
          status: 'done',
          priority: 'P2',
          updated_at: '2026-01-02T00:00:00.000Z',
        },
      ]);

    const adapter = new BeadsAdapter({ cacheTtlMs: 10_000, cacheMaxEntries: 10, runCommand });
    const project = { identifier: 'PROJ', filesystem_path: '/tmp/proj' };

    const first = await adapter.getProjectWorkItems(project);
    const second = await adapter.getProjectWorkItems(project, { status: 'todo' });
    const refreshed = await adapter.getProjectWorkItems(project, { forceRefresh: true });

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].id).toBe('issue-1');
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).toBe('issue-1');
    expect(refreshed.items).toHaveLength(1);
    expect(refreshed.items[0].id).toBe('issue-2');
  });
});
