import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const vitestEntry = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');

if (!existsSync(vitestEntry)) {
  console.error(`Vitest entrypoint not found at ${vitestEntry}`);
  process.exit(1);
}

const args = [vitestEntry, ...process.argv.slice(2)];
const child = spawn(process.execPath, args, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
  detached: true,
});

let cleanedUp = false;

function killProcessGroup(signal) {
  if (!child.pid) return;

  try {
    process.kill(-child.pid, signal);
  } catch {
    // Process group may already be gone.
  }
}

function cleanup(signal = 'SIGTERM') {
  if (cleanedUp) return;
  cleanedUp = true;

  killProcessGroup(signal);

  if (signal !== 'SIGKILL') {
    setTimeout(() => {
      killProcessGroup('SIGKILL');
    }, 2000).unref();
  }
}

function forwardAndExit(signal, exitCode = 128) {
  cleanup(signal);
  process.exit(exitCode);
}

child.on('error', (error) => {
  console.error('Failed to start Vitest safely:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  cleanedUp = true;

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

process.on('SIGINT', () => forwardAndExit('SIGINT', 130));
process.on('SIGTERM', () => forwardAndExit('SIGTERM', 143));
process.on('SIGHUP', () => forwardAndExit('SIGHUP', 129));
process.on('uncaughtException', (error) => {
  console.error(error);
  forwardAndExit('SIGTERM', 1);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  forwardAndExit('SIGTERM', 1);
});
