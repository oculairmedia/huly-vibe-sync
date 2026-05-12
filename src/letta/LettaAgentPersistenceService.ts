import fs from 'node:fs';
import path from 'node:path';
import { agentsMdGenerator } from '../AgentsMdGenerator.js';
import type { LettaConfig } from './LettaConfig';

interface AgentState {
  version: string;
  description: string;
  agents: Record<string, string>;
}

interface ProjectInfo {
  identifier: string;
  name: string;
}

export class LettaAgentPersistenceService {
  private lettaDir: string;
  private settingsPath: string;
  private _agentState: AgentState;

  constructor(config: LettaConfig) {
    this.lettaDir = config.lettaDir;
    this.settingsPath = config.settingsPath;
    this._agentState = this._loadAgentState();
  }

  private _loadAgentState(): AgentState {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        const state = JSON.parse(data) as AgentState;
        console.log(
          `[Letta] Loaded agent state for ${Object.keys(state.agents || {}).length} projects`,
        );
        return state;
      }
    } catch (error) {
      console.error(`[Letta] Error loading agent state:`, (error as Error).message);
    }

    return {
      version: '1.0.0',
      description: 'Local Letta agent persistence (gitignored, personal to this instance)',
      agents: {},
    };
  }

  private _saveAgentState(): void {
    try {
      if (!fs.existsSync(this.lettaDir)) {
        fs.mkdirSync(this.lettaDir, { recursive: true });
      }

      fs.writeFileSync(this.settingsPath, JSON.stringify(this._agentState, null, 2), 'utf8');
      console.log(
        `[Letta] Saved agent state for ${Object.keys(this._agentState.agents || {}).length} projects`,
      );
    } catch (error) {
      console.error(`[Letta] Error saving agent state:`, (error as Error).message);
    }
  }

  getPersistedAgentId(projectIdentifier: string): string | null {
    return this._agentState.agents[projectIdentifier] || null;
  }

  saveAgentId(projectIdentifier: string, agentId: string): void {
    this._agentState.agents[projectIdentifier] = agentId;
    this._saveAgentState();
    console.log(`[Letta] Persisted agent ID for ${projectIdentifier}: ${agentId}`);
  }

  saveAgentIdToProjectFolder(projectPath: string, agentId: string, projectInfo: ProjectInfo | null = null): void {
    const lettaDir = path.join(projectPath, '.letta');
    const settingsPath = path.join(lettaDir, 'settings.local.json');

    try {
      if (!fs.existsSync(lettaDir)) {
        fs.mkdirSync(lettaDir, { recursive: true });
        console.log(`[Letta] Created .letta directory: ${lettaDir}`);
      }

      const settings = { lastAgent: agentId };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log(`[Letta] ✓ Saved agent ID to project: ${settingsPath}`);

      const gitignorePath = path.join(lettaDir, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(
          gitignorePath,
          '# Local agent state\nsettings.local.json\n*.log\n',
          'utf8',
        );
      }

      if (projectInfo) {
        this.updateAgentsMdWithProjectInfo(projectPath, agentId, projectInfo);
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EACCES') {
        console.warn(`[Letta] ⚠️  Permission denied writing to ${settingsPath}`);
        console.warn(
          `[Letta] Agent state is still tracked in main database. Ensure directory is owned by UID 1000.`,
        );
      } else {
        console.error(`[Letta] Error saving agent ID to project folder:`, err.message);
      }
    }
  }

  private updateAgentsMdWithProjectInfo(projectPath: string, agentId: string, projectInfo: ProjectInfo): void {
    try {
      const agentsMdPath = path.join(projectPath, 'AGENTS.md');
      const agentName = `PM - ${projectInfo.name}`;

      const vars = {
        identifier: projectInfo.identifier,
        name: projectInfo.name,
        agentId,
        agentName,
        projectPath,
      };

      const { changes } = agentsMdGenerator.generate(agentsMdPath, vars, {
        sections: ['project-info', 'reporting-hierarchy', 'beads-instructions', 'session-completion'],
      });

      console.log(
        `[Letta] ✓ Updated AGENTS.md: ${changes.map((c: { section: string; action: string }) => `${c.section}:${c.action}`).join(', ')}`,
      );
    } catch (error) {
      console.warn(`[Letta] ⚠️  Could not update AGENTS.md: ${(error as Error).message}`);
    }
  }
}
