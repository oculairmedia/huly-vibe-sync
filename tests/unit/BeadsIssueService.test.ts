import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BeadsIssueService, buildBdArgs } from '../../src/beads/BeadsIssueService.js';

describe('BeadsIssueService', () => {
  let db;
  let sqliteRows;
  let commandRunner;
  let service;

  beforeEach(() => {
    sqliteRows = new Map();
    db = {
      getProjectFilesystemPath: vi.fn(() => '/opt/stacks/letta-mobile'),
      db: {
        prepare: vi.fn((sql) => {
          if (sql.includes('SELECT result_json')) {
            return {
              get: vi.fn((key, issue, action) =>
                sqliteRows.has(`${key}:${issue}:${action}`)
                  ? { result_json: sqliteRows.get(`${key}:${issue}:${action}`) }
                  : null,
              ),
            };
          }
          return {
            run: vi.fn((key, issue, action, resultJson) => {
              sqliteRows.set(`${key}:${issue}:${action}`, resultJson);
            }),
          };
        }),
      },
    };
    commandRunner = vi.fn(async () => ({ stdout: '{"ok":true}', stderr: '' }));
    service = new BeadsIssueService({
      db,
      logger: { error: vi.fn() },
      commandRunner,
    });
  });

  it('builds safe bd command arguments for supported mutations', () => {
    expect(buildBdArgs('claim', 'ISS-1', {})).toEqual(['update', 'ISS-1', '--claim', '--json']);
    expect(buildBdArgs('unclaim', 'ISS-1', {})).toEqual([
      'update',
      'ISS-1',
      '--assignee',
      '',
      '--status',
      'open',
      '--json',
    ]);
    expect(buildBdArgs('update_status', 'ISS-1', { status: 'blocked' })).toEqual([
      'update',
      'ISS-1',
      '--status',
      'blocked',
      '--json',
    ]);
    expect(buildBdArgs('add_note', 'ISS-1', { note: 'hello' })).toEqual([
      'note',
      'ISS-1',
      'hello',
      '--json',
    ]);
    expect(buildBdArgs('close', 'ISS-1', { reason: 'done' })).toEqual([
      'close',
      'ISS-1',
      '--reason',
      'done',
      '--json',
    ]);
    expect(buildBdArgs('reopen', 'ISS-1', { reason: 'again' })).toEqual([
      'reopen',
      'ISS-1',
      '--reason',
      'again',
      '--json',
    ]);
  });

  it('runs bd in the owning project directory and records idempotency keys', async () => {
    const issue = { identifier: 'ISS-1', project_identifier: 'LETTA' };

    const first = await service.mutateIssue({
      action: 'claim',
      issue,
      body: {},
      idempotencyKey: 'android-1',
    });
    const second = await service.mutateIssue({
      action: 'claim',
      issue,
      body: {},
      idempotencyKey: 'android-1',
    });

    expect(commandRunner).toHaveBeenCalledTimes(1);
    expect(commandRunner).toHaveBeenCalledWith('bd', ['update', 'ISS-1', '--claim', '--json'], {
      cwd: '/opt/stacks/letta-mobile',
      timeout: 60000,
      env: process.env,
    });
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.idempotent_replay).toBe(true);
  });

  it('rejects mutations without a project filesystem path', async () => {
    db.getProjectFilesystemPath.mockReturnValueOnce(null);

    await expect(
      service.mutateIssue({
        action: 'claim',
        issue: { identifier: 'ISS-1', project_identifier: 'LETTA' },
      }),
    ).rejects.toThrow('Project filesystem path is required');
    expect(commandRunner).not.toHaveBeenCalled();
  });
});
