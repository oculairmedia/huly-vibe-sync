#!/usr/bin/env node

/**
 * Beads Mutation Watcher
 *
 * Replaces the bash inotifywait-based beads-watcher.sh with a direct
 * daemon connection via the beads SDK. Polls for mutation events and
 * triggers targeted single-issue syncs instead of full-project syncs.
 *
 * Chain: bd create/close -> SQLite -> daemon get_mutations -> this watcher -> POST /api/beads/mutation -> Temporal workflow
 *
 * This completely bypasses the broken JSONL export chain (bd-7hpi).
 */

import { BeadsClient, watchMutations, getAliveWorkspaces } from '@herbcaudill/beads-sdk';
import { basename } from 'node:path';

// ── Configuration ────────────────────────────────────────────────

const SYNC_API = process.env.BEADS_SYNC_API || 'http://localhost:3099/api/beads/mutation';
const POLL_INTERVAL = parseInt(process.env.BEADS_POLL_INTERVAL || '2000', 10);
const DEBOUNCE_MS = parseInt(process.env.BEADS_DEBOUNCE_MS || '3000', 10);
const HEALTH_INTERVAL = parseInt(process.env.BEADS_HEALTH_INTERVAL || '30000', 10);
const RECONNECT_INTERVAL = parseInt(process.env.BEADS_RECONNECT_INTERVAL || '10000', 10);

// Mutation types that should trigger a sync
const SYNCABLE_MUTATIONS = new Set(['create', 'update', 'status', 'delete']);

// ── Logging ──────────────────────────────────────────────────────

function log(level, msg, data = {}) {
  const ts = new Date().toISOString();
  const extra = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}${extra}`);
}

// ── Per-Workspace Watcher ────────────────────────────────────────

class WorkspaceWatcher {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.projectName = basename(workspacePath);
    this.client = null;
    this.stopMutationWatch = null;
    this.pendingIssues = new Map(); // issueId -> { timer, mutation }
    this.running = false;
    this.stats = { mutations: 0, syncs: 0, errors: 0 };
  }

  async start() {
    if (this.running) return;
    this.running = true;

    try {
      // Connect a BeadsClient for fetching full issue details
      this.client = new BeadsClient({ actor: 'mutation-watcher', requestTimeout: 10000 });
      await this.client.connect(this.workspacePath);
      log('info', `Connected to daemon`, { workspace: this.projectName });

      // Start watching mutations
      this.stopMutationWatch = watchMutations(event => this.handleMutation(event), {
        workspacePath: this.workspacePath,
        interval: POLL_INTERVAL,
      });

      log('info', `Watching for mutations`, {
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

    // Clear pending debounce timers
    for (const [, { timer }] of this.pendingIssues) {
      clearTimeout(timer);
    }
    this.pendingIssues.clear();

    // Stop mutation watcher
    if (this.stopMutationWatch) {
      this.stopMutationWatch();
      this.stopMutationWatch = null;
    }

    // Disconnect client
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    log('info', `Stopped watcher`, { workspace: this.projectName, stats: this.stats });
  }

  handleMutation(event) {
    this.stats.mutations++;

    if (!SYNCABLE_MUTATIONS.has(event.Type)) {
      log('debug', `Ignoring mutation type`, {
        type: event.Type,
        issue: event.IssueID,
      });
      return;
    }

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
      this.syncIssue(event).catch(err => {
        log('error', `Sync failed`, { issue: event.IssueID, error: err.message });
        this.stats.errors++;
      });
    }, DEBOUNCE_MS);

    this.pendingIssues.set(event.IssueID, { timer, mutation: event });
  }

  async syncIssue(event) {
    let issue = null;

    // For non-delete mutations, fetch full issue details from daemon
    if (event.Type !== 'delete') {
      try {
        issue = await this.client.show(event.IssueID);
      } catch (err) {
        // Issue might have been deleted between mutation and fetch
        if (err.message?.includes('not found')) {
          log('warn', `Issue not found (may be deleted)`, { issue: event.IssueID });
          return;
        }
        throw err;
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
      connected: this.client?.isConnected() ?? false,
      pending: this.pendingIssues.size,
      stats: { ...this.stats },
    };
  }
}

// ── Main Service ─────────────────────────────────────────────────

class BeadsMutationService {
  constructor() {
    this.watchers = new Map(); // path -> WorkspaceWatcher
    this.shutdownRequested = false;
  }

  async start() {
    log('info', '=== Beads Mutation Watcher starting ===', {
      syncApi: SYNC_API,
      pollInterval: POLL_INTERVAL,
      debounce: DEBOUNCE_MS,
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

    // Handle graceful shutdown
    const shutdown = async signal => {
      if (this.shutdownRequested) return;
      this.shutdownRequested = true;
      log('info', `Shutting down (${signal})`);

      clearInterval(this.healthTimer);
      clearInterval(this.discoveryTimer);

      const stops = [];
      for (const watcher of this.watchers.values()) {
        stops.push(watcher.stop());
      }
      await Promise.allSettled(stops);

      log('info', '=== Beads Mutation Watcher stopped ===');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  async discoverAndWatch() {
    const alive = getAliveWorkspaces();

    for (const ws of alive) {
      if (this.watchers.has(ws.path)) continue;

      const watcher = new WorkspaceWatcher(ws.path);
      try {
        await watcher.start();
        this.watchers.set(ws.path, watcher);
      } catch (err) {
        log('warn', `Skipping workspace`, { path: ws.path, error: err.message });
      }
    }

    // Remove watchers for dead workspaces
    const alivePaths = new Set(alive.map(ws => ws.path));
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

    log('info', `Health check`, {
      workspaces: healths.length,
      totalMutations,
      totalSyncs,
      totalErrors,
    });
  }
}

// ── Entry Point ──────────────────────────────────────────────────

const service = new BeadsMutationService();
service.start().catch(err => {
  log('error', `Fatal error`, { error: err.message, stack: err.stack });
  process.exit(1);
});
