import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger as defaultLogger } from './logger.js';

const execFileAsync = promisify(execFile);
const DEFAULT_BRANCH = 'main';

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

export function normalizeDoltHubRepoName(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  return normalized || 'project';
}

function sanitizeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return message
    .replace(/authorization:\s*[^\s,)]+/gi, 'authorization: [redacted]')
    .replace(/token\s+[A-Za-z0-9._-]+/gi, 'token [redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 240);
}

function parseJsonMaybe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseRemoteList(output) {
  return String(output || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 2) return null;
      return { name: parts[0], url: parts[1], raw: line };
    })
    .filter(Boolean);
}

async function defaultCommandRunner(command, args, options) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    env: options.env,
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

export class DoltHubProvisioningService {
  /**
   * @param {{config?: object, db?: object, logger?: object, fetchImpl?: Function, commandRunner?: Function}=} options
   */
  constructor(options = {}) {
    const {
      config,
      db,
      logger = defaultLogger,
      fetchImpl = globalThis.fetch,
      commandRunner,
    } = options;
    this.config = config || {};
    this.db = db;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.commandRunner = commandRunner || defaultCommandRunner;
  }

  get enabled() {
    return Boolean(this.config.enabled);
  }

  get dryRun() {
    return Boolean(this.config.dryRun);
  }

  get owner() {
    return this.config.owner || 'oulair';
  }

  get remoteName() {
    return this.config.remoteName || 'origin';
  }

  get visibility() {
    return this.config.defaultVisibility || 'private';
  }

  get apiUrl() {
    return trimTrailingSlash(this.config.apiUrl || 'https://www.dolthub.com/api/v1alpha1');
  }

  buildPlan(project) {
    const sourceName =
      path.basename(project.filesystem_path || '') || project.name || project.identifier;
    const repo = normalizeDoltHubRepoName(sourceName);
    const remoteUrl = `dolthub://${this.owner}/${repo}`;

    return {
      owner: this.owner,
      repo,
      remoteName: this.remoteName,
      remoteUrl,
      visibility: this.visibility,
      apiEndpoint: `${this.apiUrl}/database`,
    };
  }

  async provisionProject(project, options = {}) {
    if (!project?.identifier) {
      throw new Error('Project identifier is required');
    }
    if (!project.filesystem_path) {
      throw new Error('Project has no filesystem path');
    }
    if (!this.enabled && !this.dryRun) {
      throw new Error('DoltHub provisioning is disabled');
    }

    const plan = this.buildPlan(project);
    const commands = [];

    try {
      const createResult = await this.createDoltHubDatabase(project, plan);
      const remoteResult = await this.configureBeadsRemote(project.filesystem_path, plan, {
        push: options.push !== false,
        commands,
      });
      const status = this.dryRun ? 'dry_run' : 'provisioned';
      const lastPushAt = remoteResult.pushed ? Date.now() : null;

      this.db?.projects?.setProjectBeadsRemote?.(project.identifier, {
        owner: plan.owner,
        repo: plan.repo,
        url: plan.remoteUrl,
        name: plan.remoteName,
        status,
        visibility: plan.visibility,
        last_push_at: lastPushAt,
      });

      return {
        status,
        dry_run: this.dryRun,
        project_identifier: project.identifier,
        owner: plan.owner,
        repo: plan.repo,
        remote_name: plan.remoteName,
        remote_url: plan.remoteUrl,
        visibility: plan.visibility,
        database_created: createResult.created,
        database_already_exists: createResult.alreadyExists,
        remote_changed: remoteResult.changed,
        pushed: remoteResult.pushed,
        commands,
      };
    } catch (error) {
      const safeError = sanitizeErrorMessage(error);
      this.db?.projects?.setProjectBeadsRemoteError?.(project.identifier, safeError);
      this.logger?.error?.(
        { err: error, project_identifier: project.identifier },
        'Beads remote provisioning failed',
      );
      throw new Error(safeError);
    }
  }

  async createDoltHubDatabase(project, plan) {
    if (this.dryRun) {
      return { created: false, alreadyExists: false, dryRun: true };
    }
    if (!this.config.apiToken) {
      throw new Error('DOLTHUB_API_TOKEN is required for DoltHub database creation');
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('Fetch implementation is not available for DoltHub database creation');
    }

    const response = await this.fetchImpl(plan.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: this.config.apiToken,
      },
      body: JSON.stringify({
        ownerName: plan.owner,
        repoName: plan.repo,
        description: `Beads issue database for ${project.name || project.identifier}`,
        visibility: plan.visibility,
      }),
    });

    const responseText = await response.text().catch(() => '');
    const responseJson = parseJsonMaybe(responseText);
    const message = responseJson?.error || responseJson?.message || responseText;

    if (response.ok) {
      return { created: true, alreadyExists: false, response: responseJson };
    }

    if (
      response.status === 409 ||
      /already\s+exists|exists\s+already|database.*exists/i.test(message)
    ) {
      return { created: false, alreadyExists: true, response: responseJson };
    }

    throw new Error(
      `DoltHub database creation failed (${response.status}): ${message || response.statusText}`,
    );
  }

  async configureBeadsRemote(projectPath, plan, options = {}) {
    const commands = options.commands || [];
    const remotes = await this.listBeadsRemotes(projectPath, commands);
    const existing = remotes.find((remote) => remote.name === plan.remoteName);
    let changed = false;

    if (existing && existing.url !== plan.remoteUrl) {
      await this.runBd(projectPath, ['dolt', 'remote', 'remove', plan.remoteName], commands);
      changed = true;
    }

    if (!existing || existing.url !== plan.remoteUrl) {
      await this.runBd(
        projectPath,
        ['dolt', 'remote', 'add', plan.remoteName, plan.remoteUrl],
        commands,
      );
      changed = true;
    }

    const verifiedRemotes = await this.listBeadsRemotes(projectPath, commands);
    const verified = verifiedRemotes.find(
      (remote) => remote.name === plan.remoteName && remote.url === plan.remoteUrl,
    );

    if (!this.dryRun && !verified) {
      throw new Error(`Beads remote ${plan.remoteName} was not configured correctly`);
    }

    let pushed = false;
    if (options.push !== false) {
      await this.runBd(
        projectPath,
        ['dolt', 'push', plan.remoteName, DEFAULT_BRANCH],
        commands,
        120000,
      );
      pushed = true;
    }

    return { changed, pushed };
  }

  async listBeadsRemotes(projectPath, commands) {
    const result = await this.runBd(projectPath, ['dolt', 'remote', 'list'], commands);
    return parseRemoteList(result.stdout);
  }

  async runBd(projectPath, args, commands, timeout = 30000) {
    commands.push(['bd', ...args].join(' '));

    if (this.dryRun) {
      return { stdout: '', stderr: '' };
    }

    return this.commandRunner('bd', args, {
      cwd: projectPath,
      timeout,
      env: process.env,
    });
  }
}

export function createDoltHubProvisioningService(options) {
  return new DoltHubProvisioningService(options);
}
