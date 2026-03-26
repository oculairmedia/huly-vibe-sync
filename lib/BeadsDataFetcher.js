/**
 * BeadsDataFetcher.js
 *
 * Unified data fetcher for beads issue tracker.
 * Provides normalized issue data for LettaMemoryBuilders.
 *
 * This module replaces Huly API calls with beads data sources:
 * - Primary: BeadsDBReader (better-sqlite3 access to beads.db)
 * - Fallback: bd CLI (`bd list --all --json`)
 * - Activity: interactions.jsonl for recent changes
 */

import { readIssuesFromDB } from './BeadsDBReader.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Map beads priority (0-4 integer) to Huly-style priority string
 *
 * @param {number} priority - Beads priority (0=highest, 4=lowest)
 * @returns {string} Priority label (urgent, high, medium, low, none)
 */
function mapBeadsPriority(priority) {
  if (priority === null || priority === undefined) return 'none';

  const priorityMap = {
    0: 'urgent',
    1: 'high',
    2: 'medium',
    3: 'low',
    4: 'none',
  };

  return priorityMap[priority] || 'none';
}

/**
 * Map beads status to Huly-style status string
 *
 * @param {string} status - Beads status (open, in-progress, closed)
 * @returns {string} Status label for memory builders
 */
function mapBeadsStatus(status) {
  if (!status) return 'Backlog';

  const statusMap = {
    open: 'Todo',
    'in-progress': 'In Progress',
    closed: 'Done',
  };

  return statusMap[status] || 'Backlog';
}

/**
 * Normalize a beads issue to the format expected by LettaMemoryBuilders
 *
 * @param {Object} beadsIssue - Raw beads issue object
 * @returns {Object} Normalized issue matching Huly format expectations
 */
function normalizeBeadsIssue(beadsIssue) {
  return {
    // Core fields used by memory builders
    id: beadsIssue.id,
    identifier: beadsIssue.id, // Beads uses ID as identifier
    title: beadsIssue.title || 'Untitled',
    description: beadsIssue.description || '',
    status: mapBeadsStatus(beadsIssue.status),
    priority: mapBeadsPriority(beadsIssue.priority),

    // Timestamps (memory builders use modifiedOn for aging detection)
    createdOn: beadsIssue.created_at ? new Date(beadsIssue.created_at).getTime() : Date.now(),
    modifiedOn: beadsIssue.updated_at ? new Date(beadsIssue.updated_at).getTime() : Date.now(),

    // Additional metadata
    component: beadsIssue.issue_type || null, // Map type to component for now
    assignee: beadsIssue.assignee || null,

    // Preserve raw beads data for future use
    _beads: {
      raw_status: beadsIssue.status,
      raw_priority: beadsIssue.priority,
      closed_at: beadsIssue.closed_at || null,
      close_reason: beadsIssue.close_reason || null,
    },
  };
}

/**
 * Fetch all beads issues using the best available method
 *
 * @param {string} projectPath - Filesystem path to project root
 * @returns {Array<Object>} Array of normalized issue objects
 */
export function fetchAllIssues(projectPath) {
  // Try BeadsDBReader first (fastest, most reliable)
  let beadsIssues = readIssuesFromDB(projectPath);

  if (beadsIssues.length === 0) {
    // Fallback: bd CLI
    console.log('[BeadsDataFetcher] DB empty, trying bd CLI');
    beadsIssues = fetchIssuesViaCLI(projectPath);
  }

  // Normalize all issues to expected format
  return beadsIssues.map(normalizeBeadsIssue);
}

/**
 * Fetch only open beads issues (status: open or in-progress)
 *
 * @param {string} projectPath - Filesystem path to project root
 * @returns {Array<Object>} Array of normalized open issue objects
 */
export function fetchOpenIssues(projectPath) {
  const allIssues = fetchAllIssues(projectPath);

  return allIssues.filter(issue => {
    const rawStatus = issue._beads?.raw_status;
    return rawStatus === 'open' || rawStatus === 'in-progress';
  });
}

/**
 * Fetch recent activity from interactions.jsonl
 * Returns data compatible with buildRecentActivity() expectations
 *
 * @param {string} projectPath - Filesystem path to project root
 * @param {number} [sinceMs=86400000] - Look back window in milliseconds (default: 24h)
 * @returns {Object} Activity data matching Huly activity feed format
 */
export function fetchRecentActivity(projectPath, sinceMs = 86400000) {
  const interactionsPath = path.join(projectPath, '.beads', 'interactions.jsonl');

  if (!fs.existsSync(interactionsPath)) {
    return {
      activities: [],
      summary: { created: 0, updated: 0, total: 0 },
      byStatus: {},
      since: new Date(Date.now() - sinceMs).toISOString(),
    };
  }

  const cutoffTime = Date.now() - sinceMs;
  const activities = [];
  const byStatus = {};
  let createdCount = 0;
  let updatedCount = 0;

  const content = fs.readFileSync(interactionsPath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const interaction = JSON.parse(line);
      const updatedAt = new Date(interaction.updated_at).getTime();

      if (updatedAt < cutoffTime) continue;

      const createdAt = new Date(interaction.created_at).getTime();
      const isNew = createdAt >= cutoffTime;
      const activityType = isNew ? 'created' : 'updated';

      if (isNew) {
        createdCount++;
      } else {
        updatedCount++;
      }

      // Map beads status to Huly-style status
      const status = mapBeadsStatus(interaction.status);
      byStatus[status] = (byStatus[status] || 0) + 1;

      activities.push({
        type: activityType,
        issue: interaction.id,
        title: interaction.title || 'Untitled',
        status: status,
        timestamp: interaction.updated_at,
      });
    } catch (_error) {
      // Skip malformed lines
      continue;
    }
  }

  // Sort by timestamp descending (most recent first)
  activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return {
    activities,
    summary: {
      created: createdCount,
      updated: updatedCount,
      total: createdCount + updatedCount,
    },
    byStatus,
    since: new Date(cutoffTime).toISOString(),
  };
}

/**
 * Fallback: Fetch issues via bd CLI
 * Used when DB and JSONL are unavailable
 *
 * @param {string} projectPath - Filesystem path to project root
 * @returns {Array<Object>} Array of raw beads issue objects
 * @private
 */
function fetchIssuesViaCLI(projectPath) {
  try {
    const output = execSync('bd list --all --json', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'], // Suppress stderr
    });

    const issues = JSON.parse(output);
    return Array.isArray(issues) ? issues : [];
  } catch (error) {
    console.error('[BeadsDataFetcher] CLI fetch failed:', error.message);
    return [];
  }
}
