import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HulyWebhookHandler } from '../../lib/HulyWebhookHandler.js';

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
});
