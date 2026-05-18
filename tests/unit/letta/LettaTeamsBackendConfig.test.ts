import { describe, expect, it } from 'vitest';

import { LettaTeamsBackendConfig } from '../../../src/letta/LettaTeamsBackendConfig.js';

describe('LettaTeamsBackendConfig', () => {
  it('reads LETTA_BASE_URL + LETTA_API_KEY from env', () => {
    const cfg = new LettaTeamsBackendConfig({
      env: {
        LETTA_BASE_URL: 'https://letta.oculair.ca',
        LETTA_API_KEY: 'sk-abc',
      },
    });
    expect(cfg.baseUrl).toBe('https://letta.oculair.ca');
    expect(cfg.apiKey).toBe('sk-abc');
    expect(cfg.cliPath).toBeNull();
  });

  it('falls back to LETTA_PASSWORD when LETTA_API_KEY is absent', () => {
    const cfg = new LettaTeamsBackendConfig({
      env: {
        LETTA_BASE_URL: 'https://letta.oculair.ca',
        LETTA_PASSWORD: 'legacy-token',
      },
    });
    expect(cfg.apiKey).toBe('legacy-token');
  });

  it('defaults baseUrl to Letta Cloud when LETTA_BASE_URL is unset', () => {
    const cfg = new LettaTeamsBackendConfig({ env: { LETTA_API_KEY: 'k' } });
    expect(cfg.baseUrl).toBe('https://api.letta.com');
  });

  it('explicit args win over env', () => {
    const cfg = new LettaTeamsBackendConfig({
      baseUrl: 'https://explicit.example',
      apiKey: 'explicit-key',
      cliPath: '/usr/local/bin/letta',
      env: { LETTA_BASE_URL: 'https://env.example', LETTA_API_KEY: 'env-key' },
    });
    expect(cfg.baseUrl).toBe('https://explicit.example');
    expect(cfg.apiKey).toBe('explicit-key');
    expect(cfg.cliPath).toBe('/usr/local/bin/letta');
  });

  it('throws when neither LETTA_API_KEY nor LETTA_PASSWORD is set and no apiKey arg is supplied', () => {
    expect(() => new LettaTeamsBackendConfig({ env: { LETTA_BASE_URL: 'https://x' } })).toThrow(
      /no apiKey supplied/,
    );
  });

  it('daemonEnv() returns only the env vars teams needs', () => {
    const cfg = new LettaTeamsBackendConfig({
      env: {
        LETTA_BASE_URL: 'https://letta.oculair.ca',
        LETTA_API_KEY: 'k',
        LETTA_CLI_PATH: '/opt/cli/letta',
      },
    });
    expect(cfg.daemonEnv()).toEqual({
      LETTA_BASE_URL: 'https://letta.oculair.ca',
      LETTA_API_KEY: 'k',
      LETTA_CLI_PATH: '/opt/cli/letta',
    });
  });

  it('daemonEnv() omits LETTA_CLI_PATH when no path is configured', () => {
    const cfg = new LettaTeamsBackendConfig({ env: { LETTA_API_KEY: 'k' } });
    expect(cfg.daemonEnv()).toEqual({
      LETTA_BASE_URL: 'https://api.letta.com',
      LETTA_API_KEY: 'k',
    });
  });

  it('applyToProcessEnv() mutates the target env and returns what was set', () => {
    const cfg = new LettaTeamsBackendConfig({
      env: {
        LETTA_BASE_URL: 'https://letta.oculair.ca',
        LETTA_API_KEY: 'k',
      },
    });
    const target: NodeJS.ProcessEnv = { EXISTING: 'preserved' };
    const applied = cfg.applyToProcessEnv(target);
    expect(target).toEqual({
      EXISTING: 'preserved',
      LETTA_BASE_URL: 'https://letta.oculair.ca',
      LETTA_API_KEY: 'k',
    });
    expect(applied).toEqual({
      LETTA_BASE_URL: 'https://letta.oculair.ca',
      LETTA_API_KEY: 'k',
    });
  });

  it('buildSeeder() returns a MemoryBlockSeeder pointed at the same backend', () => {
    const cfg = new LettaTeamsBackendConfig({
      env: {
        LETTA_BASE_URL: 'https://letta.oculair.ca',
        LETTA_API_KEY: 'k',
      },
    });
    const seeder = cfg.buildSeeder();
    expect(typeof seeder.seed).toBe('function');
  });
});
