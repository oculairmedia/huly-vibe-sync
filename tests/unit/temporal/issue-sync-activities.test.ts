import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../temporal/lib', () => ({
  createVibeClient: vi.fn(),
}));

vi.mock('../../../temporal/activities/huly-dedupe', () => ({
  findMappedIssueByTitle: vi.fn().mockResolvedValue(null),
}));

import { createVibeClient } from '../../../temporal/lib';
import {
  compensateHulyCreate,
  compensateVibeCreate,
  syncToHuly,
  syncToVibe,
  type IssueSyncInput,
} from '../../../temporal/activities/issue-sync';

const mockVibeClient = {
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
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
    (createVibeClient as any).mockReturnValue(mockVibeClient);
    mockVibeClient.createTask.mockResolvedValue({ id: 'vibe-123' });
    mockVibeClient.updateTask.mockResolvedValue({ id: 'vibe-123' });
    mockVibeClient.deleteTask.mockResolvedValue(true);
  });

  it('routes Huly create (returns skipped stub)', async () => {
    const result = await syncToHuly(
      makeInput({
        operation: 'create',
      })
    );

    expect(result).toEqual({ success: true, skipped: true });
  });

  it('routes Huly updates (returns skipped stub)', async () => {
    const result = await syncToHuly(
      makeInput({
        operation: 'update',
      })
    );

    expect(result).toEqual({ success: true, skipped: true });
  });

  it('routes Huly compensation deletes (returns skipped stub)', async () => {
    const result = await compensateHulyCreate({ hulyIdentifier: 'HVSYN-123' });

    expect(result).toEqual({ success: true, skipped: true });
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

  it('routes Vibe compensation deletes through VibeClient', async () => {
    const result = await compensateVibeCreate({ vibeId: 'vibe-123' });

    expect(result).toEqual({ success: true });
    expect(mockVibeClient.deleteTask).toHaveBeenCalledWith('vibe-123');
  });
});
