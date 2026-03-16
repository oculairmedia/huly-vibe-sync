import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../temporal/lib', () => ({
  createHulyClient: vi.fn(),
  createVibeClient: vi.fn(),
  createVibeSyncClient: vi.fn(),
}));

vi.mock('../../../temporal/activities/huly-dedupe', () => ({
  findMappedIssueByTitle: vi.fn().mockResolvedValue(null),
}));

import { createHulyClient } from '../../../temporal/lib';
import { createVibeClient, createVibeSyncClient } from '../../../temporal/lib';
import {
  compensateBeadsCreate,
  compensateHulyCreate,
  compensateVibeCreate,
  syncToBeads,
  syncToHuly,
  syncToVibe,
  type IssueSyncInput,
} from '../../../temporal/activities/issue-sync';

const originalBeadsSyncEnabled = process.env.BEADS_SYNC_ENABLED;

const mockHulyClient = {
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  deleteIssue: vi.fn(),
};

const mockVibeClient = {
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
};

const mockVibeSyncClient = {
  syncBeads: vi.fn(),
  deleteBeads: vi.fn(),
};

function makeInput(overrides: Partial<IssueSyncInput> = {}): IssueSyncInput {
  return {
    operation: 'create',
    source: 'vibe',
    issue: {
      title: 'Test issue',
      status: 'Todo',
      projectId: 'project-1',
      projectIdentifier: 'HVSYN',
      identifier: 'HVSYN-123',
    },
    ...overrides,
  };
}

describe('issue-sync activities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BEADS_SYNC_ENABLED = 'true';
    (createHulyClient as any).mockReturnValue(mockHulyClient);
    (createVibeClient as any).mockReturnValue(mockVibeClient);
    (createVibeSyncClient as any).mockReturnValue(mockVibeSyncClient);
    mockHulyClient.createIssue.mockResolvedValue({ identifier: 'HVSYN-123' });
    mockHulyClient.updateIssue.mockResolvedValue({ identifier: 'HVSYN-123' });
    mockHulyClient.deleteIssue.mockResolvedValue(true);
    mockVibeClient.createTask.mockResolvedValue({ id: 'vibe-123' });
    mockVibeClient.updateTask.mockResolvedValue({ id: 'vibe-123' });
    mockVibeClient.deleteTask.mockResolvedValue(true);
    mockVibeSyncClient.syncBeads.mockResolvedValue({
      results: [{ project: 'project-1', workflowId: 'workflow-123' }],
    });
    mockVibeSyncClient.deleteBeads.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    if (originalBeadsSyncEnabled === undefined) {
      delete process.env.BEADS_SYNC_ENABLED;
      return;
    }

    process.env.BEADS_SYNC_ENABLED = originalBeadsSyncEnabled;
  });

  it('routes Huly create through HulyClient', async () => {
    const result = await syncToHuly(
      makeInput({
        operation: 'create',
      })
    );

    expect(result).toEqual({ success: true, systemId: 'HVSYN-123' });
    expect(createHulyClient).toHaveBeenCalled();
    expect(mockHulyClient.createIssue).toHaveBeenCalledWith('HVSYN', {
      title: 'Test issue',
      description: '',
      status: 'Todo',
      priority: 'NoPriority',
    });
  });

  it('routes Huly updates through HulyClient', async () => {
    const result = await syncToHuly(
      makeInput({
        operation: 'update',
      })
    );

    expect(result).toEqual({ success: true, systemId: 'HVSYN-123' });
    expect(mockHulyClient.updateIssue).toHaveBeenCalledWith('HVSYN-123', 'status', 'Todo');
  });

  it('routes Huly compensation deletes through HulyClient', async () => {
    const result = await compensateHulyCreate({ hulyIdentifier: 'HVSYN-123' });

    expect(result).toEqual({ success: true });
    expect(mockHulyClient.deleteIssue).toHaveBeenCalledWith('HVSYN-123');
  });

  it('routes Vibe create through VibeClient', async () => {
    const result = await syncToVibe(makeInput({ operation: 'create' }));

    expect(result).toEqual({ success: true, systemId: 'vibe-123' });
    expect(createVibeClient).toHaveBeenCalled();
    expect(mockVibeClient.createTask).toHaveBeenCalledWith('project-1', {
      title: 'Test issue',
      description: '',
      status: 'todo',
      hulyRef: 'HVSYN-123',
    });
  });

  it('routes Vibe updates through VibeClient', async () => {
    const result = await syncToVibe(
      makeInput({
        operation: 'update',
        issue: {
          title: 'Test issue',
          status: 'In Progress',
          projectId: 'project-1',
          projectIdentifier: 'HVSYN',
          identifier: 'HVSYN-123',
          vibeId: 'vibe-123',
        },
      })
    );

    expect(result).toEqual({ success: true, systemId: 'vibe-123' });
    expect(mockVibeClient.updateTask).toHaveBeenCalledWith('vibe-123', {
      status: 'inprogress',
    });
  });

  it('routes Beads sync through VibeSyncClient', async () => {
    const result = await syncToBeads(makeInput());

    expect(result).toEqual({ success: true, systemId: 'workflow-123' });
    expect(createVibeSyncClient).toHaveBeenCalled();
    expect(mockVibeSyncClient.syncBeads).toHaveBeenCalledWith({ projectId: 'project-1' });
  });

  it('routes Vibe compensation deletes through VibeClient', async () => {
    const result = await compensateVibeCreate({ vibeId: 'vibe-123' });

    expect(result).toEqual({ success: true });
    expect(mockVibeClient.deleteTask).toHaveBeenCalledWith('vibe-123');
  });

  it('routes Beads compensation deletes through VibeSyncClient', async () => {
    const result = await compensateBeadsCreate({ beadsId: 'beads-123' });

    expect(result).toEqual({ success: true });
    expect(mockVibeSyncClient.deleteBeads).toHaveBeenCalledWith({ beadsId: 'beads-123' });
  });
});
