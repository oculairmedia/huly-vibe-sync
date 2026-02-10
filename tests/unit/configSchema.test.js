/**
 * Unit Tests for Zod Configuration Schema
 */

import { describe, it, expect } from 'vitest';
import { configSchema } from '../../lib/configSchema.js';

function validConfig(overrides = {}) {
  return {
    huly: { apiUrl: 'http://huly.local/api', useRestApi: true },
    vibeKanban: { mcpUrl: 'http://vibe.local/mcp', apiUrl: 'http://vibe.local/api', useRestApi: true },
    beads: { enabled: true, syncInterval: 60000, operationDelay: 50, batchDelay: 200, maxConcurrent: 1 },
    sync: { interval: 300000, dryRun: false, incremental: true, parallel: false, maxWorkers: 5, skipEmpty: false, apiDelay: 10 },
    reconciliation: { enabled: true, intervalMinutes: 1440, action: 'mark_deleted', dryRun: false },
    stacks: { baseDir: '/opt/stacks' },
    letta: { enabled: false, baseURL: undefined, password: undefined },
    graphiti: { enabled: false, apiUrl: 'http://localhost:8003', groupIdPrefix: 'vibesync_', timeout: 30000, retries: 3 },
    codePerception: { enabled: false, debounceMs: 2000, batchSize: 50, maxFileSizeKb: 500, excludePatterns: [] },
    bookstack: {
      enabled: false, url: 'http://192.168.50.80:8087', tokenId: '', tokenSecret: '',
      syncInterval: 3600000, exportFormats: ['markdown'], exportImages: true, exportAttachments: true,
      exportMeta: true, modifyMarkdownLinks: true, docsSubdir: 'docs/bookstack',
      projectBookMappings: [], exporterOutputPath: '/bookstack-exports',
      importOnSync: false, bidirectionalSync: false,
    },
    ...overrides,
  };
}

describe('configSchema', () => {
  it('accepts a fully valid config', () => {
    const result = configSchema.safeParse(validConfig());
    expect(result.success).toBe(true);
  });

  it('rejects missing huly.apiUrl', () => {
    const result = configSchema.safeParse(validConfig({ huly: { apiUrl: '', useRestApi: true } }));
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toContain('HULY_API_URL');
  });

  it('rejects missing vibe URLs', () => {
    const result = configSchema.safeParse(
      validConfig({ vibeKanban: { mcpUrl: '', apiUrl: '', useRestApi: true } })
    );
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toContain('VIBE_API_URL');
  });

  it('rejects negative sync interval', () => {
    const cfg = validConfig();
    cfg.sync.interval = -1;
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects maxWorkers < 1', () => {
    const cfg = validConfig();
    cfg.sync.maxWorkers = 0;
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects invalid reconciliation action', () => {
    const cfg = validConfig();
    cfg.reconciliation.action = 'nuke';
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toContain('mark_deleted');
  });

  it('rejects enabled Letta without baseURL', () => {
    const cfg = validConfig({ letta: { enabled: true, baseURL: '', password: 'secret' } });
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toContain('LETTA_BASE_URL');
  });

  it('rejects enabled Letta without password', () => {
    const cfg = validConfig({ letta: { enabled: true, baseURL: 'http://letta.local', password: '' } });
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toContain('LETTA_PASSWORD');
  });

  it('accepts Letta when disabled with no credentials', () => {
    const cfg = validConfig({ letta: { enabled: false } });
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it('rejects enabled bookstack without tokenId', () => {
    const cfg = validConfig();
    cfg.bookstack.enabled = true;
    cfg.bookstack.url = 'https://example.com';
    cfg.bookstack.tokenId = '';
    cfg.bookstack.tokenSecret = 'secret';
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toContain('BOOKSTACK_TOKEN_ID');
  });

  it('rejects NaN sync values (simulating SYNC_INTERVAL=abc)', () => {
    const cfg = validConfig();
    cfg.sync.interval = NaN;
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('accepts zero sync interval (run-once mode)', () => {
    const cfg = validConfig();
    cfg.sync.interval = 0;
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });
});
