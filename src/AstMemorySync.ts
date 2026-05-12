import { logger } from './logger';
import { AstSummaryService } from './AstSummaryService.js';
import { AstBlockUpdater } from './AstBlockUpdater';

interface CodePerceptionWatcher {
  astCaches?: Map<string, { cache: Map<string, unknown> }>;
  stats?: { errors?: number };
  graphitiClients?: Map<string, unknown>;
}

interface Database {
  getProjectsWithFilesystemPath?: () => Array<{ identifier: string }>;
  getProject?: (id: string) => { letta_agent_id?: string | null } | null;
}

export class AstMemorySync {
  private watcher: CodePerceptionWatcher | null;
  private db: Database;
  private summary: AstSummaryService;
  private updater: AstBlockUpdater | null;
  private log: ReturnType<typeof logger.child>;

  constructor({ codePerceptionWatcher, lettaService, db }: {
    codePerceptionWatcher?: CodePerceptionWatcher | null;
    lettaService?: unknown;
    db: Database;
  }) {
    this.watcher = codePerceptionWatcher ?? null;
    this.db = db;
    this.summary = new AstSummaryService();
    this.updater = lettaService ? new AstBlockUpdater(lettaService as never) : null;
    this.log = logger.child({ service: 'AstMemorySync' });
  }

  async syncProjectAstToAgent(projectIdentifier: string): Promise<boolean> {
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

    const summaryData = this.summary.generateSummary(astCache as unknown as Parameters<typeof this.summary.generateSummary>[0], projectIdentifier, health as unknown as Parameters<typeof this.summary.generateSummary>[2]);
    if (!summaryData) return false;

    return this.updater.updateAgentBlock(agentId, summaryData);
  }

  async syncAllProjects(changeStats: Record<string, unknown> = {}): Promise<void> {
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

  private _getAgentIdForProject(projectIdentifier: string): string | null {
    try {
      const project = this.db.getProject?.(projectIdentifier);
      return project?.letta_agent_id || null;
    } catch {
      return null;
    }
  }

  recordFileChange(projectId: string, filePath: string, changeType: string, functionsDelta: number = 0): void {
    this.summary.recordChange(projectId, filePath, changeType, functionsDelta);
  }
}

export function createAstMemorySync(options: {
  codePerceptionWatcher?: CodePerceptionWatcher | null;
  lettaService?: unknown;
  db: Database;
}): AstMemorySync {
  return new AstMemorySync(options);
}

export default AstMemorySync;
