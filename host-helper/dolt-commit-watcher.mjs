#!/usr/bin/env node

/**
 * Dolt Commit Watcher
 *
 * Replaces the beads SDK polling in beads-mutation-watcher.mjs with
 * Dolt commit-based change detection. Instead of polling the daemon
 * for mutations via watchMutations(), we poll the Dolt HEAD commit
 * hash and use dolt_diff() to discover which issues changed.
 *
 * Chain: bd create/close -> Dolt commit -> this watcher detects HEAD change
 *        -> dolt_diff() for changed rows -> POST /api/beads/mutation -> Temporal workflow
 *
 * Key advantages over SDK polling:
 *   - Dolt commits are atomic: no partial reads, no missed mutations
 *   - No dependency on @herbcaudill/beads-sdk for watching
 *   - Change detection is based on commit hashes (cheap comparison)
 *
 * @module dolt-commit-watcher
 */

import { DoltQueryService } from '../lib/DoltQueryService.js';
import { basename } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';

// ── Configuration ────────────────────────────────────────────────

const SYNC_API = process.env.BEADS_SYNC_API || 'http://localhost:3099/api/beads/mutation';
const POLL_INTERVAL = parseInt(process.env.BEADS_POLL_INTERVAL || '3000', 10);
const DEBOUNCE_MS = parseInt(process.env.BEADS_DEBOUNCE_MS || '3000', 10);
const HEALTH_INTERVAL = parseInt(process.env.BEADS_HEALTH_INTERVAL || '30000', 10);
const RECONNECT_INTERVAL = parseInt(process.env.BEADS_RECONNECT_INTERVAL || '10000', 10);
const SYNC_RETRY_ATTEMPTS = parseInt(process.env.BEADS_SYNC_RETRY_ATTEMPTS || '3', 10);
const SYNC_RETRY_BASE_MS = parseInt(process.env.BEADS_SYNC_RETRY_BASE_MS || '2000', 10);
const RECONCILE_INTERVAL = parseInt(process.env.BEADS_RECONCILE_INTERVAL || '1800000', 10); // 30 min
const RECONCILE_API = process.env.BEADS_RECONCILE_API || 'http://localhost:3099/api/beads/reconcile';
const WATCH_ROOT = process.env.BEADS_WATCH_ROOT || '/opt/stacks';

// Dolt diff_type -> mutation type mapping
const DIFF_TYPE_MAP = {
  added: 'create',
  modified: 'update',
  removed: 'delete',
};

// Mutation types that should trigger a sync
const SYNCABLE_MUTATIONS = new Set(['create', 'update', 'status', 'delete']);

// ── Logging ──────────────────────────────────────────────────────

