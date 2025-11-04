/**
 * Configuration Management
 * 
 * Loads and validates configuration from environment variables
 */

import 'dotenv/config';

/**
 * Load and validate application configuration
 * 
 * @returns {Object} Validated configuration object
 */
export function loadConfig() {
  const config = {
    huly: {
      apiUrl: process.env.HULY_API_URL || process.env.HULY_MCP_URL || 'http://192.168.50.90:3457/api',
      useRestApi: process.env.HULY_USE_REST !== 'false', // Default to REST API
    },
    vibeKanban: {
      mcpUrl: process.env.VIBE_MCP_URL || 'http://192.168.50.90:9717/mcp',
      apiUrl: process.env.VIBE_API_URL || 'http://192.168.50.90:3105/api',
      useRestApi: process.env.VIBE_USE_REST !== 'false', // Default to REST API
    },
    sync: {
      interval: parseInt(process.env.SYNC_INTERVAL || '300000'), // 5 minutes default
      dryRun: process.env.DRY_RUN === 'true',
      incremental: process.env.INCREMENTAL_SYNC !== 'false', // Default to true
      parallel: process.env.PARALLEL_SYNC === 'true', // Parallel processing
      maxWorkers: parseInt(process.env.MAX_WORKERS || '5'), // Max concurrent workers
      skipEmpty: process.env.SKIP_EMPTY_PROJECTS === 'true', // Skip projects with 0 issues
      apiDelay: parseInt(process.env.API_DELAY || '10'), // Delay between API calls (ms)
    },
    stacks: {
      baseDir: process.env.STACKS_DIR || '/opt/stacks',
    },
    letta: {
      enabled: process.env.LETTA_BASE_URL && process.env.LETTA_PASSWORD,
      baseURL: process.env.LETTA_BASE_URL,
      password: process.env.LETTA_PASSWORD,
      hulyMcpUrl: process.env.HULY_MCP_URL || 'http://192.168.50.90:3457/mcp',
      vibeMcpUrl: process.env.VIBE_MCP_URL,
    },
  };

  // Validate required configuration
  validateConfig(config);

  return config;
}

/**
 * Validate configuration values
 * 
 * @param {Object} config - Configuration object to validate
 * @throws {Error} If required configuration is missing or invalid
 */
export function validateConfig(config) {
  // Validate URLs
  if (!config.huly.apiUrl) {
    throw new Error('HULY_API_URL or HULY_MCP_URL must be set');
  }

  if (!config.vibeKanban.apiUrl && !config.vibeKanban.mcpUrl) {
    throw new Error('VIBE_API_URL or VIBE_MCP_URL must be set');
  }

  // Validate numeric values
  if (isNaN(config.sync.interval) || config.sync.interval < 1000) {
    throw new Error('SYNC_INTERVAL must be a number >= 1000 (milliseconds)');
  }

  if (isNaN(config.sync.maxWorkers) || config.sync.maxWorkers < 1) {
    throw new Error('MAX_WORKERS must be a number >= 1');
  }

  if (isNaN(config.sync.apiDelay) || config.sync.apiDelay < 0) {
    throw new Error('API_DELAY must be a number >= 0');
  }

  // Validate Letta configuration if enabled
  if (config.letta.enabled) {
    if (!config.letta.baseURL) {
      throw new Error('LETTA_BASE_URL must be set when Letta is enabled');
    }
    if (!config.letta.password) {
      throw new Error('LETTA_PASSWORD must be set when Letta is enabled');
    }
  }
}

/**
 * Get a formatted configuration summary for logging
 * 
 * @param {Object} config - Configuration object
 * @returns {Object} Summary object suitable for logging
 */
export function getConfigSummary(config) {
  return {
    hulyApi: config.huly.apiUrl,
    hulyMode: config.huly.useRestApi ? 'REST API' : 'MCP',
    vibeApi: config.vibeKanban.apiUrl,
    vibeMode: 'REST API', // Currently always REST for Vibe
    stacksDir: config.stacks.baseDir,
    syncInterval: `${config.sync.interval / 1000}s`,
    incrementalSync: config.sync.incremental,
    parallelProcessing: config.sync.parallel,
    maxWorkers: config.sync.maxWorkers,
    skipEmptyProjects: config.sync.skipEmpty,
    dryRun: config.sync.dryRun,
    lettaEnabled: config.letta.enabled,
  };
}

/**
 * Check if Letta integration is enabled and properly configured
 * 
 * @param {Object} config - Configuration object
 * @returns {boolean} True if Letta is enabled and configured
 */
export function isLettaEnabled(config) {
  return config.letta.enabled && 
         config.letta.baseURL && 
         config.letta.password;
}

/**
 * Get environment-specific configuration overrides
 * Useful for testing or different deployment environments
 * 
 * @param {string} env - Environment name (development, production, test)
 * @returns {Object} Environment-specific configuration overrides
 */
export function getEnvironmentOverrides(env = process.env.NODE_ENV || 'production') {
  const overrides = {
    test: {
      sync: {
        interval: 1000, // Faster sync in tests
        dryRun: true, // Always dry run in tests
        parallel: false, // Sequential in tests for predictability
      },
    },
    development: {
      sync: {
        interval: 60000, // 1 minute in development
      },
    },
    production: {
      // Use defaults from loadConfig()
    },
  };

  return overrides[env] || overrides.production;
}
