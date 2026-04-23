import { z } from 'zod';

const syncSchema = z.object({
  interval: z.number().int().min(0, 'SYNC_INTERVAL must be >= 0'),
  dryRun: z.boolean(),
  incremental: z.boolean(),
  parallel: z.boolean(),
  maxWorkers: z.number().int().min(1, 'MAX_WORKERS must be >= 1'),
  skipEmpty: z.boolean(),
  apiDelay: z.number().int().min(0, 'API_DELAY must be >= 0'),
});

const reconciliationSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(1, 'RECONCILIATION_INTERVAL_MINUTES must be >= 1'),
  action: z.enum(['mark_deleted', 'hard_delete'], {
    message: 'RECONCILIATION_ACTION must be mark_deleted or hard_delete',
  }),
  dryRun: z.boolean(),
});

const stacksSchema = z.object({
  baseDir: z.string().min(1),
});

const lettaSchema = z
  .object({
    enabled: z.any(),
    baseURL: z.string().optional(),
    password: z.string().optional(),
    hulyMcpUrl: z.string().optional(),
  })
  .refine(data => !data.enabled || data.baseURL, {
    message: 'LETTA_BASE_URL must be set when Letta is enabled',
  })
  .refine(data => !data.enabled || data.password, {
    message: 'LETTA_PASSWORD must be set when Letta is enabled',
  });

const graphitiSchema = z.object({
  enabled: z.boolean(),
  apiUrl: z.string(),
  groupIdPrefix: z.string(),
  astEnabled: z.boolean(),
  astGroupIdPrefix: z.string(),
  timeout: z.number().int().positive(),
  retries: z.number().int().nonnegative(),
});

const codePerceptionSchema = z.object({
  enabled: z.boolean(),
  debounceMs: z.number().int().nonnegative(),
  batchSize: z.number().int().positive(),
  maxFileSizeKb: z.number().int().positive(),
  excludePatterns: z.array(z.string()),
  sourceRoots: z.array(z.string()).optional(),
  allowlistMode: z.boolean().optional(),
});

const bookstackSchema = z
  .object({
    enabled: z.boolean(),
    url: z.string(),
    tokenId: z.string(),
    tokenSecret: z.string(),
    syncInterval: z.number().int().positive(),
    exportFormats: z.array(z.string()),
    exportImages: z.boolean(),
    exportAttachments: z.boolean(),
    exportMeta: z.boolean(),
    modifyMarkdownLinks: z.boolean(),
    docsSubdir: z.string(),
    projectBookMappings: z.array(
      z.object({
        projectIdentifier: z.string(),
        bookSlug: z.string(),
      })
    ),
    exporterOutputPath: z.string(),
    importOnSync: z.boolean(),
    bidirectionalSync: z.boolean(),
  })
  .refine(data => !data.enabled || data.url, {
    message: 'BOOKSTACK_URL must be set when USE_BOOKSTACK_SYNC is enabled',
  })
  .refine(data => !data.enabled || (data.tokenId && data.tokenSecret), {
    message:
      'BOOKSTACK_TOKEN_ID and BOOKSTACK_TOKEN_SECRET must be set when USE_BOOKSTACK_SYNC is enabled',
  });

const projectMcpSchema = z.object({
  enabled: z.boolean(),
  path: z.string().min(1),
});

export const configSchema = z.object({
  sync: syncSchema,
  reconciliation: reconciliationSchema,
  stacks: stacksSchema,
  letta: lettaSchema,
  graphiti: graphitiSchema,
  codePerception: codePerceptionSchema,
  bookstack: bookstackSchema,
  projectMcp: projectMcpSchema,
});
