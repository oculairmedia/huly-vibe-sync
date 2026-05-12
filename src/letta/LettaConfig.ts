import path from 'node:path';
import { resolveFromAppRoot } from '../runtimePaths';

interface LettaConfigOptions {
  client?: unknown;
  model?: string;
  embedding?: string;
  enableSleeptime?: boolean;
  sleeptimeFrequency?: number;
  controlAgentName?: string;
  sharedHumanBlockId?: string | null;
}

export class LettaConfig {
  client: unknown;
  baseURL: string;
  apiURL: string;
  password: string;
  model: string;
  embedding: string;
  enableSleeptime: boolean;
  sleeptimeFrequency: number;
  controlAgentName: string;
  sharedHumanBlockId: string | null;
  lettaDir: string;
  settingsPath: string;

  constructor(baseURL: string, password: string, options: LettaConfigOptions = {}) {
    this.client = options.client;

    this.baseURL = baseURL;
    this.apiURL = baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`;
    this.password = password;

    this.model = options.model || process.env.LETTA_MODEL || 'anthropic/sonnet-4-5';
    this.embedding = options.embedding || process.env.LETTA_EMBEDDING || 'letta/letta-free';

    this.enableSleeptime =
      options.enableSleeptime !== undefined
        ? options.enableSleeptime
        : process.env.LETTA_ENABLE_SLEEPTIME === 'true';
    this.sleeptimeFrequency =
      options.sleeptimeFrequency || parseInt(process.env.LETTA_SLEEPTIME_FREQUENCY || '5', 10);

    this.controlAgentName =
      options.controlAgentName || process.env.LETTA_CONTROL_AGENT || 'PM-Control';

    this.sharedHumanBlockId =
      options.sharedHumanBlockId || process.env.LETTA_SHARED_HUMAN_BLOCK_ID || null;

    this.lettaDir = resolveFromAppRoot('.letta');
    this.settingsPath = path.join(this.lettaDir, 'settings.local.json');
  }
}
