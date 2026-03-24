import 'dotenv/config';
import { configSchema } from './configSchema.js';

function parseBookMappings(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map(pair => pair.trim())
    .filter(Boolean)
    .map(pair => {
      const [projectIdentifier, bookSlug] = pair.split(':').map(s => s.trim());
      return { projectIdentifier, bookSlug };
    })
    .filter(m => m.projectIdentifier && m.bookSlug);
}

export function loadConfig() {
  const config = {
    beads: {
      enabled: process.env.BEADS_ENABLED !== 'false',
      syncInterval: parseInt(process.env.BEADS_SYNC_INTERVAL || '60000'),
      operationDelay: parseInt(process.env.BEADS_OPERATION_DELAY || '50'),
      batchDelay: parseInt(process.env.BEADS_BATCH_DELAY || '200'),
      maxConcurrent: parseInt(process.env.BEADS_MAX_CONCURRENT || '1'),
    },
    sync: {
      interval: parseInt(process.env.SYNC_INTERVAL || '300000'),
      dryRun: process.env.DRY_RUN === 'true',
      incremental: process.env.INCREMENTAL_SYNC !== 'false',
      parallel: process.env.PARALLEL_SYNC === 'true',
      maxWorkers: parseInt(process.env.MAX_WORKERS || '5'),
      skipEmpty: process.env.SKIP_EMPTY_PROJECTS === 'true',
      apiDelay: parseInt(process.env.API_DELAY || '10'),
    },
    reconciliation: {
      enabled: process.env.RECONCILIATION_ENABLED !== 'false',
      intervalMinutes: parseInt(process.env.RECONCILIATION_INTERVAL_MINUTES || '1440'),
      action: process.env.RECONCILIATION_ACTION || 'mark_deleted',
      dryRun: process.env.RECONCILIATION_DRY_RUN === 'true',
    },
    stacks: {
      baseDir: process.env.STACKS_DIR || '/opt/stacks',
    },
    letta: {
      enabled: process.env.LETTA_BASE_URL && process.env.LETTA_PASSWORD,
      baseURL: process.env.LETTA_BASE_URL,
      password: process.env.LETTA_PASSWORD,
      hulyMcpUrl: process.env.HULY_MCP_URL || 'http://192.168.50.90:3457/mcp',
    },
    graphiti: {
      enabled: process.env.GRAPHITI_ENABLED === 'true',
      apiUrl: process.env.GRAPHITI_API_URL || 'http://localhost:8003',
      groupIdPrefix: process.env.GRAPHITI_GROUP_ID_PREFIX || 'vibesync_',
      astEnabled: process.env.GRAPHITI_AST_ENABLED !== 'false',
      astGroupIdPrefix: process.env.GRAPHITI_AST_GROUP_ID_PREFIX || 'ast_',
      timeout: parseInt(process.env.GRAPHITI_TIMEOUT || '30000'),
      retries: parseInt(process.env.GRAPHITI_RETRIES || '3'),
    },
    codePerception: {
      enabled: process.env.CODE_PERCEPTION_ENABLED === 'true',
      debounceMs: parseInt(process.env.CODE_PERCEPTION_DEBOUNCE_MS || '2000'),
      batchSize: parseInt(process.env.CODE_PERCEPTION_BATCH_SIZE || '50'),
      maxFileSizeKb: parseInt(process.env.CODE_PERCEPTION_MAX_FILE_SIZE_KB || '500'),
      excludePatterns: (process.env.AST_EXCLUDE_PATTERNS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    },
    bookstack: {
      enabled: process.env.USE_BOOKSTACK_SYNC === 'true',
      url: process.env.BOOKSTACK_URL || 'http://192.168.50.80:8087',
      tokenId: process.env.BOOKSTACK_TOKEN_ID || '',
      tokenSecret: process.env.BOOKSTACK_TOKEN_SECRET || '',
      syncInterval: parseInt(process.env.BOOKSTACK_SYNC_INTERVAL || '3600000'),
      exportFormats: (process.env.BOOKSTACK_EXPORT_FORMATS || 'markdown').split(','),
      exportImages: process.env.BOOKSTACK_EXPORT_IMAGES !== 'false',
      exportAttachments: process.env.BOOKSTACK_EXPORT_ATTACHMENTS !== 'false',
      exportMeta: process.env.BOOKSTACK_EXPORT_META !== 'false',
      modifyMarkdownLinks: process.env.BOOKSTACK_MODIFY_LINKS !== 'false',
      docsSubdir: process.env.BOOKSTACK_DOCS_SUBDIR || 'docs/bookstack',
      projectBookMappings: parseBookMappings(process.env.BOOKSTACK_PROJECT_BOOKS || ''),
      exporterOutputPath: process.env.BOOKSTACK_EXPORTER_OUTPUT || '/bookstack-exports',
      importOnSync: process.env.BOOKSTACK_IMPORT_ON_SYNC === 'true',
      bidirectionalSync: process.env.BOOKSTACK_BIDIRECTIONAL_SYNC === 'true',
    },
    projectMcp: {
      enabled: process.env.PROJECT_MCP_ENABLED !== 'false',
      path: process.env.PROJECT_MCP_PATH || '/mcp',
    },
  };

  const result = configSchema.safeParse(config);
  if (!result.success) {
    const messages = result.error.issues.map(i => i.message).join('; ');
    throw new Error(`Config validation failed: ${messages}`);
  }

  validateConfig(config);

  return config;
}

export function validateConfig(config) {
  if (isNaN(config.sync.interval) || config.sync.interval < 1000) {
    throw new Error('SYNC_INTERVAL must be a number >= 1000 (milliseconds)');
  }

  if (isNaN(config.sync.maxWorkers) || config.sync.maxWorkers < 1) {
    throw new Error('MAX_WORKERS must be a number >= 1');
  }

  if (isNaN(config.sync.apiDelay) || config.sync.apiDelay < 0) {
    throw new Error('API_DELAY must be a number >= 0');
  }

  if (isNaN(config.reconciliation.intervalMinutes) || config.reconciliation.intervalMinutes < 1) {
    throw new Error('RECONCILIATION_INTERVAL_MINUTES must be a number >= 1');
  }

  if (!['mark_deleted', 'hard_delete'].includes(config.reconciliation.action)) {
    throw new Error('RECONCILIATION_ACTION must be mark_deleted or hard_delete');
  }

  if (config.letta.enabled) {
    if (!config.letta.baseURL) {
      throw new Error('LETTA_BASE_URL must be set when Letta is enabled');
    }
    if (!config.letta.password) {
      throw new Error('LETTA_PASSWORD must be set when Letta is enabled');
    }
  }

  if (config.bookstack.enabled) {
    if (!config.bookstack.url) {
      throw new Error('BOOKSTACK_URL must be set when USE_BOOKSTACK_SYNC is enabled');
    }
    if (!config.bookstack.tokenId || !config.bookstack.tokenSecret) {
      throw new Error(
        'BOOKSTACK_TOKEN_ID and BOOKSTACK_TOKEN_SECRET must be set when USE_BOOKSTACK_SYNC is enabled'
      );
    }
  }
}

export function getConfigSummary(config) {
  return {
    beadsEnabled: config.beads.enabled,
    beadsSyncInterval: `${config.beads.syncInterval / 1000}s`,
    stacksDir: config.stacks.baseDir,
    syncInterval: `${config.sync.interval / 1000}s`,
    incrementalSync: config.sync.incremental,
    parallelProcessing: config.sync.parallel,
    maxWorkers: config.sync.maxWorkers,
    skipEmptyProjects: config.sync.skipEmpty,
    dryRun: config.sync.dryRun,
    reconciliationEnabled: config.reconciliation.enabled,
    reconciliationIntervalMinutes: config.reconciliation.intervalMinutes,
    reconciliationAction: config.reconciliation.action,
    lettaEnabled: config.letta.enabled,
    graphitiEnabled: config.graphiti.enabled,
    graphitiApi: config.graphiti.apiUrl,
    graphitiAstEnabled: config.graphiti.astEnabled,
    codePerceptionEnabled: config.codePerception.enabled,
    bookstackEnabled: config.bookstack.enabled,
    bookstackUrl: config.bookstack.enabled ? config.bookstack.url : undefined,
    bookstackMappings: config.bookstack.projectBookMappings.length,
    projectMcpEnabled: config.projectMcp.enabled,
    projectMcpPath: config.projectMcp.path,
  };
}

export function isLettaEnabled(config) {
  return config.letta.enabled && config.letta.baseURL && config.letta.password;
}

export function getEnvironmentOverrides(env = process.env.NODE_ENV || 'production') {
  const overrides = {
    test: {
      sync: {
        interval: 1000,
        dryRun: true,
        parallel: false,
      },
    },
    development: {
      sync: {
        interval: 60000,
      },
    },
    production: {},
  };

  return overrides[env] || overrides.production;
}