function log(level, msg, data = {}) {
  const ts = new Date().toISOString();
  const extra = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}${extra}`);
}

// ── Workspace Discovery ──────────────────────────────────────────

/**
 * Discover workspaces by scanning for .beads/dolt-server.port files
 * under WATCH_ROOT. Each workspace with a running Dolt server is
 * eligible for commit watching.
 *
 * @returns {Array<{path: string, name: string}>}
 */
function discoverWorkspaces() {
  const workspaces = [];

  try {
    const entries = readdirSync(WATCH_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const wsPath = `${WATCH_ROOT}/${entry.name}`;
      const portFile = `${wsPath}/.beads/dolt-server.port`;

      if (existsSync(portFile)) {
        workspaces.push({ path: wsPath, name: entry.name });
      }
    }
  } catch (err) {
    log('error', 'Failed to scan for workspaces', { root: WATCH_ROOT, error: err.message });
  }

  return workspaces;
}

// ── Per-Workspace Watcher ────────────────────────────────────────

class WorkspaceWatcher {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.projectName = basename(workspacePath);
    this.doltService = null;
    this.lastSeenCommit = null;
    this.pollTimer = null;
    this.pendingIssues = new Map(); // issueId -> { timer, mutation }
    this.running = false;
    this.stats = { mutations: 0, syncs: 0, errors: 0, reconciliations: 0, polls: 0 };
  }

  async start() {
    if (this.running) return;
    this.running = true;

    try {
      // Connect DoltQueryService for this workspace
      this.doltService = new DoltQueryService();
      await this.doltService.connect(this.workspacePath);
      log('info', `Connected to Dolt SQL server`, { workspace: this.projectName });

      // Capture initial commit hash as baseline
      this.lastSeenCommit = await this.doltService.getCurrentCommitHash();
      log('info', `Initial commit hash captured`, {
        workspace: this.projectName,
        commit: this.lastSeenCommit?.substring(0, 12),
      });

      // Start polling for commit changes
      this.pollTimer = setInterval(() => {
        this._pollForChanges().catch(err => {
          log('error', `Poll cycle failed`, {
            workspace: this.projectName,
            error: err.message,
          });
        });
      }, POLL_INTERVAL);

      log('info', `Watching for Dolt commits`, {
        workspace: this.projectName,
        pollInterval: POLL_INTERVAL,
        debounce: DEBOUNCE_MS,
      });
    } catch (err) {
      log('error', `Failed to start watcher`, {
        workspace: this.projectName,
        error: err.message,
      });
      this.running = false;
      throw err;
    }
  }

  async stop() {
    if (!this.running) return;
    this.running = false;

    // Stop polling
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Clear pending debounce timers
    for (const [, { timer }] of this.pendingIssues) {
      clearTimeout(timer);
    }
    this.pendingIssues.clear();

    // Disconnect Dolt service
    if (this.doltService) {
      await this.doltService.disconnect();
      this.doltService = null;
    }

    log('info', `Stopped watcher`, { workspace: this.projectName, stats: this.stats });
  }

  /**
   * Poll the HEAD commit hash; if it changed, diff the issues table
   * to discover which rows were added, modified, or removed.
   */
  async _pollForChanges() {
    if (!this.running || !this.doltService) return;

    this.stats.polls++;

    const currentCommit = await this.doltService.getCurrentCommitHash();

    if (currentCommit === this.lastSeenCommit) {
      return; // No new commits
    }

    log('info', `New commit detected`, {
      workspace: this.projectName,
      previous: this.lastSeenCommit?.substring(0, 12),
      current: currentCommit?.substring(0, 12),
    });

    const previousCommit = this.lastSeenCommit;
    this.lastSeenCommit = currentCommit;

    try {
      const diffRows = await this.doltService.getRecentChanges(previousCommit);

      if (diffRows.length === 0) {
        log('debug', `Commit detected but no issue changes`, { workspace: this.projectName });
        return;
      }

      log('info', `Found ${diffRows.length} diff row(s)`, {
        workspace: this.projectName,
        commit: currentCommit?.substring(0, 12),
      });

      for (const row of diffRows) {
        this._handleDiffRow(row);
      }
    } catch (err) {
      log('error', `Failed to process diff`, {
        workspace: this.projectName,
        error: err.message,
        previousCommit: previousCommit?.substring(0, 12),
        currentCommit: currentCommit?.substring(0, 12),
      });
      // Don't reset lastSeenCommit — we'll retry from the new HEAD on the next poll
    }
  }

  /**
   * Convert a Dolt diff row into a mutation event and debounce it.
   *
   * Dolt diff row columns:
   *   - diff_type: 'added' | 'modified' | 'removed'
   *   - to_* columns: new values (present for added/modified)
   *   - from_* columns: old values (present for modified/removed)
   */
  _handleDiffRow(row) {
    const diffType = row.diff_type;
    const mutationType = DIFF_TYPE_MAP[diffType];

    if (!mutationType) {
      log('debug', `Ignoring unknown diff_type`, { diffType });
      return;
    }

    if (!SYNCABLE_MUTATIONS.has(mutationType)) {
      log('debug', `Ignoring non-syncable mutation type`, { type: mutationType });
      return;
    }

    // Extract issue ID from the appropriate column
    // For 'added' and 'modified': use to_id (new row state)
    // For 'removed': use from_id (old row state)
    const issueId = diffType === 'removed' ? row.from_id : row.to_id;

    if (!issueId) {
      log('warn', `Diff row missing issue ID`, { diffType, row });
      return;
    }

    // Detect status changes: if from_status and to_status differ, use 'status' type
    let finalMutationType = mutationType;
    if (diffType === 'modified' && row.from_status && row.to_status && row.from_status !== row.to_status) {
      finalMutationType = 'status';
    }

    const event = {
      Type: finalMutationType,
      IssueID: issueId,
      Title: diffType === 'removed' ? row.from_title : row.to_title,
      old_status: row.from_status || null,
      new_status: row.to_status || null,
      Timestamp: new Date().toISOString(),
      // Carry the full diff row for issue data extraction
      _diffRow: row,
      _diffType: diffType,
    };

    this.stats.mutations++;

    log('info', `Mutation detected`, {
      type: event.Type,
      issue: event.IssueID,
      title: event.Title?.substring(0, 60),
      oldStatus: event.old_status,
      newStatus: event.new_status,
    });

    // Debounce: if same issue mutates again within window, reset timer
    const existing = this.pendingIssues.get(event.IssueID);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      this.pendingIssues.delete(event.IssueID);
      this.syncIssueWithRetry(event).catch(err => {
        log('error', `Sync failed after all retries`, {
          issue: event.IssueID,
          error: err.message,
          attempts: SYNC_RETRY_ATTEMPTS,
        });
        this.stats.errors++;
      });
    }, DEBOUNCE_MS);

    this.pendingIssues.set(event.IssueID, { timer, mutation: event });
  }

  async syncIssueWithRetry(event) {
    let lastError;
    for (let attempt = 1; attempt <= SYNC_RETRY_ATTEMPTS; attempt++) {
      try {
        await this.syncIssue(event);
        return; // Success
      } catch (err) {
        lastError = err;
        if (attempt < SYNC_RETRY_ATTEMPTS) {
          const delay = SYNC_RETRY_BASE_MS * Math.pow(2, attempt - 1);
          log('warn', `Sync attempt ${attempt}/${SYNC_RETRY_ATTEMPTS} failed, retrying in ${delay}ms`, {
            issue: event.IssueID,
            error: err.message,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  async syncIssue(event) {
    let issue = null;

    // For non-delete mutations, build issue data from the diff row or fetch from Dolt
    if (event.Type !== 'delete') {
      const row = event._diffRow;

      if (row) {
        // Build issue from diff row's to_* columns (the new state)
        issue = {
          id: row.to_id,
          title: row.to_title,
          status: row.to_status,
          priority: row.to_priority ?? null,
          description: row.to_description ?? null,
          labels: [], // Labels are in a separate table; fetch if needed
        };
      }

      // If the diff row was sparse or we need full issue data including labels,
      // fall back to querying the issue directly
      if ((!issue || !issue.title) && this.doltService) {
        try {
          const fullIssue = await this.doltService.getIssueById(event.IssueID);
          if (fullIssue) {
            issue = {
              id: fullIssue.id,
              title: fullIssue.title,
              status: fullIssue.status,
              priority: fullIssue.priority,
              description: fullIssue.description,
              labels: fullIssue.labels || [],
            };
          }
        } catch (err) {
          if (err.message?.includes('not found')) {
            log('warn', `Issue not found (may be deleted)`, { issue: event.IssueID });
            return;
          }
          throw err;
        }
      }

      if (!issue) {
        log('warn', `Could not build issue data`, { issue: event.IssueID });
        return;
      }

      // Always try to enrich with labels from getIssueById if we built from diff row
      if (issue.labels.length === 0 && this.doltService) {
        try {
          const fullIssue = await this.doltService.getIssueById(event.IssueID);
          if (fullIssue?.labels?.length > 0) {
            issue.labels = fullIssue.labels;
          }
        } catch {
          // Non-critical; proceed without labels
        }
      }
    }

    const payload = {
      projectId: this.projectName,
      mutation: {
        type: event.Type,
        issueId: event.IssueID,
        title: event.Title,
        oldStatus: event.old_status || null,
        newStatus: event.new_status || null,
        timestamp: event.Timestamp,
      },
      // Full issue data (null for deletes)
      issue: issue
        ? {
            id: issue.id,
            title: issue.title,
            status: issue.status,
            priority: issue.priority,
            description: issue.description,
            labels: issue.labels || [],
          }
        : null,
    };

    log('info', `Triggering sync`, {
      project: this.projectName,
      issue: event.IssueID,
      type: event.Type,
      status: issue?.status,
    });

    const response = await fetch(SYNC_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`API returned ${response.status}: ${body}`);
    }

    const result = await response.json();
    this.stats.syncs++;

    log('info', `Sync triggered`, {
      issue: event.IssueID,
      workflowId: result.workflowId,
    });
  }

  getHealth() {
    return {
      workspace: this.projectName,
      running: this.running,
      connected: this.doltService?.pool != null,
      lastSeenCommit: this.lastSeenCommit?.substring(0, 12) || null,
      pending: this.pendingIssues.size,
      stats: { ...this.stats },
    };
  }

  async triggerReconciliation() {
    if (!this.running || !this.doltService) return;

    try {
      // Query all non-tombstone issues directly from Dolt
      const [rows] = await this.doltService.pool.execute(
        `SELECT i.*, GROUP_CONCAT(l.label) AS labels
         FROM issues i
         LEFT JOIN labels l ON i.id = l.issue_id
         WHERE i.status != 'tombstone'
         GROUP BY i.id
         ORDER BY i.updated_at DESC`
      );

      const issues = (rows || []).map(row => ({
        id: row.id,
        title: row.title,
        status: row.status,
        priority: row.priority,
        description: row.description,
        labels: row.labels ? row.labels.split(',') : [],
      }));

      if (issues.length === 0) return;

      const payload = {
        projectId: this.projectName,
        issues,
      };

      log('info', `Reconciliation: sending ${issues.length} issues`, {
        workspace: this.projectName,
      });

      const response = await fetch(RECONCILE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Reconcile API returned ${response.status}: ${body}`);
      }

      const result = await response.json();
      this.stats.reconciliations++;

      log('info', `Reconciliation complete`, {
        workspace: this.projectName,
        workflowId: result.workflowId,
        issueCount: issues.length,
      });
    } catch (err) {
      log('error', `Reconciliation failed`, {
        workspace: this.projectName,
        error: err.message,
      });
    }
  }
}

