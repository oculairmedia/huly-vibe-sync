#!/usr/bin/env node

/**
 * Deprecated legacy audit entrypoint.
 *
 * Project path management now lives in the VibeSync project registry and Beads
 * workflow. This script intentionally avoids Huly/MCP fallbacks so agents do not
 * revive the removed sidecar path.
 */

console.error(
  [
    'audit-project-paths.js is deprecated.',
    'Use the VibeSync registry instead:',
    '  npm run vibesync -- projects',
    '  npm run vibesync -- scan',
    'Issue tracking now uses Beads (`bd`) in each project repository.',
  ].join('\n'),
);

process.exitCode = 1;
