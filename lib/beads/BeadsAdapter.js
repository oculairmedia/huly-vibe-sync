import { execSync } from 'child_process';
import path from 'path';

/**
 * BeadsAdapter: TypeScript/Node.js wrapper for Beads CLI commands
 * 
 * Provides safe, idempotent access to Beads issue tracking with:
 * - LRU cache with TTL and max entry bounds
 * - Atomic claim operations
 * - Idempotency guards for non-idempotent operations
 * - Conflict handling and retry logic
 * - Audit trail via BEADS_ACTOR environment variable
 */
export class BeadsAdapter {
  constructor(options = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000; // 1 minute default
    this.cacheMaxEntries = options.cacheMaxEntries ?? 100;
    this.runCommand = options.runCommand ?? this._defaultRunCommand.bind(this);
    this.beadsDb = options.beadsDb ?? process.env.BEADS_DB ?? '.beads';
    this.actor = options.actor ?? process.env.BEADS_ACTOR ?? process.env.USER ?? 'unknown';
    this.readonly = options.readonly ?? process.env.BEADS_READONLY === '1';
    
    // LRU cache: Map<key, { value, timestamp, insertOrder }>
    this.cache = new Map();
    this.insertOrder = 0;
  }

  /**
   * Default command runner: executes bd CLI with --json flag
   */
  _defaultRunCommand(command, args = []) {
    const cmd = `bd ${command} ${args.join(' ')} --json`;
    try {
      const output = execSync(cmd, {
        encoding: 'utf-8',
        env: {
          ...process.env,
          BEADS_DB: this.beadsDb,
          BEADS_ACTOR: this.actor,
          BEADS_READONLY: this.readonly ? '1' : '0',
        },
      });
      return JSON.parse(output);
    } catch (error) {
      throw new Error(`Beads command failed: ${cmd}\n${error.message}`);
    }
  }

