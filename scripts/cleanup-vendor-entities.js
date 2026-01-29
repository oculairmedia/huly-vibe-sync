#!/usr/bin/env node
/**
 * Cleanup Vendor Entities from Graphiti Knowledge Graph
 *
 * Identifies and deletes vendor/dependency entity nodes that were indexed
 * before exclusion filters were added. Targets entities with paths containing:
 * - node_modules/
 * - vendor/
 * - /dist/
 * - /build/
 * - __pycache__/
 * - .min.js
 * - .bundle.js
 * - .min.css
 * - /venv/
 * - /.venv/
 *
 * Usage:
 *   node scripts/cleanup-vendor-entities.js [options]
 *
 * Options:
 *   --execute              Actually delete entities (default: dry-run)
 *   --group-id=<id>        Target specific group ID (default: all vibesync_* groups)
 *   --verbose              Show detailed per-entity logging
 *
 * Examples:
 *   node scripts/cleanup-vendor-entities.js                    # Dry-run all groups
 *   node scripts/cleanup-vendor-entities.js --execute          # Delete from all groups
 *   node scripts/cleanup-vendor-entities.js --group-id=vibesync_HVSYN --execute
 */

import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const GRAPHITI_API_URL = process.env.GRAPHITI_API_URL || 'http://192.168.50.90:8003';
const MAX_REQUESTS_PER_SECOND = 10;
const REQUEST_DELAY_MS = 1000 / MAX_REQUESTS_PER_SECOND;

