import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSpawn, mockExecSync, mockDetermineGitRepoPath } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecSync: vi.fn(),
  mockDetermineGitRepoPath: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
}));

vi.mock('../../lib/textParsers.js', async () => {
  const actual = await vi.importActual('../../lib/textParsers.js');
  return {
    ...actual,
    determineGitRepoPath: mockDetermineGitRepoPath,
  };
});

import { LettaCodeService, createLettaCodeService } from '../../lib/LettaCodeService.js';

function makeMockChildProcess({
  stdout = '',
  stderr = '',
  exitCode = 0,
  error = null,
  autoClose = true,
} = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });

  if (autoClose) {
    queueMicrotask(() => {
      if (error) {
        child.emit('error', error);
        return;
      }
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.killed = true;
      child.emit('close', exitCode);
    });
  }

  return child;
}

describe('LettaCodeService', () => {
  let tempRoot;
  let stateDir;
  let service;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letta-code-service-'));
    stateDir = path.join(tempRoot, '.letta-code');

    mockSpawn.mockReset();
    mockExecSync.mockReset();
    mockDetermineGitRepoPath.mockReset();

    service = new LettaCodeService({
      stateDir,
      projectRoot: tempRoot,
      lettaBaseUrl: 'http://localhost:8283',
      lettaApiKey: 'test-key',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('createLettaCodeService returns a service instance', () => {
    const created = createLettaCodeService({ stateDir });
    expect(created).toBeInstanceOf(LettaCodeService);
  });

  it('checkLettaCodeAvailable returns true when letta exists', async () => {
    mockExecSync.mockReturnValue('/usr/local/bin/letta');
    await expect(service.checkLettaCodeAvailable()).resolves.toBe(true);
  });

  it('checkLettaCodeAvailable returns false when letta is missing', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    await expect(service.checkLettaCodeAvailable()).resolves.toBe(false);
  });

  it('getOrCreateSession creates and returns a new session', () => {
    const projectDir = path.join(tempRoot, 'project-a');
    fs.mkdirSync(projectDir, { recursive: true });

    const session = service.getOrCreateSession('agent-1', projectDir, 'Agent One');

    expect(session.agentId).toBe('agent-1');
    expect(session.projectDir).toBe(projectDir);
    expect(session.agentName).toBe('Agent One');
    expect(service.getSession('agent-1')).toBeTruthy();
  });

  it('getOrCreateSession updates project dir and resets linked state when moved', () => {
    const projectA = path.join(tempRoot, 'project-a');
    const projectB = path.join(tempRoot, 'project-b');
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });

    const first = service.getOrCreateSession('agent-1', projectA, 'Agent One');
    first.linked = true;

    const updated = service.getOrCreateSession('agent-1', projectB, 'Agent One');
    expect(updated.projectDir).toBe(projectB);
    expect(updated.linked).toBe(false);
  });

  it('linkTools fails when project directory does not exist', async () => {
    const result = await service.linkTools('agent-1', path.join(tempRoot, 'missing-dir'));
    expect(result.success).toBe(false);
    expect(result.message).toContain('does not exist');
  });

  it('linkTools reuses existing link for the same agent', async () => {
    const projectDir = path.join(tempRoot, 'project-linked');
    fs.mkdirSync(path.join(projectDir, '.letta'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.letta', 'settings.local.json'),
      JSON.stringify({ agentId: 'agent-1', agentName: 'Agent One' }, null, 2)
    );

    const result = await service.linkTools('agent-1', projectDir, 'Agent One');

    expect(result.success).toBe(true);
    expect(result.reusedLink).toBe(true);
    expect(service.getSession('agent-1')?.linked).toBe(true);
  });

  it('linkTools fails when project is linked to a different agent', async () => {
    const projectDir = path.join(tempRoot, 'project-locked');
    fs.mkdirSync(path.join(projectDir, '.letta'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.letta', 'settings.local.json'),
      JSON.stringify({ agentId: 'agent-2' }, null, 2)
    );

    const result = await service.linkTools('agent-1', projectDir, 'Agent One');

    expect(result.success).toBe(false);
    expect(result.message).toContain('already linked to agent agent-2');
  });

  it('runTask returns error when no project directory is configured', async () => {
    const result = await service.runTask('agent-1', 'Do something');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No project directory configured');
  });

  it('runTask executes letta command successfully', async () => {
    vi.useFakeTimers();

    const projectDir = path.join(tempRoot, 'project-run');
    fs.mkdirSync(projectDir, { recursive: true });
    service.getOrCreateSession('agent-1', projectDir, 'Agent One');

    const child = makeMockChildProcess({ stdout: 'done\n', exitCode: 0 });
    mockSpawn.mockReturnValue(child);

    const promise = service.runTask('agent-1', 'Implement feature', { timeout: 50 });
    await vi.runAllTicks();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.result).toBe('done');
    expect(mockSpawn).toHaveBeenCalledWith(
      'letta',
      ['-p', 'Implement feature', '--agent', 'agent-1', '--yolo'],
      expect.objectContaining({
        cwd: projectDir,
      })
    );

    vi.runOnlyPendingTimers();
  });

  it('runTask returns process failure for non-zero exit', async () => {
    vi.useFakeTimers();

    const projectDir = path.join(tempRoot, 'project-fail');
    fs.mkdirSync(projectDir, { recursive: true });
    service.getOrCreateSession('agent-1', projectDir, 'Agent One');

    const child = makeMockChildProcess({ stdout: 'partial', stderr: 'failed', exitCode: 2 });
    mockSpawn.mockReturnValue(child);

    const promise = service.runTask('agent-1', 'Implement feature', { timeout: 50 });
    await vi.runAllTicks();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.result).toBe('partial');
    expect(result.error).toBe('failed');
    expect(result.exitCode).toBe(2);

    vi.runOnlyPendingTimers();
  });

  it('runTask times out and terminates the process', async () => {
    vi.useFakeTimers();

    const projectDir = path.join(tempRoot, 'project-timeout');
    fs.mkdirSync(projectDir, { recursive: true });
    service.getOrCreateSession('agent-1', projectDir, 'Agent One');

    const child = makeMockChildProcess({ autoClose: false });
    mockSpawn.mockReturnValue(child);

    const promise = service.runTask('agent-1', 'Long running task', { timeout: 100 });
    vi.advanceTimersByTime(101);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('resolveProjectDir delegates to determineGitRepoPath', () => {
    const project = { identifier: 'TEST', description: 'Filesystem: /repo' };
    mockDetermineGitRepoPath.mockReturnValue('/repo');

    expect(service.resolveProjectDir(project)).toBe('/repo');
    expect(mockDetermineGitRepoPath).toHaveBeenCalledWith(project);
  });

  it('configureForProject resolves directory and links tools', async () => {
    const projectDir = path.join(tempRoot, 'project-configure');
    fs.mkdirSync(projectDir, { recursive: true });
    mockDetermineGitRepoPath.mockReturnValue(projectDir);

    const linkSpy = vi.spyOn(service, 'linkTools').mockResolvedValue({
      success: true,
      message: 'linked',
    });

    const result = await service.configureForProject(
      'agent-99',
      { identifier: 'TEST', name: 'Test Project', description: 'Filesystem: /repo' },
      'Custom Agent'
    );

    expect(result.success).toBe(true);
    expect(linkSpy).toHaveBeenCalledWith('agent-99', projectDir, 'Custom Agent');
  });
});
