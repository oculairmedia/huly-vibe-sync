/**
 * ESLint Configuration for Huly-Vibe-Sync
 *
 * Enforces code quality standards for ES modules (Node.js)
 */

module.exports = {
  env: {
    node: true,
    es2022: true,
  },
  
  extends: [
    'eslint:recommended',
    'prettier', // Disables ESLint rules that conflict with Prettier
  ],
  
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  
  plugins: [
    'node',
  ],
  
  rules: {
    // Error prevention
    'no-unused-vars': ['warn', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    }],
    'no-console': 'off', // We use console for logging in Node.js
    'no-debugger': 'warn',
    'no-var': 'error', // Use const/let instead
    'prefer-const': 'warn',
    
    // Code style (complementary to Prettier)
    'no-multiple-empty-lines': ['warn', { max: 2 }],
    'no-trailing-spaces': 'warn',
    'eol-last': ['warn', 'always'],
    
    // Best practices
    'eqeqeq': ['warn', 'always'],
    'curly': ['warn', 'all'],
    'no-throw-literal': 'error',
    'require-await': 'warn',
    'no-return-await': 'warn',
    
    // Node.js specific
    'node/no-unsupported-features/es-syntax': ['error', {
      ignores: ['modules'],
    }],
    'node/no-missing-import': 'off', // Handled by module resolution
    'node/no-unpublished-import': 'off',
  },
  
  overrides: [
    {
      // Test files
      files: ['tests/**/*.js', '**/*.test.js'],
      env: {
        'vitest-globals/env': true,
      },
      rules: {
        'no-unused-expressions': 'off', // Allow expect() assertions
      },
    },
  ],
  
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
    '.test-data/',
    'logs/',
    '.letta/',
    '*.min.js',
  ],
};
