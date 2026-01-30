import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HulyWebhookHandler, createWebhookHandler } from '../../lib/HulyWebhookHandler.js';

describe('HulyWebhookHandler', () => {
  let handler;
  let mockDb;
  let mockOnChangesReceived;

  beforeEach(() => {
    mockDb = {};
    mockOnChangesReceived = vi.fn().mockResolvedValue({ success: true });
    handler = new HulyWebhookHandler({
      db: mockDb,
      onChangesReceived: mockOnChangesReceived,
      changeWatcherUrl: 'http://localhost:3459',
      callbackUrl: 'http://localhost:3099/webhook',
    });
  });

  describe('handleWebhook', () => {
    describe('legacy format', () => {
      it('should accept legacy format with top-level type', async () => {
        const payload = {
          type: 'task.changed',
          timestamp: Date.now(),
          changes: [
            {
              id: 'issue-1',
              class: 'tracker:class:Issue',
              data: { identifier: 'TEST-1', title: 'Test Issue' },
            },
          ],
        };

        const result = await handler.handleWebhook(payload);

        expect(result.success).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject payload without type or events', async () => {
        const payload = {
          timestamp: Date.now(),
          changes: [],
        };

        const result = await handler.handleWebhook(payload);

        expect(result.success).toBe(false);
        expect(result.errors).toContain('Invalid webhook payload: missing type or events');
      });
    });

    describe('change-watcher format', () => {
      it('should accept change-watcher format with events array', async () => {
        const payload = {
          source: 'huly-change-watcher',
          timestamp: Date.now(),
          events: [
            {
              type: 'issue.updated',
              timestamp: Date.now(),
              data: {
                id: 'issue-1',
                class: 'tracker:class:Issue',
                identifier: 'TEST-1',
                title: 'Test Issue',
                status: 'active:Active',
              },
            },
          ],
        };

        const result = await handler.handleWebhook(payload);

        expect(result.success).toBe(true);
        expect(result.processed).toBe(1);
      });

      it('should transform events to expected format for handlers', async () => {
        const payload = {
          source: 'huly-change-watcher',
          timestamp: Date.now(),
          events: [
            {
              type: 'issue.updated',
              data: {
                id: 'issue-1',
                class: 'tracker:class:Issue',
                identifier: 'PROJ-123',
                title: 'Test Issue',
              },
            },
          ],
        };

        await handler.handleWebhook(payload);

        expect(mockOnChangesReceived).toHaveBeenCalled();
        const callArg = mockOnChangesReceived.mock.calls[0][0];
        expect(callArg.type).toBe('task.changed');
        expect(callArg.changes).toHaveLength(1);
        expect(callArg.changes[0].class).toBe('tracker:class:Issue');
        expect(callArg.changes[0].data.identifier).toBe('PROJ-123');
      });

      it('should separate issue and project changes', async () => {
        const payload = {
          source: 'huly-change-watcher',
          timestamp: Date.now(),
          events: [
            {
              type: 'issue.updated',
              data: { id: 'issue-1', class: 'tracker:class:Issue', identifier: 'TEST-1' },
            },
            {
              type: 'project.updated',
              data: { id: 'proj-1', class: 'tracker:class:Project', identifier: 'TEST' },
            },
          ],
        };

        const result = await handler.handleWebhook(payload);

        expect(result.success).toBe(true);
        expect(mockOnChangesReceived).toHaveBeenCalledTimes(2);
      });

      it('should handle empty events array', async () => {
        const payload = {
          source: 'huly-change-watcher',
          timestamp: Date.now(),
          events: [],
        };

        const result = await handler.handleWebhook(payload);

        expect(result.success).toBe(true);
        expect(result.processed).toBe(0);
      });
    });

    describe('error handling', () => {
      it('should reject null payload', async () => {
        const result = await handler.handleWebhook(null);

        expect(result.success).toBe(false);
        expect(result.errors).toContain('Invalid webhook payload: empty');
      });

      it('should reject undefined payload', async () => {
        const result = await handler.handleWebhook(undefined);

        expect(result.success).toBe(false);
        expect(result.errors).toContain('Invalid webhook payload: empty');
      });

      it('should track errors in stats', async () => {
        await handler.handleWebhook(null);
        await handler.handleWebhook(undefined);

        const stats = handler.getStats();
        expect(stats.errors).toBe(2);
      });
    });
  });

  describe('groupChangesByProject', () => {
    it('should group changes by project identifier prefix', () => {
      const changes = [
        { data: { identifier: 'PROJ-1' } },
        { data: { identifier: 'PROJ-2' } },
        { data: { identifier: 'OTHER-1' } },
      ];

      const grouped = handler.groupChangesByProject(changes);

      expect(grouped.get('PROJ')).toHaveLength(2);
      expect(grouped.get('OTHER')).toHaveLength(1);
    });

    it('should handle changes without identifier', () => {
      const changes = [
        { data: { identifier: 'PROJ-1' } },
        { data: {} },
        { data: { identifier: 'PROJ-2' } },
      ];

      const grouped = handler.groupChangesByProject(changes);

      expect(grouped.get('PROJ')).toHaveLength(2);
      expect(grouped.size).toBe(1);
    });
  });

  describe('stats tracking', () => {
    it('should track webhooks received', async () => {
      await handler.handleWebhook({ type: 'task.changed', changes: [] });
      await handler.handleWebhook({ type: 'task.changed', changes: [] });

      const stats = handler.getStats();
      expect(stats.webhooksReceived).toBe(2);
    });

    it('should track last webhook received timestamp', async () => {
      const before = new Date().toISOString();
      await handler.handleWebhook({ type: 'task.changed', changes: [] });
      const after = new Date().toISOString();

      const stats = handler.getStats();
      expect(stats.lastWebhookReceived).toBeDefined();
      expect(stats.lastWebhookReceived >= before).toBe(true);
      expect(stats.lastWebhookReceived <= after).toBe(true);
    });
  });

  describe('subscribe', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should return true and set subscribed on success', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ subscriptionId: 'sub-1' }),
      });

      const result = await handler.subscribe();

      expect(result).toBe(true);
      expect(handler.subscribed).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3459/subscribe',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should return false on non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const result = await handler.subscribe();

      expect(result).toBe(false);
      expect(handler.subscribed).toBe(false);
    });

    it('should return false on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await handler.subscribe();

      expect(result).toBe(false);
    });
  });

  describe('unsubscribe', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should return true and set subscribed=false on success', async () => {
      handler.subscribed = true;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const result = await handler.unsubscribe();

      expect(result).toBe(true);
      expect(handler.subscribed).toBe(false);
    });

    it('should return false on non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      });

      const result = await handler.unsubscribe();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await handler.unsubscribe();

      expect(result).toBe(false);
    });
  });

  describe('checkHealth', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should return true when service is healthy', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const result = await handler.checkHealth();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3459/health',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return false when service is unhealthy', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false });

      const result = await handler.checkHealth();

      expect(result).toBe(false);
    });

    it('should return false on timeout/error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Timeout'));

      const result = await handler.checkHealth();

      expect(result).toBe(false);
    });
  });

  describe('getWatcherStats', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should return stats on success', async () => {
      const stats = { watchers: 5, uptime: 1000 };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => stats,
      });

      const result = await handler.getWatcherStats();

      expect(result).toEqual(stats);
    });

    it('should return null on non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false });

      const result = await handler.getWatcherStats();

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await handler.getWatcherStats();

      expect(result).toBeNull();
    });
  });

  describe('handleTaskChanges edge cases', () => {
    it('should return early for empty changes array', async () => {
      const result = await handler.handleWebhook({
        type: 'task.changed',
        changes: [],
      });

      expect(result.success).toBe(true);
      expect(result.processed).toBe(0);
      expect(mockOnChangesReceived).not.toHaveBeenCalled();
    });

    it('should skip non-Issue/Project class changes', async () => {
      const result = await handler.handleWebhook({
        type: 'task.changed',
        changes: [
          { id: 'c1', class: 'tracker:class:Comment', data: { identifier: 'X-1' } },
          { id: 'c2', class: 'core:class:Account', data: { identifier: 'Y-1' } },
        ],
      });

      expect(result.skipped).toBe(2);
      expect(mockOnChangesReceived).not.toHaveBeenCalled();
    });

    it('should skip oversized batch (>50 changes)', async () => {
      const changes = Array.from({ length: 51 }, (_, i) => ({
        id: `issue-${i}`,
        class: 'tracker:class:Issue',
        data: { identifier: `TEST-${i}` },
      }));

      const result = await handler.handleWebhook({
        type: 'task.changed',
        changes,
      });

      expect(result.skipped).toBe(51);
      expect(mockOnChangesReceived).not.toHaveBeenCalled();
    });

    it('should log warning and skip when no onChangesReceived handler', async () => {
      const noCallbackHandler = new HulyWebhookHandler({ db: mockDb });

      const result = await noCallbackHandler.handleWebhook({
        type: 'task.changed',
        changes: [{ id: 'i1', class: 'tracker:class:Issue', data: { identifier: 'TEST-1' } }],
      });

      expect(result.skipped).toBe(1);
    });

    it('should track error when onChangesReceived throws', async () => {
      mockOnChangesReceived.mockRejectedValueOnce(new Error('Callback failed'));

      const result = await handler.handleWebhook({
        type: 'task.changed',
        changes: [{ id: 'i1', class: 'tracker:class:Issue', data: { identifier: 'TEST-1' } }],
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Callback failed');
      expect(handler.stats.errors).toBeGreaterThanOrEqual(1);
    });
  });

  describe('handleProjectChanges edge cases', () => {
    it('should return early for empty changes', async () => {
      const result = await handler.handleWebhook({
        type: 'project.created',
        changes: [],
      });

      expect(result.success).toBe(true);
      expect(result.processed).toBe(0);
      expect(mockOnChangesReceived).not.toHaveBeenCalled();
    });

    it('should process project changes with onChangesReceived', async () => {
      const result = await handler.handleWebhook({
        type: 'project.updated',
        changes: [{ id: 'p1', class: 'tracker:class:Project', data: { name: 'TestProject' } }],
      });

      expect(result.success).toBe(true);
      expect(result.processed).toBe(1);
      expect(mockOnChangesReceived).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'project.changed' })
      );
    });

    it('should skip when no onChangesReceived handler', async () => {
      const noCallbackHandler = new HulyWebhookHandler({ db: mockDb });

      const result = await noCallbackHandler.handleWebhook({
        type: 'project.updated',
        changes: [{ id: 'p1', class: 'tracker:class:Project', data: { name: 'TestProject' } }],
      });

      expect(result.skipped).toBe(1);
    });

    it('should track error when onChangesReceived throws', async () => {
      mockOnChangesReceived.mockRejectedValueOnce(new Error('Project callback failed'));

      const result = await handler.handleWebhook({
        type: 'project.updated',
        changes: [{ id: 'p1', class: 'tracker:class:Project', data: { name: 'TestProject' } }],
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Project callback failed');
    });
  });

  describe('legacy format event types', () => {
    it('should handle task.updated type', async () => {
      const result = await handler.handleWebhook({
        type: 'task.updated',
        changes: [{ id: 'i1', class: 'tracker:class:Issue', data: { identifier: 'T-1' } }],
      });

      expect(result.success).toBe(true);
      expect(result.processed).toBe(1);
    });

    it('should handle project.created type', async () => {
      const result = await handler.handleWebhook({
        type: 'project.created',
        changes: [{ id: 'p1', class: 'tracker:class:Project', data: { name: 'New' } }],
      });

      expect(result.success).toBe(true);
      expect(result.processed).toBe(1);
    });

    it('should handle unknown event type', async () => {
      const result = await handler.handleWebhook({
        type: 'unknown.event',
        changes: [{ id: 'x1' }, { id: 'x2' }],
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(2);
    });
  });

  describe('getStats', () => {
    it('should return all stat fields', () => {
      const stats = handler.getStats();

      expect(stats).toEqual({
        subscribed: false,
        changeWatcherUrl: 'http://localhost:3459',
        callbackUrl: 'http://localhost:3099/webhook',
        lastWebhookReceived: null,
        webhooksReceived: 0,
        changesProcessed: 0,
        errors: 0,
      });
    });

    it('should reflect updated stats after processing', async () => {
      await handler.handleWebhook({
        type: 'task.changed',
        changes: [{ id: 'i1', class: 'tracker:class:Issue', data: { identifier: 'T-1' } }],
      });

      const stats = handler.getStats();
      expect(stats.webhooksReceived).toBe(1);
      expect(stats.changesProcessed).toBe(1);
    });
  });

  describe('createWebhookHandler', () => {
    it('should create a HulyWebhookHandler instance', () => {
      const h = createWebhookHandler({ db: mockDb });

      expect(h).toBeInstanceOf(HulyWebhookHandler);
    });

    it('should pass options through', () => {
      const cb = vi.fn();
      const h = createWebhookHandler({
        db: mockDb,
        onChangesReceived: cb,
        changeWatcherUrl: 'http://custom:1234',
        callbackUrl: 'http://callback:5678/hook',
      });

      const stats = h.getStats();
      expect(stats.changeWatcherUrl).toBe('http://custom:1234');
      expect(stats.callbackUrl).toBe('http://callback:5678/hook');
    });
  });
});
