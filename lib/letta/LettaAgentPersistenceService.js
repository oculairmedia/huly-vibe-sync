/**
 * LettaAgentPersistenceService — local state persistence for agent IDs.
 */

import fs from 'fs';
import path from 'path';
import { agentsMdGenerator } from '../AgentsMdGenerator.js';

export class LettaAgentPersistenceService {
  constructor(config) {
    this.config = config;
    this.lettaDir = config.lettaDir;
    this.settingsPath = config.settingsPath;
    this._agentState = this._loadAgentState();
  }

  _loadAgentState() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        const state = JSON.parse(data);
        console.log(
          `[Letta] Loaded agent state for ${Object.keys(state.agents || {}).length} projects`
        );
        return state;
      }
    } catch (error) {
      console.error(`[Letta] Error loading agent state:`, error.message);
    }

    return {
      version: '1.0.0',
      description: 'Local Letta agent persistence (gitignored, personal to this instance)',
      agents: {},
    };
  }

  _saveAgentState() {
    try {
      if (!fs.existsSync(this.lettaDir)) {
        fs.mkdirSync(this.lettaDir, { recursive: true });
      }

      fs.writeFileSync(this.settingsPath, JSON.stringify(this._agentState, null, 2), 'utf8');
      console.log(
        `[Letta] Saved agent state for ${Object.keys(this._agentState.agents || {}).length} projects`
      );
    } catch (error) {
      console.error(`[Letta] Error saving agent state:`, error.message);
    }
  }

  getPersistedAgentId(projectIdentifier) {
    return this._agentState.agents[projectIdentifier] || null;
  }

  saveAgentId(projectIdentifier, agentId) {
    this._agentState.agents[projectIdentifier] = agentId;
    this._saveAgentState();
    console.log(`[Letta] Persisted agent ID for ${projectIdentifier}: ${agentId}`);
  }

  saveAgentIdToProjectFolder(projectPath, agentId, projectInfo = null) {
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
          'utf8'
        );
      }

      if (projectInfo) {
        this.updateAgentsMdWithProjectInfo(projectPath, agentId, projectInfo);
      }
    } catch (error) {
      if (error.code === 'EACCES') {
        console.warn(`[Letta] ⚠️  Permission denied writing to ${settingsPath}`);
        console.warn(
          `[Letta] Agent state is still tracked in main database. Ensure directory is owned by UID 1000.`
        );
      } else {
        console.error(`[Letta] Error saving agent ID to project folder:`, error.message);
      }
    }
  }

  updateAgentsMdWithProjectInfo(projectPath, agentId, projectInfo) {
    try {
      const agentsMdPath = path.join(projectPath, 'AGENTS.md');
      const agentName = `Huly - ${projectInfo.name}`;

      const vars = {
        identifier: projectInfo.identifier,
        name: projectInfo.name,
        agentId,
        agentName,
        projectPath,
      };

      const { changes } = agentsMdGenerator.generate(agentsMdPath, vars, {
        sections: [
          'project-info',
          'reporting-hierarchy',
          'beads-instructions',
          'session-completion',
        ],
      });

      console.log(
        `[Letta] ✓ Updated AGENTS.md: ${changes.map(c => `${c.section}:${c.action}`).join(', ')}`
      );
    } catch (error) {
      console.warn(`[Letta] ⚠️  Could not update AGENTS.md: ${error.message}`);
    }
  }
}
