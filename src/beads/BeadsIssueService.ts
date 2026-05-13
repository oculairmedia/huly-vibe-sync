import type Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger as defaultLogger } from '../logger';
import type { Logger } from '../types/api.js';

const execFileAsync = promisify(execFile);

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface CommandOptions {
  cwd: string;
  timeout: number;
  env: NodeJS.ProcessEnv;
}

interface BeadsIssueRef {
  identifier: string;
  project_identifier: string;
}

export interface MutateBody {
  status?: string;
  note?: string;
  text?: string;
  content?: string;
  reason?: string;
}

export interface MutateResult {
  applied: boolean;
  command?: string;
  stdout?: string;
  idempotent_replay?: boolean;
}

interface MutateParams {
  action: string;
  issue: BeadsIssueRef;
  body?: MutateBody;
  idempotencyKey?: string | null;
}

interface ServiceDb {
  db?: Database.Database;
  getProjectFilesystemPath?: (id: string) => string | null;
}

type CommandRunner = (command: string, args: string[], options: CommandOptions) => Promise<CommandResult>;

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return message.slice(0, 240);
}

function buildBdArgs(action: string, issueId: string, body: MutateBody = {}): string[] {
  switch (action) {
    case 'claim':
      return ['update', issueId, '--claim', '--json'];
    case 'unclaim':
      return ['update', issueId, '--assignee', '', '--status', 'open', '--json'];
    case 'update_status': {
      if (!body.status) throw new Error('status is required');
      return ['update', issueId, '--status', String(body.status), '--json'];
    }
    case 'add_note': {
      const note = body.note || body.text || body.content;
      if (!note) throw new Error('note is required');
      return ['note', issueId, String(note), '--json'];
    }
    case 'close':
      return ['close', issueId, '--reason', String(body.reason || 'Closed from Android API'), '--json'];
    case 'reopen':
      return ['reopen', issueId, '--reason', String(body.reason || 'Reopened from Android API'), '--json'];
    default:
      throw new Error(`Unsupported issue mutation action: ${action}`);
  }
}

async function defaultCommandRunner(command: string, args: string[], options: CommandOptions): Promise<CommandResult> {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    env: options.env,
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

export class BeadsIssueService {
  private db: ServiceDb | null;
  private logger: Logger;
  private commandRunner: CommandRunner;

  constructor(options: { db?: ServiceDb | null; logger?: Logger; commandRunner?: CommandRunner } = {}) {
    const { db, logger = defaultLogger as unknown as Logger, commandRunner } = options;
    this.db = db ?? null;
    this.logger = logger;
    this.commandRunner = commandRunner || defaultCommandRunner;
  }

  getIdempotencyRecord(idempotencyKey: string | null, issueIdentifier: string, action: string): MutateResult | null {
    if (!idempotencyKey || !this.db?.db) return null;
    const row = this.db.db
      .prepare(
        `SELECT result_json FROM issue_mutation_idempotency
         WHERE idempotency_key = ? AND issue_identifier = ? AND action = ?`,
      )
      .get(idempotencyKey, issueIdentifier, action) as { result_json?: string } | undefined;

    if (!row?.result_json) return null;
    return JSON.parse(row.result_json) as MutateResult;
  }

  storeIdempotencyRecord(idempotencyKey: string | null, issueIdentifier: string, action: string, result: MutateResult): void {
    if (!idempotencyKey || !this.db?.db) return;
    this.db.db
      .prepare(
        `INSERT OR IGNORE INTO issue_mutation_idempotency (idempotency_key, issue_identifier, action, result_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(idempotencyKey, issueIdentifier, action, JSON.stringify(result), Date.now());
  }

  async mutateIssue({ action, issue, body = {}, idempotencyKey = null }: MutateParams): Promise<MutateResult> {
    const cached = this.getIdempotencyRecord(idempotencyKey, issue.identifier, action);
    if (cached) {
      return { ...cached, applied: false, idempotent_replay: true };
    }

    const projectPath = this.db?.getProjectFilesystemPath?.(issue.project_identifier);
    if (!projectPath) {
      throw new Error('Project filesystem path is required for Beads mutations');
    }

    const args = buildBdArgs(action, issue.identifier, body);

    try {
      const commandResult = await this.commandRunner('bd', args, {
        cwd: projectPath,
        timeout: 60000,
        env: process.env as NodeJS.ProcessEnv,
      });
      const result: MutateResult = {
        applied: true,
        command: ['bd', ...args].join(' '),
        stdout: commandResult.stdout,
      };
      this.storeIdempotencyRecord(idempotencyKey, issue.identifier, action, result);
      return result;
    } catch (error) {
      this.logger.error(
        { err: error, action, issue: issue.identifier },
        'Beads issue command failed',
      );
      throw new Error(sanitizeErrorMessage(error));
    }
  }
}

export function createBeadsIssueService(options: { db?: ServiceDb | null; logger?: Logger; commandRunner?: CommandRunner }): BeadsIssueService {
  return new BeadsIssueService(options);
}

export { buildBdArgs };
