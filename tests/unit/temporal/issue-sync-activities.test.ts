import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../temporal/lib', () => ({
  createHulyClient: vi.fn(),
}));

vi.mock('../../../temporal/activities/huly-dedupe', () => ({
  findMappedIssueByTitle: vi.fn().mockResolvedValue(null),
}));

import { createHulyClient } from '../../../temporal/lib';
import {
  compensateHulyCreate,
  syncToHuly,
  type IssueSyncInput,
} from '../../../temporal/activities/issue-sync';

const mockHulyClient = {
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  deleteIssue: vi.fn(),
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
    (createHulyClient as any).mockReturnValue(mockHulyClient);
    mockHulyClient.createIssue.mockResolvedValue({ identifier: 'HVSYN-123' });
    mockHulyClient.updateIssue.mockResolvedValue({ identifier: 'HVSYN-123' });
    mockHulyClient.deleteIssue.mockResolvedValue(true);
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
});