  /**
   * Cache management: set with TTL and LRU eviction
   */
  setCache(key, value) {
    // Proactively evict expired entries
    this._evictExpired();

    // Evict oldest entry if at capacity
    if (this.cache.size >= this.cacheMaxEntries && !this.cache.has(key)) {
      let oldestKey = null;
      let oldestOrder = Infinity;
      for (const [k, v] of this.cache.entries()) {
        if (v.insertOrder < oldestOrder) {
          oldestOrder = v.insertOrder;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      insertOrder: this.insertOrder++,
    });
  }

  /**
   * Cache management: get with TTL check
   */
  getCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > this.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Cache management: evict all expired entries
   */
  _evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.cacheTtlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Query: Get ready work (unblocked, actionable issues)
   * Fully idempotent, safe to retry
   */
  async getReadyWork(project, options = {}) {
    const cacheKey = `${project.identifier}:ready-work`;
    
    if (!options.forceRefresh) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    const args = [];
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('ready', args);
    const normalized = this._normalizeWorkItems(result);
    
    this.setCache(cacheKey, normalized);
    return normalized;
  }

  /**
   * Query: Get issue by ID
   * Fully idempotent, safe to retry
   */
  async getIssue(issueId, project, options = {}) {
    const cacheKey = `${project.identifier}:issue:${issueId}`;
    
    if (!options.forceRefresh) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    const args = [issueId];
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('show', args);
    const normalized = this._normalizeIssue(result);
    
    this.setCache(cacheKey, normalized);
    return normalized;
  }

  /**
   * Query: List issues with optional filters
   * Fully idempotent, safe to retry
   */
  async listIssues(project, filters = {}, options = {}) {
    const cacheKey = `${project.identifier}:issues:${JSON.stringify(filters)}`;
    
    if (!options.forceRefresh) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    const args = [];
    if (filters.status) args.push(`--status=${filters.status}`);
    if (filters.priority) args.push(`--priority=${filters.priority}`);
    if (filters.type) args.push(`--type=${filters.type}`);
    if (filters.assignee) args.push(`--assignee=${filters.assignee}`);
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('list', args);
    const normalized = Array.isArray(result) 
      ? result.map(item => this._normalizeIssue(item))
      : result.items?.map(item => this._normalizeIssue(item)) || [];
    
    const response = { items: normalized };
    this.setCache(cacheKey, response);
    return response;
  }

  /**
   * Query: Get project work items (combines ready + list)
   * Used by tests; fully idempotent
   */
  async getProjectWorkItems(project, options = {}) {
    const cacheKey = `${project.identifier}:work-items`;
    
    if (!options.forceRefresh) {
      const cached = this.getCache(cacheKey);
      if (cached) {
        // Apply filters to cached data
        if (options.status) {
          return {
            items: cached.items.filter(item => item.status === options.status),
          };
        }
        return cached;
      }
    }

    const result = await this.listIssues(project, {}, { forceRefresh: true });
    
    this.setCache(cacheKey, result);
    
    // Apply filters to result
    if (options.status) {
      return {
        items: result.items.filter(item => item.status === options.status),
      };
    }
    
    return result;
  }

  /**
   * Mutation: Create new issue
   * NOT idempotent: creates new ID each time
   * Must check for duplicates before calling
   */
  async createIssue(project, title, options = {}) {
    if (this.readonly) {
      throw new Error('Cannot create issue in readonly mode');
    }

    // Idempotency guard: check if issue with same title exists
    if (options.checkDuplicate) {
      const existing = await this.listIssues(project, {});
      if (existing.items.some(item => item.title === title)) {
        throw new Error(`Issue with title "${title}" already exists`);
      }
    }

    const args = [`"${title}"`];
    if (options.description) args.push(`--description="${options.description}"`);
    if (options.priority) args.push(`--priority=${options.priority}`);
    if (options.type) args.push(`--type=${options.type}`);
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('create', args);
    const normalized = this._normalizeIssue(result);
    
    // Invalidate list cache
    this._invalidateCachePattern(`${project.identifier}:issues`);
    this._invalidateCachePattern(`${project.identifier}:ready-work`);
    
    return normalized;
  }

  /**
   * Mutation: Update issue fields
   * Mostly idempotent for setter fields (status, priority, assignee)
   * NOT idempotent for appenders (--append-notes, --add-label)
   */
  async updateIssue(issueId, project, updates = {}, options = {}) {
    if (this.readonly) {
      throw new Error('Cannot update issue in readonly mode');
    }

    const args = [issueId];
    
    // Setter fields (idempotent)
    if (updates.status !== undefined) args.push(`--status=${updates.status}`);
    if (updates.priority !== undefined) args.push(`--priority=${updates.priority}`);
    if (updates.type !== undefined) args.push(`--type=${updates.type}`);
    if (updates.title !== undefined) args.push(`--title="${updates.title}"`);
    if (updates.description !== undefined) args.push(`--description="${updates.description}"`);
    
    // Appender fields (NOT idempotent - must check first)
    if (updates.labels && !options.skipIdempotencyCheck) {
      const current = await this.getIssue(issueId, project);
      const newLabels = updates.labels.filter(l => !current.labels?.includes(l));
      if (newLabels.length > 0) {
        args.push(`--add-label=${newLabels.join(',')}`);
      }
    } else if (updates.labels) {
      args.push(`--add-label=${updates.labels.join(',')}`);
    }

    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('update', args);
    const normalized = this._normalizeIssue(result);
    
    // Invalidate caches
    this._invalidateCachePattern(`${project.identifier}:issue:${issueId}`);
    this._invalidateCachePattern(`${project.identifier}:issues`);
    this._invalidateCachePattern(`${project.identifier}:ready-work`);
    
    return normalized;
  }

  /**
   * Mutation: Claim issue (atomic, safe for concurrent claims)
   * Idempotent: fails if already claimed by someone else
   */
  async claimIssue(issueId, project, actor = null) {
    if (this.readonly) {
      throw new Error('Cannot claim issue in readonly mode');
    }

    const claimActor = actor ?? this.actor;
    const args = [issueId, `--claim=${claimActor}`];
    
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    try {
      const result = await this.runCommand('update', args);
      const normalized = this._normalizeIssue(result);
      
      // Invalidate caches
      this._invalidateCachePattern(`${project.identifier}:issue:${issueId}`);
      this._invalidateCachePattern(`${project.identifier}:ready-work`);
      
      return normalized;
    } catch (error) {
      if (error.message.includes('already claimed')) {
        throw new Error(`Issue ${issueId} is already claimed by another user`);
      }
      throw error;
    }
  }

  /**
   * Mutation: Close issue
   * Idempotent: closing an already-closed issue succeeds
   */
  async closeIssue(issueId, project, options = {}) {
    if (this.readonly) {
      throw new Error('Cannot close issue in readonly mode');
    }

    const args = [issueId];
    if (options.reason) args.push(`--reason="${options.reason}"`);
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('close', args);
    const normalized = this._normalizeIssue(result);
    
    // Invalidate caches
    this._invalidateCachePattern(`${project.identifier}:issue:${issueId}`);
    this._invalidateCachePattern(`${project.identifier}:ready-work`);
    
    return normalized;
  }

  /**
   * Mutation: Reopen issue
   * Idempotent: reopening an already-open issue succeeds
   */
  async reopenIssue(issueId, project) {
    if (this.readonly) {
      throw new Error('Cannot reopen issue in readonly mode');
    }

    const args = [issueId];
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('reopen', args);
    const normalized = this._normalizeIssue(result);
    
    // Invalidate caches
    this._invalidateCachePattern(`${project.identifier}:issue:${issueId}`);
    this._invalidateCachePattern(`${project.identifier}:ready-work`);
    
    return normalized;
  }

  /**
   * Mutation: Add note to issue
   * NOT idempotent: appends each time
   * Must check for duplicate notes before calling
   */
  async addNote(issueId, project, text, options = {}) {
    if (this.readonly) {
      throw new Error('Cannot add note in readonly mode');
    }

    // Idempotency guard: check if note already exists
    if (options.checkDuplicate) {
      const issue = await this.getIssue(issueId, project);
      if (issue.notes?.some(n => n.text === text)) {
        throw new Error(`Note with text "${text}" already exists on issue ${issueId}`);
      }
    }

    const args = [issueId, `"${text}"`];
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('note', args);
    const normalized = this._normalizeIssue(result);
    
    // Invalidate cache
    this._invalidateCachePattern(`${project.identifier}:issue:${issueId}`);
    
    return normalized;
  }

  /**
   * Mutation: Add comment to issue
   * NOT idempotent: appends each time
   * Must check for duplicate comments before calling
   */
  async addComment(issueId, project, text, options = {}) {
    if (this.readonly) {
      throw new Error('Cannot add comment in readonly mode');
    }

    // Idempotency guard: check if comment already exists
    if (options.checkDuplicate) {
      const issue = await this.getIssue(issueId, project);
      if (issue.comments?.some(c => c.text === text)) {
        throw new Error(`Comment with text "${text}" already exists on issue ${issueId}`);
      }
    }

    const args = [issueId, 'add', `"${text}"`];
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('comments', args);
    const normalized = this._normalizeIssue(result);
    
    // Invalidate cache
    this._invalidateCachePattern(`${project.identifier}:issue:${issueId}`);
    
    return normalized;
  }

  /**
   * Query: Get issue dependencies
   * Fully idempotent, safe to retry
   */
  async getDependencies(issueId, project, options = {}) {
    const cacheKey = `${project.identifier}:deps:${issueId}`;
    
    if (!options.forceRefresh) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    const args = [issueId, 'list'];
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('dep', args);
    const normalized = Array.isArray(result) ? result : result.dependencies || [];
    
    this.setCache(cacheKey, normalized);
    return normalized;
  }

  /**
   * Mutation: Add dependency
   * Idempotent: adding an existing dependency succeeds
   */
  async addDependency(issueId, dependsOnId, project, type = 'blocks') {
    if (this.readonly) {
      throw new Error('Cannot add dependency in readonly mode');
    }

    const args = [issueId, 'add', dependsOnId, `--type=${type}`];
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('dep', args);
    
    // Invalidate caches
    this._invalidateCachePattern(`${project.identifier}:deps:${issueId}`);
    this._invalidateCachePattern(`${project.identifier}:ready-work`);
    
    return result;
  }

  /**
   * Mutation: Remove dependency
   * Idempotent: removing a non-existent dependency succeeds
   */
  async removeDependency(issueId, dependsOnId, project) {
    if (this.readonly) {
      throw new Error('Cannot remove dependency in readonly mode');
    }

    const args = [issueId, 'remove', dependsOnId];
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('dep', args);
    
    // Invalidate caches
    this._invalidateCachePattern(`${project.identifier}:deps:${issueId}`);
    this._invalidateCachePattern(`${project.identifier}:ready-work`);
    
    return result;
  }

  /**
   * Query: Check for circular dependencies
   * Fully idempotent, safe to retry
   */
  async checkCycles(project, options = {}) {
    const cacheKey = `${project.identifier}:cycles`;
    
    if (!options.forceRefresh) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    const args = [];
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('dep', ['cycles', ...args]);
    const normalized = Array.isArray(result) ? result : result.cycles || [];
    
    this.setCache(cacheKey, normalized);
    return normalized;
  }

  /**
   * Query: Get dependency graph
   * Fully idempotent, safe to retry
   */
  async getGraph(issueId, project, options = {}) {
    const cacheKey = `${project.identifier}:graph:${issueId}`;
    
    if (!options.forceRefresh) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    const args = [issueId];
    if (project.filesystem_path) {
      args.push(`--db=${project.filesystem_path}/.beads`);
    }

    const result = await this.runCommand('graph', args);
    
    this.setCache(cacheKey, result);
    return result;
  }

  /**
   * Normalization: Convert Beads issue to standard format
   */
  _normalizeIssue(issue) {
    const dependencies = Array.isArray(issue.dependencies) ? issue.dependencies : [];
    const blockedBy = dependencies
      .filter((dependency) => ['blocks', 'blocked_by', 'depends_on'].includes(dependency.type))
      .map((dependency) => dependency.depends_on_id)
      .filter(Boolean);
    const parentDependency = dependencies.find((dependency) =>
      ['parent', 'parent-child', 'parent_child'].includes(dependency.type),
    );

    return {
      id: issue.id,
      identifier: issue.identifier || issue.id,
      title: issue.title,
      status: issue.status || 'todo',
      priority: issue.priority || 'P3',
      type: issue.issue_type || issue.type || 'task',
      issue_type: issue.issue_type || issue.type || 'task',
      description: issue.description || '',
      assignee: issue.assignee || issue.owner || null,
      labels: issue.labels || [],
      notes: issue.notes || [],
      comments: issue.comments || [],
      blockedBy,
      blocked_by: blockedBy,
      blocks: issue.blocks || [],
      parent_huly_id: issue.parent_huly_id || issue.parent || parentDependency?.depends_on_id || null,
      parent_vibe_id: issue.parent_vibe_id || null,
      sub_issue_count: issue.sub_issue_count || issue.dependent_count || 0,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      closedAt: issue.closed_at,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      closed_at: issue.closed_at,
      acceptance_criteria: issue.acceptance_criteria,
      dependency_count: issue.dependency_count,
      dependent_count: issue.dependent_count,
      comment_count: issue.comment_count,
    };
  }

  /**
   * Normalization: Convert Beads work items to standard format
   */
  _normalizeWorkItems(items) {
    return {
      items: (Array.isArray(items) ? items : items.items || []).map(item =>
        this._normalizeIssue(item)
      ),
    };
  }

  /**
   * Cache invalidation: Remove all entries matching pattern
   */
  _invalidateCachePattern(pattern) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
      }
    }
  }
}
