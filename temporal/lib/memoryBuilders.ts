/**
 * Memory builder wrappers for Temporal activities.
 *
 * The main lib/LettaMemoryBuilders.js is ESM (package.json "type": "module")
 * but Temporal workers compile to CJS. This module provides CJS-compatible
 * wrappers that lazily import the ESM builders via dynamic import().
 *
 * We use Function('return import(...)') to prevent TypeScript from converting
 * the dynamic import() into require() during CJS compilation.
 */

import * as path from 'path';

let _builders: any = null;

// Preserve dynamic import() through CJS compilation
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

// Resolve absolute path at module load time (works from any CWD)
// At runtime, __dirname = /app/temporal/dist/lib, so we go up 3 levels to /app/
const buildersPath = path.resolve(__dirname, '..', '..', '..', 'lib', 'LettaMemoryBuilders.js');

async function getBuilders() {
  if (!_builders) {
    _builders = await dynamicImport(buildersPath);
  }
  return _builders;
}

export async function buildBoardMetrics(issues: any[]) {
  const b = await getBuilders();
  return b.buildBoardMetrics(issues);
}

export async function buildProjectMeta(project: any, repoPath: string | null, gitUrl: string | null) {
  const b = await getBuilders();
  return b.buildProjectMeta(project, repoPath, gitUrl);
}

export async function buildBoardConfig() {
  const b = await getBuilders();
  return b.buildBoardConfig();
}

export async function buildHotspots(issues: any[]) {
  const b = await getBuilders();
  return b.buildHotspots(issues);
}

export async function buildBacklogSummary(issues: any[]) {
  const b = await getBuilders();
  return b.buildBacklogSummary(issues);
}

export async function buildRecentActivity(activityData: any) {
  const b = await getBuilders();
  return b.buildRecentActivity(activityData);
}

export async function buildComponentsSummary(issues: any[]) {
  const b = await getBuilders();
  return b.buildComponentsSummary(issues);
}
