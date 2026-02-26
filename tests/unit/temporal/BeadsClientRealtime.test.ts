import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecSync = vi.fn();
const mockExec = vi.fn();

vi.mock('child_process', () => ({
  execSync: mockExecSync,
  exec: mockExec,
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockAppendFileSync = vi.fn();

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  appendFileSync: mockAppendFileSync,
}));

const mockRandomBytes = vi.fn();
vi.mock('crypto', () => ({
  randomBytes: mockRandomBytes,
}));

const { BeadsClient } = await import('../../../temporal/lib/BeadsClient.ts');

describe('Temporal BeadsClient realtime sync helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('');
    mockExec.mockImplementation(
      (command: string, options: any, callback?: (error: Error | null) => void) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cb) cb(null);
        return {} as any;
      }
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('issue_prefix: bd\n');
    mockRandomBytes.mockReturnValue(Buffer.from([0x01, 0x02, 0x03]));
    (global as any).fetch = vi.fn();
  });

  afterEach(() => {
    delete process.env.BEADS_API_URL;
    vi.restoreAllMocks();
  });

  it('writes JSONL and triggers import when creating an issue', async () => {
    const client = new BeadsClient('/repo');

    const issue = await client.createIssue({
      title: 'Realtime JSONL test',
      description: 'Created from workflow',
      status: 'open',
      priority: 2,
      type: 'task',
    });

    expect(issue.id).toBe('bd-01020');
    expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
    expect(mockAppendFileSync.mock.calls[0][0]).toContain('/repo/.beads/issues.jsonl');
    expect(String(mockAppendFileSync.mock.calls[0][1])).toContain('"title":"Realtime JSONL test"');
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('bd import -i "/repo/.beads/issues.jsonl" --no-daemon'),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('uses host helper API for label updates when available', async () => {
    process.env.BEADS_API_URL = 'http://localhost:3999/api/beads/label';
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const client = new BeadsClient('/repo');

    await client.addLabel('bd-12345', 'huly:TEST-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3999/api/beads/label',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repoPath: '/repo',
          issueId: 'bd-12345',
          label: 'huly:TEST-1',
          action: 'add',
        }),
      })
    );
    expect(mockExecSync).not.toHaveBeenCalledWith(
      expect.stringContaining('label add'),
      expect.anything()
    );
  });

  it('falls back to CLI when host helper API fails', async () => {
    process.env.BEADS_API_URL = 'http://localhost:3999/api/beads/label';
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const client = new BeadsClient('/repo');

    await client.removeLabel('bd-12345', 'legacy');

    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('bd label remove bd-12345 "legacy" --no-auto-flush --no-daemon'),
      expect.objectContaining({ cwd: '/repo' })
    );
  });
});
