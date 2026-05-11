#!/usr/bin/env bun

import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const tempRoot = path.join(tmpdir(), 'vibesync-binary-build');
const outputName = process.platform === 'win32' ? 'vibesync.exe' : 'vibesync';
const tempOutput = path.join(tempRoot, outputName);
const finalOutput = path.join(repoRoot, 'dist', outputName);

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });

for (const file of ['package.json', 'bun.lock', 'tsconfig.json', 'index.js', 'cli.js']) {
  copyFileSync(path.join(repoRoot, file), path.join(tempRoot, file));
}

for (const dir of ['src', 'lib', 'temporal', 'python', 'templates', 'migrations']) {
  const source = path.join(repoRoot, dir);
  if (existsSync(source)) {
    cpSync(source, path.join(tempRoot, dir), { recursive: true });
  }
}

const nodeModules = path.join(repoRoot, 'node_modules');
if (existsSync(nodeModules)) {
  cpSync(nodeModules, path.join(tempRoot, 'node_modules'), {
    recursive: true,
    filter: source => !source.split(path.sep).includes('.bin'),
  });
} else {
  const install = spawnSync('bun', ['install', '--production', '--frozen-lockfile'], {
    cwd: tempRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}

const result = spawnSync(
  'bun',
  ['build', '--compile', '--target=bun', '--outfile', tempOutput, 'src/index.ts'],
  {
    cwd: tempRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

mkdirSync(path.dirname(finalOutput), { recursive: true });
copyFileSync(tempOutput, finalOutput);
console.log(`Built ${finalOutput}`);
