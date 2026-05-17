/**
 * Pack — discoverable bundle of roles + formulas + prompt templates +
 * optional health checks, scoped to project/agent/global.
 *
 * Pack shape on disk (mirrors Gas City's internal/builtinpacks/):
 *
 *   <pack-root>/
 *     pack.toml           # name, version, description, dependencies
 *     roles/*.toml        # teammate role configs
 *     formulas/<name>.toml  # workflow templates (parsed by formula/)
 *     prompts/<name>.md     # prompt templates referenced by roles/formulas
 *     doctor/<name>/run.sh  # optional health checks (Gas City's doctor shape)
 *
 * Discovery rules (convention-based, NO central registry):
 *   - project scope: <project>/.vibesync/packs/<name>/
 *   - agent scope:   ~/.letta/agents/<id>/packs/<name>/
 *   - global scope:  ~/.letta/packs/<name>/
 *
 * Roles + formulas inside a pack respect layering invariant #5: no role
 * name is hardcoded in core code. Packs ARE the data the core consumes.
 *
 * See vibesync-lhn.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parseFormulasFromToml } from '../formula/index.js';
import type { Formula } from '../formula/index.js';

export type PackScope = 'project' | 'agent' | 'global';

export interface RoleConfig {
  /** Role identifier (used in formulas). */
  readonly name: string;
  /** Human-readable description of what the role does. */
  readonly description?: string;
  /** LLM model handle (e.g. "letta/auto"). */
  readonly model?: string;
  /** Path to the system prompt template relative to the pack root. */
  readonly systemPromptTemplate?: string;
  /** Tools this role should have access to (free-form list of identifiers). */
  readonly tools?: readonly string[];
}

export interface PackManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly dependencies?: readonly string[];
}

export interface Pack {
  readonly manifest: PackManifest;
  readonly root: string;
  readonly scope: PackScope;
  readonly roles: readonly RoleConfig[];
  readonly formulas: readonly Formula[];
}

export interface DiscoveryOptions {
  /** Project root for the project-scope sweep. Defaults to process.cwd(). */
  readonly projectRoot?: string;
  /** Agent id for the agent-scope sweep. If omitted, agent scope is skipped. */
  readonly agentId?: string;
  /** Override the home dir lookup (test seam). */
  readonly homeDir?: string;
}

/**
 * Find every pack directory across all configured scopes. Returns
 * Pack records in scope priority order: project > agent > global. A
 * pack name appearing in multiple scopes is returned once per scope
 * — resolution to a single pack is the caller's job.
 */
export function discoverPacks(opts: DiscoveryOptions = {}): Pack[] {
  const out: Pack[] = [];
  const projectRoot = opts.projectRoot ?? process.cwd();
  const home = opts.homeDir ?? homedir();
  const scopeRoots: { scope: PackScope; root: string }[] = [
    { scope: 'project', root: join(projectRoot, '.vibesync', 'packs') },
  ];
  if (opts.agentId) {
    scopeRoots.push({ scope: 'agent', root: join(home, '.letta', 'agents', opts.agentId, 'packs') });
  }
  scopeRoots.push({ scope: 'global', root: join(home, '.letta', 'packs') });

  for (const { scope, root } of scopeRoots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const packRoot = join(root, entry.name);
      const loaded = tryLoadPack(packRoot, scope);
      if (loaded) out.push(loaded);
    }
  }
  return out;
}

/**
 * Load and validate one pack directory. Throws on schema errors;
 * returns null on missing pack.toml (callers can choose to surface).
 */
export function loadPack(packRoot: string, scope: PackScope = 'global'): Pack {
  const manifest = readPackManifest(packRoot);
  const roles = readRoles(packRoot);
  const formulas = readFormulas(packRoot);
  return { manifest, root: packRoot, scope, roles, formulas };
}

