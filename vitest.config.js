import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',
    
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
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules', 'dist'],
    
    // Reporter
    reporters: ['verbose', 'html'],
    
    // Parallel execution
    maxConcurrency: 5,
    minThreads: 1,
    maxThreads: 5,
  },
});