// Vendor detection patterns
const VENDOR_PATTERNS = [
  'node_modules/',
  'vendor/',
  '/dist/',
  '/build/',
  '__pycache__/',
  '.min.js',
  '.bundle.js',
  '.min.css',
  '/venv/',
  '/.venv/',
];

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs() {
  const args = {
    dryRun: true,
    groupId: null,
    verbose: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--execute') {
      args.dryRun = false;
    } else if (arg === '--verbose') {
      args.verbose = true;
    } else if (arg.startsWith('--group-id=')) {
      args.groupId = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node scripts/cleanup-vendor-entities.js [options]

Options:
  --execute              Actually delete entities (default: dry-run)
  --group-id=<id>        Target specific group ID (default: all vibesync_* groups)
  --verbose              Show detailed per-entity logging

Examples:
  node scripts/cleanup-vendor-entities.js                    # Dry-run all groups
  node scripts/cleanup-vendor-entities.js --execute          # Delete from all groups
  node scripts/cleanup-vendor-entities.js --group-id=vibesync_HVSYN --execute
      `);
      process.exit(0);
    } else {
      console.error(`${COLORS.red}Unknown argument: ${arg}${COLORS.reset}`);
      process.exit(1);
    }
  }

  return args;
}

// ============================================================================
// HTTP Client with Rate Limiting
// ============================================================================

class RateLimitedClient {
  constructor(baseUrl, requestsPerSecond) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.delayMs = 1000 / requestsPerSecond;
    this.lastRequestTime = 0;
  }

  async _rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.delayMs) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();
  }

  async request(path, options = {}) {
    await this._rateLimit();

    const url = new URL(path, this.baseUrl);

    return new Promise((resolve, reject) => {
      const req = http.request(
        url,
        {
          method: options.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(data ? JSON.parse(data) : {});
              } catch (e) {
                resolve({ raw: data });
              }
            } else if (res.statusCode === 404) {
              resolve({ notFound: true });
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            }
          });
        }
      );

      req.on('error', reject);

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }

      req.end();
    });
  }

  async get(path) {
    return this.request(path, { method: 'GET' });
  }

  async post(path, body) {
    return this.request(path, { method: 'POST', body });
  }

  async delete(path) {
    return this.request(path, { method: 'DELETE' });
  }
}

// ============================================================================
// Entity Discovery
// ============================================================================

function isVendorEntity(entityName) {
  return VENDOR_PATTERNS.some(pattern => entityName.includes(pattern));
}

async function discoverGroupIds(client, targetGroupId) {
  if (targetGroupId) {
    return [targetGroupId];
  }

  // Try to discover groups by searching for known patterns
  // Since there's no "list groups" endpoint, we'll use common group IDs
  const commonGroups = [
    'vibesync_HVSYN',
    'vibesync_graphiti',
    'vibesync_huly-vibe-sync',
    'vibesync_vibe-kanban',
  ];

  console.log(`${COLORS.cyan}Discovering groups...${COLORS.reset}`);
  const validGroups = [];

  for (const groupId of commonGroups) {
    try {
      // Try to get a UUID for this group to verify it exists
      const result = await client.get(`/api/utils/uuid?name=test&group_id=${groupId}`);
      if (result.uuid) {
        validGroups.push(groupId);
        console.log(`  ${COLORS.green}✓${COLORS.reset} Found group: ${groupId}`);
      }
    } catch (e) {
      // Group doesn't exist or error - skip
    }
  }

  if (validGroups.length === 0) {
    console.log(`${COLORS.yellow}No groups found, using default: vibesync_*${COLORS.reset}`);
    return ['vibesync_HVSYN']; // Fallback to main project
  }

  return validGroups;
}

async function searchEntities(client, groupId, query) {
  try {
    const result = await client.post('/search', {
      query,
      group_id: groupId,
      limit: 1000,
    });
    return result.results || [];
  } catch (e) {
    return [];
  }
}

async function discoverVendorEntities(client, groupId, verbose) {
  console.log(`\n${COLORS.cyan}Discovering vendor entities in group: ${groupId}${COLORS.reset}`);

  const vendorEntities = new Set();
  const searchQueries = [
    'node_modules',
    'vendor',
    'dist',
    'build',
    '__pycache__',
    'min.js',
    'bundle.js',
    'venv',
  ];

  for (const query of searchQueries) {
    if (verbose) {
      console.log(`  ${COLORS.gray}Searching for: ${query}${COLORS.reset}`);
    }
    const results = await searchEntities(client, groupId, query);

    for (const result of results) {
      const entityName = result.name || result.entity_name || '';
      if (entityName && isVendorEntity(entityName)) {
        vendorEntities.add(
          JSON.stringify({
            name: entityName,
            uuid: result.uuid || result.entity_uuid,
          })
        );
        if (verbose) {
          console.log(`    ${COLORS.yellow}→${COLORS.reset} ${entityName}`);
        }
      }
    }
  }

  // Convert back to objects
  return Array.from(vendorEntities).map(json => JSON.parse(json));
}

// ============================================================================
// Entity Deletion
// ============================================================================

async function deleteEntity(client, entity, dryRun, verbose) {
  if (dryRun) {
    if (verbose) {
      console.log(`  ${COLORS.gray}[DRY-RUN]${COLORS.reset} Would delete: ${entity.name}`);
    }
    return { success: true, dryRun: true };
  }

  try {
    const result = await client.delete(`/nodes/${entity.uuid}`);
    if (result.notFound) {
      if (verbose) {
        console.log(`  ${COLORS.gray}[SKIP]${COLORS.reset} Already deleted: ${entity.name}`);
      }
      return { success: true, skipped: true };
    }
    if (verbose) {
      console.log(`  ${COLORS.green}✓${COLORS.reset} Deleted: ${entity.name}`);
    }
    return { success: true };
  } catch (error) {
    if (error.message.includes('404')) {
      if (verbose) {
        console.log(`  ${COLORS.gray}[SKIP]${COLORS.reset} Already deleted: ${entity.name}`);
      }
      return { success: true, skipped: true };
    }
    console.error(
      `  ${COLORS.red}✗${COLORS.reset} Failed to delete ${entity.name}: ${error.message}`
    );
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const args = parseArgs();

  console.log(`${COLORS.magenta}=== Graphiti Vendor Entity Cleanup ===${COLORS.reset}\n`);
  console.log(`API URL: ${GRAPHITI_API_URL}`);
  console.log(
    `Mode: ${args.dryRun ? COLORS.yellow + 'DRY-RUN' : COLORS.red + 'EXECUTE'}${COLORS.reset}`
  );
  console.log(`Verbose: ${args.verbose ? 'ON' : 'OFF'}`);
  console.log(`Rate Limit: ${MAX_REQUESTS_PER_SECOND} req/s\n`);

  const client = new RateLimitedClient(GRAPHITI_API_URL, MAX_REQUESTS_PER_SECOND);

  // Discover groups
  const groupIds = await discoverGroupIds(client, args.groupId);
  console.log(`\nTarget groups: ${groupIds.join(', ')}\n`);

  const summary = {
    totalFound: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    byGroup: {},
  };

  // Process each group
  for (const groupId of groupIds) {
    const entities = await discoverVendorEntities(client, groupId, args.verbose);

    console.log(
      `\n${COLORS.cyan}Found ${entities.length} vendor entities in ${groupId}${COLORS.reset}`
    );
    summary.totalFound += entities.length;
    summary.byGroup[groupId] = {
      found: entities.length,
      deleted: 0,
      failed: 0,
      skipped: 0,
    };

    if (entities.length === 0) {
      continue;
    }

    // Delete entities
    console.log(`\n${args.dryRun ? 'Simulating' : 'Deleting'} entities...`);
    for (const entity of entities) {
      const result = await deleteEntity(client, entity, args.dryRun, args.verbose);

      if (result.success) {
        if (result.skipped) {
          summary.skipped++;
          summary.byGroup[groupId].skipped++;
        } else {
          summary.deleted++;
          summary.byGroup[groupId].deleted++;
        }
      } else {
        summary.failed++;
        summary.byGroup[groupId].failed++;
      }
    }
  }

  // Print summary
  console.log(`\n${COLORS.magenta}=== Summary ===${COLORS.reset}`);
  console.log(`Total found: ${COLORS.cyan}${summary.totalFound}${COLORS.reset}`);
  console.log(`Deleted: ${COLORS.green}${summary.deleted}${COLORS.reset}`);
  console.log(`Skipped: ${COLORS.gray}${summary.skipped}${COLORS.reset}`);
  console.log(`Failed: ${COLORS.red}${summary.failed}${COLORS.reset}`);

  console.log(`\n${COLORS.cyan}By Group:${COLORS.reset}`);
  for (const [groupId, stats] of Object.entries(summary.byGroup)) {
    console.log(`  ${groupId}:`);
    console.log(
      `    Found: ${stats.found}, Deleted: ${stats.deleted}, Skipped: ${stats.skipped}, Failed: ${stats.failed}`
    );
  }

  if (args.dryRun && summary.totalFound > 0) {
    console.log(
      `\n${COLORS.yellow}This was a dry-run. Use --execute to actually delete entities.${COLORS.reset}`
    );
  }

  // Exit with appropriate code
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error(`${COLORS.red}Fatal error: ${error.message}${COLORS.reset}`);
  console.error(error.stack);
  process.exit(1);
});
