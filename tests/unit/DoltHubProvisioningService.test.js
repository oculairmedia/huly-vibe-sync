import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DoltHubProvisioningService,
  normalizeDoltHubRepoName,
} from '../../lib/DoltHubProvisioningService.js';

describe('DoltHubProvisioningService', () => {
  let db;
  let fetchImpl;
  let commandRunner;
  let service;

  beforeEach(() => {
    db = {
      projects: {
        setProjectBeadsRemote: vi.fn(),
        setProjectBeadsRemoteError: vi.fn(),
      },
    };
    fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue('{"ok":true}'),
    });
    let listCalls = 0;
    commandRunner = vi.fn(async (command, args) => {
      if (args.join(' ') === 'dolt remote list') {
        listCalls += 1;
        return {
          stdout:
            listCalls === 1
              ? ''
              : 'origin https://doltremoteapi.dolthub.com/oulair/letta_mobile\n',
          stderr: '',
        };
      }
      return { stdout: 'ok', stderr: '' };
    });
    service = new DoltHubProvisioningService({
      config: {
        enabled: true,
        dryRun: false,
        apiUrl: 'https://www.dolthub.com/api/v1alpha1',
        apiToken: 'secret-api-token',
        owner: 'oulair',
        defaultVisibility: 'private',
        remoteName: 'origin',
      },
      db,
      logger: { error: vi.fn() },
      fetchImpl,
      commandRunner,
    });
  });

  it('normalizes project paths into DoltHub-safe database names', () => {
    expect(normalizeDoltHubRepoName('letta-mobile')).toBe('letta_mobile');
    expect(normalizeDoltHubRepoName('Matrix Tuwunel Deploy!!')).toBe('matrix_tuwunel_deploy');
  });

  it('creates a private DoltHub database using the raw authorization token header', async () => {
    const result = await service.provisionProject({
      identifier: 'LETTA',
      name: 'Letta Mobile',
      filesystem_path: '/opt/stacks/letta-mobile',
    });

    expect(result.remote_url).toBe('https://doltremoteapi.dolthub.com/oulair/letta_mobile');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.dolthub.com/api/v1alpha1/database',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'secret-api-token' }),
        body: JSON.stringify({
          ownerName: 'oulair',
          repoName: 'letta_mobile',
          description: 'Beads issue database for Letta Mobile',
          visibility: 'private',
        }),
      }),
    );
    expect(db.projects.setProjectBeadsRemote).toHaveBeenCalledWith(
      'LETTA',
      expect.objectContaining({ repo: 'letta_mobile', status: 'provisioned' }),
    );
  });

  it('treats an already-existing DoltHub database as idempotent success', async () => {
    fetchImpl.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: vi.fn().mockResolvedValue('{"message":"database already exists"}'),
    });

    const result = await service.provisionProject({
      identifier: 'LETTA',
      name: 'Letta Mobile',
      filesystem_path: '/opt/stacks/letta-mobile',
    });

    expect(result.database_already_exists).toBe(true);
    expect(result.status).toBe('provisioned');
  });

  it('replaces an existing local file remote before adding and pushing the DoltHub remote', async () => {
    let listCalls = 0;
    commandRunner.mockImplementation(async (command, args) => {
      if (args.join(' ') === 'dolt remote list') {
        listCalls += 1;
        return {
          stdout:
            listCalls === 1
              ? 'origin file:///tmp/beads-backup\n'
              : 'origin https://doltremoteapi.dolthub.com/oulair/letta_mobile\n',
          stderr: '',
        };
      }
      return { stdout: 'ok', stderr: '' };
    });

    const result = await service.provisionProject({
      identifier: 'LETTA',
      name: 'Letta Mobile',
      filesystem_path: '/opt/stacks/letta-mobile',
    });

    expect(result.commands).toEqual([
      'bd dolt remote list',
      'bd dolt remote remove origin',
      'bd dolt remote add origin https://doltremoteapi.dolthub.com/oulair/letta_mobile',
      'bd dolt remote list',
      'bd dolt push origin main',
    ]);
    expect(result.remote_changed).toBe(true);
    expect(result.pushed).toBe(true);
  });

  it('supports dry runs without calling DoltHub or executing bd commands', async () => {
    service = new DoltHubProvisioningService({
      config: {
        enabled: false,
        dryRun: true,
        apiUrl: 'https://www.dolthub.com/api/v1alpha1',
        owner: 'oulair',
        defaultVisibility: 'private',
        remoteName: 'origin',
      },
      db,
      logger: { error: vi.fn() },
      fetchImpl,
      commandRunner,
    });

    const result = await service.provisionProject({
      identifier: 'LETTA',
      name: 'Letta Mobile',
      filesystem_path: '/opt/stacks/letta-mobile',
    });

    expect(result.status).toBe('dry_run');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(commandRunner).not.toHaveBeenCalled();
    expect(result.commands).toContain(
      'bd dolt remote add origin https://doltremoteapi.dolthub.com/oulair/letta_mobile',
    );
  });
});
