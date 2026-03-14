import { beforeEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn();
const execute = vi.fn();

vi.mock('../../../temporal/client/connection', () => ({
  TASK_QUEUE: 'test-queue',
  getClient: vi.fn(async () => ({
    workflow: {
      start,
      execute,
    },
  })),
}));

describe('event-triggers', () => {
  beforeEach(() => {
    start.mockReset();
    execute.mockReset();
    start.mockResolvedValue({
      workflowId: 'wf-1',
      firstExecutionRunId: 'run-1',
    });
    execute.mockResolvedValue({ success: true });
  });

  it('schedules each webhook batch with a unique workflow id', async () => {
    const { scheduleHulyWebhookChange } = await import('../../../temporal/client/event-triggers');
    const input = {
      type: 'task.changed' as const,
      timestamp: '2026-03-14T00:17:39.007Z',
      changes: [],
    };

    await scheduleHulyWebhookChange(input);
    await scheduleHulyWebhookChange(input);

    expect(start).toHaveBeenCalledTimes(2);
    const firstWorkflowId = start.mock.calls[0][1].workflowId;
    const secondWorkflowId = start.mock.calls[1][1].workflowId;
    expect(firstWorkflowId).toMatch(/^huly-webhook-task\.changed-/);
    expect(secondWorkflowId).toMatch(/^huly-webhook-task\.changed-/);
    expect(firstWorkflowId).not.toBe(secondWorkflowId);
  });

  it('executes webhook workflows with unique workflow ids', async () => {
    const { executeHulyWebhookChange } = await import('../../../temporal/client/event-triggers');
    const input = {
      type: 'task.changed' as const,
      timestamp: '2026-03-14T00:17:39.007Z',
      changes: [],
    };

    await executeHulyWebhookChange(input);
    await executeHulyWebhookChange(input);

    expect(execute).toHaveBeenCalledTimes(2);
    const firstWorkflowId = execute.mock.calls[0][1].workflowId;
    const secondWorkflowId = execute.mock.calls[1][1].workflowId;
    expect(firstWorkflowId).not.toBe(secondWorkflowId);
  });
});
