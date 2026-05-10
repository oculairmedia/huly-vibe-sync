import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Force process-based workers with explicit caps so large Temporal tests
    // cannot fan out into dozens of orphaned Node processes.
    pool: 'forks',
    fileParallelism: false,
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,
        execArgv: ['--max-old-space-size=2048'],
      },
    },

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '*.config.js',
        'cleanup-*.js',
        'fix-*.js',
        'test-*.js',
        'delete-*.js',
        'quick-*.js',
        '.letta/',
        'logs/',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },

    // Test timeout
    testTimeout: 30000,
    hookTimeout: 30000,

    // Globals
    globals: true,

    // Setup files
    setupFiles: ['./tests/setup.js'],

    // Include/exclude patterns
    include: ['tests/**/*.test.{js,ts}'],
    exclude: ['node_modules', 'dist'],

    // Reporter
    reporters: ['verbose', 'html'],

    // Keep in-test concurrency low; Temporal test environments are memory-heavy.
    maxConcurrency: 2,
  },
});
