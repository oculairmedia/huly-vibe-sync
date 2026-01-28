/**
 * AstMemorySync - Coordinates AST summary generation and PM agent block updates
 */

import { logger } from './logger.js';
import { AstSummaryService } from './AstSummaryService.js';
import { AstBlockUpdater } from './AstBlockUpdater.js';

export class AstMemorySync {
  constructor({ codePerceptionWatcher, lettaService, db }) {
    this.watcher = codePerceptionWatcher;
    this.db = db;
    this.summary = new AstSummaryService();
    this.updater = lettaService ? new AstBlockUpdater(lettaService) : null;
    this.log = logger.child({ service: 'AstMemorySync' });
  }

  async syncProjectAstToAgent(projectIdentifier) {
    if (!this.watcher || !this.updater) return false;

    const astCache = this.watcher.astCaches?.get(projectIdentifier);
    if (!astCache) {
      this.log.debug({ project: projectIdentifier }, 'No AST cache for project');
      return false;
    }

    const agentId = this._getAgentIdForProject(projectIdentifier);
    if (!agentId) {
      this.log.debug({ project: projectIdentifier }, 'No PM agent for project');
      return false;
    }

    const health = {
      syncStatus: 'green',
      errors24h: this.watcher.stats?.errors || 0,
      graphitiConnected: this.watcher.graphitiClients?.has(projectIdentifier) || false,
    };

    const summaryData = this.summary.generateSummary(astCache, projectIdentifier, health);
    if (!summaryData) return false;

    return this.updater.updateAgentBlock(agentId, summaryData);
  }

  async syncAllProjects(changeStats = {}) {
    if (!this.watcher || !this.updater) return;

    const projects = this.db.getProjectsWithFilesystemPath?.() || [];
    let updated = 0;

    for (const { identifier } of projects) {
      if (!this.summary.shouldPush(identifier, changeStats)) continue;

      const success = await this.syncProjectAstToAgent(identifier);
      if (success) {
        this.summary.markPushed(identifier);
        updated++;
      }
    }

    if (updated > 0) {
      this.log.info({ updated, total: projects.length }, 'AST memory sync completed');
    }
  }

  _getAgentIdForProject(projectIdentifier) {
    try {
      const project = this.db.getProject?.(projectIdentifier);
      return project?.letta_agent_id || null;
    } catch {
      return null;
    }
  }

  recordFileChange(projectId, filePath, changeType, functionsDelta = 0) {
    this.summary.recordChange(projectId, filePath, changeType, functionsDelta);
  }
}

export function createAstMemorySync(options) {
  return new AstMemorySync(options);
}

export default AstMemorySync;