function tryLoadPack(packRoot: string, scope: PackScope): Pack | null {
  try {
    if (!existsSync(join(packRoot, 'pack.toml'))) return null;
    return loadPack(packRoot, scope);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[packs] skipping ${packRoot}: ${(err as Error).message}`);
    return null;
  }
}

function readPackManifest(packRoot: string): PackManifest {
  const path = join(packRoot, 'pack.toml');
  if (!existsSync(path)) {
    throw new Error(`pack: missing pack.toml at ${path}`);
  }
  const raw = parseToml(readFileSync(path, 'utf8')) as unknown;
  if (!isRecord(raw)) throw new Error(`pack ${path}: pack.toml must be a table`);
  const packSection = raw['pack'];
  if (!isRecord(packSection)) {
    throw new Error(`pack ${path}: missing or invalid [pack] table`);
  }
  const name = packSection['name'];
  const version = packSection['version'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`pack ${path}: pack.name must be a non-empty string`);
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`pack ${path}: pack.version must be a non-empty string`);
  }
  const description = typeof packSection['description'] === 'string' ? (packSection['description'] as string) : undefined;
  const dependenciesRaw = packSection['dependencies'];
  let dependencies: string[] | undefined;
  if (Array.isArray(dependenciesRaw)) {
    if (!dependenciesRaw.every((v): v is string => typeof v === 'string')) {
      throw new Error(`pack ${path}: pack.dependencies must be an array of strings`);
    }
    dependencies = dependenciesRaw;
  }
  return {
    name,
    version,
    ...(description !== undefined ? { description } : {}),
    ...(dependencies !== undefined ? { dependencies } : {}),
  };
}

function readRoles(packRoot: string): RoleConfig[] {
  const dir = join(packRoot, 'roles');
  if (!existsSync(dir)) return [];
  const out: RoleConfig[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.toml')) continue;
    const filePath = join(dir, entry.name);
    const raw = parseToml(readFileSync(filePath, 'utf8')) as unknown;
    if (!isRecord(raw)) {
      throw new Error(`pack ${packRoot}: role ${entry.name} must be a table`);
    }
    const roleSection = raw['role'];
    if (!isRecord(roleSection)) {
      throw new Error(`pack ${packRoot}: role ${entry.name} missing [role] table`);
    }
    out.push(parseRole(packRoot, entry.name, roleSection));
  }
  return out;
}

function parseRole(packRoot: string, fileName: string, raw: Record<string, unknown>): RoleConfig {
  const defaultName = basename(fileName, '.toml');
  const name = typeof raw['name'] === 'string' && (raw['name'] as string).length > 0 ? (raw['name'] as string) : defaultName;
  const description = typeof raw['description'] === 'string' ? (raw['description'] as string) : undefined;
  const model = typeof raw['model'] === 'string' ? (raw['model'] as string) : undefined;
  const systemPromptTemplate = typeof raw['system_prompt_template'] === 'string'
    ? (raw['system_prompt_template'] as string)
    : undefined;
  const toolsRaw = raw['tools'];
  let tools: string[] | undefined;
  if (Array.isArray(toolsRaw)) {
    if (!toolsRaw.every((v): v is string => typeof v === 'string')) {
      throw new Error(`pack ${packRoot}: role ${fileName}.tools must be an array of strings`);
    }
    tools = toolsRaw;
  }
  return {
    name,
    ...(description !== undefined ? { description } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(systemPromptTemplate !== undefined ? { systemPromptTemplate } : {}),
    ...(tools !== undefined ? { tools } : {}),
  };
}

function readFormulas(packRoot: string): Formula[] {
  const dir = join(packRoot, 'formulas');
  if (!existsSync(dir)) return [];
  const out: Formula[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.toml')) continue;
    const filePath = join(dir, entry.name);
    const raw = readFileSync(filePath, 'utf8');
    const formulas = parseFormulasFromToml(raw);
    out.push(...formulas);
  }
  return out;
}

/**
 * Validate a pack directory without loading it into the runtime.
 * Used by `pack validate <path>` CLI for pack authors.
 */
export function validatePackPath(packRoot: string): { ok: true } | { ok: false; error: string } {
  try {
    if (!statSync(packRoot).isDirectory()) {
      return { ok: false, error: `${packRoot} is not a directory` };
    }
    loadPack(packRoot, 'global');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
