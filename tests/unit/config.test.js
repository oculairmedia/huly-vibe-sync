/**
 * Unit Tests for Configuration Management
 * 
 * Tests configuration loading, validation, and utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadConfig,
  validateConfig,
  getConfigSummary,
  isLettaEnabled,
  getEnvironmentOverrides,
} from '../../lib/config.js';

describe('config', () => {
  // Store original environment variables
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset to clean environment for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load default configuration', () => {
      const config = loadConfig();

      expect(config).toBeDefined();
      expect(config.huly).toBeDefined();
      expect(config.vibeKanban).toBeDefined();
      expect(config.sync).toBeDefined();
      expect(config.stacks).toBeDefined();
      expect(config.letta).toBeDefined();
    });

    it('should use environment variables when provided', () => {
      process.env.HULY_API_URL = 'http://custom-huly.local/api';
      process.env.VIBE_API_URL = 'http://custom-vibe.local/api';
      process.env.SYNC_INTERVAL = '60000';
      process.env.MAX_WORKERS = '10';

      const config = loadConfig();

      expect(config.huly.apiUrl).toBe('http://custom-huly.local/api');
      expect(config.vibeKanban.apiUrl).toBe('http://custom-vibe.local/api');
      expect(config.sync.interval).toBe(60000);
      expect(config.sync.maxWorkers).toBe(10);
    });

    it('should parse boolean flags correctly', () => {
      process.env.DRY_RUN = 'true';
      process.env.PARALLEL_SYNC = 'true';
      process.env.SKIP_EMPTY_PROJECTS = 'true';

      const config = loadConfig();

      expect(config.sync.dryRun).toBe(true);
      expect(config.sync.parallel).toBe(true);
      expect(config.sync.skipEmpty).toBe(true);
    });

    it('should default incremental sync based on environment', () => {
      // In test environment, INCREMENTAL_SYNC is set to 'false' in setup.js
      const config = loadConfig();
      expect(config.sync.incremental).toBe(false);
    });

    it('should allow disabling incremental sync', () => {
      process.env.INCREMENTAL_SYNC = 'false';
      const config = loadConfig();
      expect(config.sync.incremental).toBe(false);
    });

    it('should enable Letta when credentials are provided', () => {
      process.env.LETTA_BASE_URL = 'http://letta.local';
      process.env.LETTA_PASSWORD = 'secret123';

      const config = loadConfig();

      // enabled is truthy (both URL and password are set)
      expect(config.letta.enabled).toBeTruthy();
      expect(config.letta.baseURL).toBe('http://letta.local');
      expect(config.letta.password).toBe('secret123');
    });

    it('should disable Letta when credentials are missing', () => {
      delete process.env.LETTA_BASE_URL;
      delete process.env.LETTA_PASSWORD;

      const config = loadConfig();

      expect(config.letta.enabled).toBeFalsy();
    });

    it('should use stacks directory from environment', () => {
      const config = loadConfig();
      // In test environment, STACKS_DIR is overridden in setup.js
      expect(config.stacks.baseDir).toContain('stacks');
    });

    it('should allow custom stacks directory', () => {
      process.env.STACKS_DIR = '/custom/stacks';
      const config = loadConfig();
      expect(config.stacks.baseDir).toBe('/custom/stacks');
    });

    it('should default to REST API mode for Huly', () => {
      const config = loadConfig();
      expect(config.huly.useRestApi).toBe(true);
    });

    it('should allow disabling REST API mode for Huly', () => {
      process.env.HULY_USE_REST = 'false';
      const config = loadConfig();
      expect(config.huly.useRestApi).toBe(false);
    });
  });

  describe('validateConfig', () => {
    it('should validate a valid configuration', () => {
      const config = loadConfig();
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should reject configuration without Huly URL', () => {
      const config = {
        huly: { apiUrl: '' },
        vibeKanban: { apiUrl: 'http://vibe.local' },
        sync: { interval: 5000, maxWorkers: 5, apiDelay: 10 },
        letta: { enabled: false },
      };

      expect(() => validateConfig(config)).toThrow('HULY_API_URL or HULY_MCP_URL must be set');
    });

    it('should reject configuration without Vibe URL', () => {
      const config = {
        huly: { apiUrl: 'http://huly.local' },
        vibeKanban: { apiUrl: '', mcpUrl: '' },
        sync: { interval: 5000, maxWorkers: 5, apiDelay: 10 },
        letta: { enabled: false },
      };

      expect(() => validateConfig(config)).toThrow('VIBE_API_URL or VIBE_MCP_URL must be set');
    });

    it('should reject sync interval less than 1000ms', () => {
      const config = {
        huly: { apiUrl: 'http://huly.local' },
        vibeKanban: { apiUrl: 'http://vibe.local' },
        sync: { interval: 500, maxWorkers: 5, apiDelay: 10 },
        letta: { enabled: false },
      };

      expect(() => validateConfig(config)).toThrow('SYNC_INTERVAL must be a number >= 1000');
    });

    it('should reject invalid maxWorkers', () => {
      const config = {
        huly: { apiUrl: 'http://huly.local' },
        vibeKanban: { apiUrl: 'http://vibe.local' },
        sync: { interval: 5000, maxWorkers: 0, apiDelay: 10 },
        letta: { enabled: false },
      };

      expect(() => validateConfig(config)).toThrow('MAX_WORKERS must be a number >= 1');
    });

    it('should reject negative API delay', () => {
      const config = {
        huly: { apiUrl: 'http://huly.local' },
        vibeKanban: { apiUrl: 'http://vibe.local' },
        sync: { interval: 5000, maxWorkers: 5, apiDelay: -1 },
        letta: { enabled: false },
      };

      expect(() => validateConfig(config)).toThrow('API_DELAY must be a number >= 0');
    });

    it('should reject enabled Letta without base URL', () => {
      const config = {
        huly: { apiUrl: 'http://huly.local' },
        vibeKanban: { apiUrl: 'http://vibe.local' },
        sync: { interval: 5000, maxWorkers: 5, apiDelay: 10 },
        letta: { enabled: true, baseURL: '', password: 'secret' },
      };

      expect(() => validateConfig(config)).toThrow('LETTA_BASE_URL must be set when Letta is enabled');
    });

    it('should reject enabled Letta without password', () => {
      const config = {
        huly: { apiUrl: 'http://huly.local' },
        vibeKanban: { apiUrl: 'http://vibe.local' },
        sync: { interval: 5000, maxWorkers: 5, apiDelay: 10 },
        letta: { enabled: true, baseURL: 'http://letta.local', password: '' },
      };

      expect(() => validateConfig(config)).toThrow('LETTA_PASSWORD must be set when Letta is enabled');
    });
  });

  describe('getConfigSummary', () => {
    it('should return a formatted summary', () => {
      const config = loadConfig();
      const summary = getConfigSummary(config);

      expect(summary).toHaveProperty('hulyApi');
      expect(summary).toHaveProperty('hulyMode');
      expect(summary).toHaveProperty('vibeApi');
      expect(summary).toHaveProperty('vibeMode');
      expect(summary).toHaveProperty('syncInterval');
      expect(summary).toHaveProperty('dryRun');
    });

    it('should format sync interval in seconds', () => {
      process.env.SYNC_INTERVAL = '60000';
      const config = loadConfig();
      const summary = getConfigSummary(config);

      expect(summary.syncInterval).toBe('60s');
    });

    it('should show REST API mode for Huly', () => {
      const config = loadConfig();
      const summary = getConfigSummary(config);

      expect(summary.hulyMode).toBe('REST API');
    });

    it('should show MCP mode when REST is disabled', () => {
      process.env.HULY_USE_REST = 'false';
      const config = loadConfig();
      const summary = getConfigSummary(config);

      expect(summary.hulyMode).toBe('MCP');
    });

    it('should include all sync settings', () => {
      process.env.DRY_RUN = 'true';
      process.env.PARALLEL_SYNC = 'true';
      process.env.MAX_WORKERS = '10';
      process.env.SKIP_EMPTY_PROJECTS = 'true';

      const config = loadConfig();
      const summary = getConfigSummary(config);

      expect(summary.dryRun).toBe(true);
      expect(summary.parallelProcessing).toBe(true);
      expect(summary.maxWorkers).toBe(10);
      expect(summary.skipEmptyProjects).toBe(true);
    });
  });

  describe('isLettaEnabled', () => {
    it('should return true when Letta is fully configured', () => {
      process.env.LETTA_BASE_URL = 'http://letta.local';
      process.env.LETTA_PASSWORD = 'secret';

      const config = loadConfig();
      expect(isLettaEnabled(config)).toBeTruthy();
    });

    it('should return false when Letta is disabled', () => {
      delete process.env.LETTA_BASE_URL;
      delete process.env.LETTA_PASSWORD;

      const config = loadConfig();
      expect(isLettaEnabled(config)).toBeFalsy();
    });

    it('should return false when base URL is missing', () => {
      delete process.env.LETTA_BASE_URL;
      process.env.LETTA_PASSWORD = 'secret';

      const config = loadConfig();
      expect(isLettaEnabled(config)).toBeFalsy();
    });

    it('should return false when password is missing', () => {
      process.env.LETTA_BASE_URL = 'http://letta.local';
      delete process.env.LETTA_PASSWORD;

      const config = loadConfig();
      expect(isLettaEnabled(config)).toBeFalsy();
    });
  });

  describe('getEnvironmentOverrides', () => {
    it('should return test overrides for test environment', () => {
      const overrides = getEnvironmentOverrides('test');

      expect(overrides.sync.interval).toBe(1000);
      expect(overrides.sync.dryRun).toBe(true);
      expect(overrides.sync.parallel).toBe(false);
    });

    it('should return development overrides for development environment', () => {
      const overrides = getEnvironmentOverrides('development');

      expect(overrides.sync.interval).toBe(60000);
    });

    it('should return production overrides by default', () => {
      const overrides = getEnvironmentOverrides('production');
      expect(overrides).toBeDefined();
    });

    it('should return production overrides for unknown environment', () => {
      const overrides = getEnvironmentOverrides('unknown');
      expect(overrides).toBeDefined();
    });

    it('should use NODE_ENV when no environment specified', () => {
      process.env.NODE_ENV = 'test';
      const overrides = getEnvironmentOverrides();

      expect(overrides.sync.dryRun).toBe(true);
    });
  });
});