// ── Main Service ─────────────────────────────────────────────────

class DoltCommitWatcherService {
  constructor() {
    this.watchers = new Map(); // path -> WorkspaceWatcher
    this.shutdownRequested = false;
  }

  async start() {
    log('info', '=== Dolt Commit Watcher starting ===', {
      syncApi: SYNC_API,
      pollInterval: POLL_INTERVAL,
      debounce: DEBOUNCE_MS,
      reconcileInterval: RECONCILE_INTERVAL,
      watchRoot: WATCH_ROOT,
    });

    // Discover workspaces
    await this.discoverAndWatch();

    // Periodically re-discover workspaces and health check
    this.healthTimer = setInterval(() => {
      this.healthCheck();
    }, HEALTH_INTERVAL);

    this.discoveryTimer = setInterval(() => {
      this.discoverAndWatch().catch(err => {
        log('error', `Workspace discovery failed`, { error: err.message });
      });
    }, RECONNECT_INTERVAL);

    // Periodic reconciliation heartbeat
    this.reconcileTimer = setInterval(() => {
      this.runReconciliation().catch(err => {
        log('error', `Reconciliation cycle failed`, { error: err.message });
      });
    }, RECONCILE_INTERVAL);

    // Run initial reconciliation after a short delay to let watchers connect
    setTimeout(() => {
      this.runReconciliation().catch(err => {
        log('error', `Initial reconciliation failed`, { error: err.message });
      });
    }, 15000);

    // Handle graceful shutdown
    const shutdown = async signal => {
      if (this.shutdownRequested) return;
      this.shutdownRequested = true;
      log('info', `Shutting down (${signal})`);

      clearInterval(this.healthTimer);
      clearInterval(this.discoveryTimer);
      clearInterval(this.reconcileTimer);

      const stops = [];
      for (const watcher of this.watchers.values()) {
        stops.push(watcher.stop());
      }
      await Promise.allSettled(stops);

      log('info', '=== Dolt Commit Watcher stopped ===');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  async discoverAndWatch() {
    const discovered = discoverWorkspaces();

    for (const ws of discovered) {
      if (this.watchers.has(ws.path)) continue;

      const watcher = new WorkspaceWatcher(ws.path);
      try {
        await watcher.start();
        this.watchers.set(ws.path, watcher);
      } catch (err) {
        log('warn', `Skipping workspace`, { path: ws.path, error: err.message });
      }
    }

    // Remove watchers for dead workspaces (port file gone)
    const alivePaths = new Set(discovered.map(ws => ws.path));
    for (const [path, watcher] of this.watchers) {
      if (!alivePaths.has(path)) {
        log('info', `Removing dead workspace`, { path });
        await watcher.stop();
        this.watchers.delete(path);
      }
    }
  }

  healthCheck() {
    const healths = [];
    for (const watcher of this.watchers.values()) {
      healths.push(watcher.getHealth());
    }

    if (healths.length === 0) {
      log('warn', 'No active watchers');
      return;
    }

    const totalMutations = healths.reduce((s, h) => s + h.stats.mutations, 0);
    const totalSyncs = healths.reduce((s, h) => s + h.stats.syncs, 0);
    const totalErrors = healths.reduce((s, h) => s + h.stats.errors, 0);
    const totalPolls = healths.reduce((s, h) => s + h.stats.polls, 0);

    log('info', `Health check`, {
      workspaces: healths.length,
      totalMutations,
      totalSyncs,
      totalErrors,
      totalPolls,
      totalReconciliations: healths.reduce((s, h) => s + h.stats.reconciliations, 0),
    });
  }

  async runReconciliation() {
    log('info', `Starting reconciliation cycle`, { workspaces: this.watchers.size });

    for (const watcher of this.watchers.values()) {
      await watcher.triggerReconciliation();
    }

    log('info', `Reconciliation cycle complete`);
  }
}

// ── Exports (for testing) ────────────────────────────────────────

export { WorkspaceWatcher, DoltCommitWatcherService, discoverWorkspaces, DIFF_TYPE_MAP, log };

// ── Entry Point ──────────────────────────────────────────────────

const service = new DoltCommitWatcherService();
service.start().catch(err => {
  log('error', `Fatal error`, { error: err.message, stack: err.stack });
  process.exit(1);
});
