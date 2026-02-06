/**
 * LettaConfig — shared configuration DTO for all Letta sub-services.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LettaConfig {
  /**
   * @param {string} baseURL
   * @param {string} password
   * @param {Object} options
   * @param {Object} options.client - Pre-built LettaClient instance (created by facade)
   */
  constructor(baseURL, password, options = {}) {
    // Client is injected by the facade so that test mocks on service.client
    // propagate to every sub-service (they all read config.client).
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
      options.sleeptimeFrequency || parseInt(process.env.LETTA_SLEEPTIME_FREQUENCY || '5');

    this.controlAgentName =
      options.controlAgentName || process.env.LETTA_CONTROL_AGENT || 'Huly-PM-Control';

    this.sharedHumanBlockId =
      options.sharedHumanBlockId || process.env.LETTA_SHARED_HUMAN_BLOCK_ID || null;

    // Paths
    this.lettaDir = path.join(__dirname, '..', '..', '.letta');
    this.settingsPath = path.join(this.lettaDir, 'settings.local.json');
  }
}
