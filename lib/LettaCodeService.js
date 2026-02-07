/**
 * Letta Code Service
 *
 * Orchestrates Letta Code CLI for filesystem-based agent operations.
 * Enables project-specific agents to have filesystem access via the Letta Code harness.
 *
 * Key Commands Used:
 * - letta --agent <id> --link     → Attach filesystem tools to agent (one-time per project)
 * - letta -p "<prompt>" --agent <id> → Run headless task for agent in project directory
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { determineGitRepoPath } from './textParsers.js';

/**
 * Session state for an active Letta Code agent
 */
class LettaCodeSession {
  constructor(agentId, projectDir, agentName = null) {
    this.agentId = agentId;
    this.projectDir = projectDir;
    this.agentName = agentName;
    this.linked = false;
    this.lastActivity = Date.now();
    this.taskCount = 0;
  }

  toJSON() {
    return {
      agentId: this.agentId,
      projectDir: this.projectDir,
      agentName: this.agentName,
      linked: this.linked,
      lastActivity: new Date(this.lastActivity).toISOString(),
      taskCount: this.taskCount,
    };
  }
}

/**
 * LettaCodeService - Manages Letta Code sessions for project agents
 */
export class LettaCodeService {
  constructor(options = {}) {
    // Letta API configuration (for checking agent status)
    this.lettaBaseUrl = options.lettaBaseUrl || process.env.LETTA_BASE_URL || 'http://localhost:8283';
    this.lettaApiKey = options.lettaApiKey || process.env.LETTA_API_KEY || process.env.LETTA_PASSWORD;

    // Default project root (where most projects live)
    this.projectRoot = options.projectRoot || process.env.PROJECT_ROOT || '/opt/stacks';

    // Active sessions: agentId -> LettaCodeSession
    this.sessions = new Map();

    // Persistence path for session state
    this.stateDir = options.stateDir || path.join(process.cwd(), '.letta-code');
    this.statePath = path.join(this.stateDir, 'sessions.json');

    // Load persisted sessions
    this._loadState();

    logger.info({
      service: 'LettaCodeService',
      lettaBaseUrl: this.lettaBaseUrl,
      projectRoot: this.projectRoot,
    }, 'LettaCodeService initialized');
  }

  /**
   * Load persisted session state
   */
  _loadState() {
    try {
      if (fs.existsSync(this.statePath)) {
        const data = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
        for (const [agentId, sessionData] of Object.entries(data.sessions || {})) {
          const session = new LettaCodeSession(
            sessionData.agentId,
            sessionData.projectDir,
            sessionData.agentName,
          );
          session.linked = sessionData.linked;
          session.lastActivity = new Date(sessionData.lastActivity).getTime();
          session.taskCount = sessionData.taskCount || 0;
          this.sessions.set(agentId, session);
        }
        logger.info({ sessionCount: this.sessions.size }, 'Loaded persisted Letta Code sessions');
      }
    } catch (error) {
      logger.warn({ err: error }, 'Failed to load Letta Code session state');
    }
  }

  /**
   * Persist session state
   */
  _saveState() {
    try {
      if (!fs.existsSync(this.stateDir)) {
        fs.mkdirSync(this.stateDir, { recursive: true });
      }

      const data = {
        updatedAt: new Date().toISOString(),
        sessions: Object.fromEntries(
          Array.from(this.sessions.entries()).map(([k, v]) => [k, v.toJSON()]),
        ),
      };

      fs.writeFileSync(this.statePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error({ err: error }, 'Failed to persist Letta Code session state');
    }
  }

  _getExistingLinkInfo(projectDir) {
    try {
      const lettaDir = path.join(projectDir, '.letta');
      const settingsPath = path.join(lettaDir, 'settings.local.json');
      if (!fs.existsSync(settingsPath)) {
        return null;
      }
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const linkedAgentId = data.agentId || data.lastAgent || data.agent?.id || null;
      const linkedAgentName = data.agentName || data.lastAgentName || data.agent?.name || data.name || null;
      return {
        lettaDir,
        settingsPath,
        linkedAgentId,
        linkedAgentName,
      };
    } catch (error) {
      logger.warn({ err: error, projectDir }, 'Failed to read existing Letta Code link settings');
      return null;
    }
  }

  /**
   * Check if Letta Code CLI is available
   */
  async checkLettaCodeAvailable() {
    try {
      execSync('which letta', { encoding: 'utf8', stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get or create a session for an agent in a project directory
   *
   * @param {string} agentId - Letta agent ID
   * @param {string} projectDir - Project directory path
   * @param {string} [agentName] - Optional agent name for logging
   * @returns {LettaCodeSession}
   */
  getOrCreateSession(agentId, projectDir, agentName = null) {
    let session = this.sessions.get(agentId);

    if (!session) {
      session = new LettaCodeSession(agentId, projectDir, agentName);
      this.sessions.set(agentId, session);
      this._saveState();
      logger.info({ agentId, projectDir, agentName }, 'Created new Letta Code session');
    } else if (session.projectDir !== projectDir) {
      // Agent moved to different project
      logger.info({
        agentId,
        oldDir: session.projectDir,
        newDir: projectDir,
      }, 'Updating session project directory');
      session.projectDir = projectDir;
      session.linked = false; // Need to re-link in new directory
      this._saveState();
    }

    return session;
  }

  /**
   * Link filesystem tools to an agent in a project directory
   * This runs: letta --agent <id> --link
   *
   * @param {string} agentId - Letta agent ID
   * @param {string} projectDir - Project directory path
   * @param {string} [agentName] - Optional agent name for logging
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async linkTools(agentId, projectDir, agentName = null) {
    const session = this.getOrCreateSession(agentId, projectDir, agentName);

    if (!fs.existsSync(projectDir)) {
      return {
        success: false,
        message: `Project directory does not exist: ${projectDir}`,
      };
    }

    logger.info({ agentId, projectDir }, 'Linking Letta Code tools to agent');

    const existingLink = this._getExistingLinkInfo(projectDir);
    if (existingLink && existingLink.linkedAgentId === agentId) {
      session.linked = true;
      session.agentName = session.agentName || agentName || existingLink.linkedAgentName || null;
      session.lastActivity = Date.now();
      this._saveState();
      return {
        success: true,
        message: `Agent ${agentId} already linked to ${projectDir}`,
        session: session.toJSON(),
        reusedLink: true,
      };
    }

    if (existingLink && existingLink.linkedAgentId && existingLink.linkedAgentId !== agentId) {
      return {
        success: false,
        message: `Project already linked to agent ${existingLink.linkedAgentId}. Remove the existing link first.`,
      };
    }

    try {
      const lettaDir = existingLink?.lettaDir || path.join(projectDir, '.letta');
      if (!fs.existsSync(lettaDir)) {
        fs.mkdirSync(lettaDir, { recursive: true });
      }

      const settingsPath = existingLink?.settingsPath || path.join(lettaDir, 'settings.local.json');
      const settings = {
        agentId,
        linkedAt: new Date().toISOString(),
        agentName,
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      session.linked = true;
      session.lastActivity = Date.now();
      this._saveState();

      logger.info({ agentId, projectDir }, 'Letta Code tools linked successfully');

      return {
        success: true,
        message: `Agent ${agentId} linked to ${projectDir}`,
        session: session.toJSON(),
      };
    } catch (error) {
      logger.error({ err: error, agentId, projectDir }, 'Failed to link Letta Code tools');
      const permissionDenied = error.code === 'EACCES';
      return {
        success: false,
        message: permissionDenied
          ? `Permission denied while linking agent ${agentId}. Run 'letta --agent ${agentId} --link' in ${projectDir} with appropriate permissions and retry.`
          : `Failed to link tools: ${error.message}`,
      };
    }
  }

  /**
   * Run a headless task for an agent in their project directory
   * This runs: cd <projectDir> && letta -p "<prompt>" --agent <agentId>
   *
   * @param {string} agentId - Letta agent ID
   * @param {string} prompt - Task prompt/instructions
   * @param {Object} [options] - Additional options
   * @param {string} [options.projectDir] - Override project directory
   * @param {number} [options.timeout] - Timeout in milliseconds (default: 5 minutes)
   * @returns {Promise<{ success: boolean, result: string, error?: string }>}
   */
  async runTask(agentId, prompt, options = {}) {
    const session = this.sessions.get(agentId);
    const projectDir = options.projectDir || session?.projectDir;

    if (!projectDir) {
      return {
        success: false,
        result: '',
        error: `No project directory configured for agent ${agentId}. Call linkTools first.`,
      };
    }

    if (!fs.existsSync(projectDir)) {
      return {
        success: false,
        result: '',
        error: `Project directory does not exist: ${projectDir}`,
      };
    }

    const timeout = options.timeout || 5 * 60 * 1000; // 5 minutes default

    logger.info({
      agentId,
      projectDir,
      promptLength: prompt.length,
      timeout,
    }, 'Running Letta Code task');

    return new Promise((resolve) => {
      const env = {
        ...process.env,
        LETTA_BASE_URL: this.lettaBaseUrl,
        LETTA_API_KEY: this.lettaApiKey,
      };

      // Build command args - use --yolo to bypass tool approval prompts
      const args = ['-p', prompt, '--agent', agentId, '--yolo'];

      logger.info({ agentId, projectDir, args: args.join(' ') }, 'Running Letta Code task');

      const child = spawn('letta', args, {
        cwd: projectDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        // Update session
        if (session) {
          session.lastActivity = Date.now();
          session.taskCount++;
          this._saveState();
        }

        if (code === 0) {
          logger.info({
            agentId,
            projectDir,
            outputLength: stdout.length,
          }, 'Letta Code task completed successfully');

          resolve({
            success: true,
            result: stdout.trim(),
            exitCode: code,
          });
        } else {
          logger.error({
            agentId,
            projectDir,
            exitCode: code,
            stderr,
          }, 'Letta Code task failed');

          resolve({
            success: false,
            result: stdout.trim(),
            error: stderr.trim() || `Process exited with code ${code}`,
            exitCode: code,
          });
        }
      });

      child.on('error', (error) => {
        logger.error({ err: error, agentId, projectDir }, 'Letta Code process error');
        resolve({
          success: false,
          result: '',
          error: error.message,
        });
      });

      // Handle timeout
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGTERM');
          resolve({
            success: false,
            result: stdout.trim(),
            error: `Task timed out after ${timeout}ms`,
          });
        }
      }, timeout);
    });
  }

  /**
   * Get session info for an agent
   *
   * @param {string} agentId - Letta agent ID
   * @returns {Object|null} Session info or null
   */
  getSession(agentId) {
    const session = this.sessions.get(agentId);
    return session ? session.toJSON() : null;
  }

  /**
   * List all active sessions
   *
   * @returns {Array} Array of session info objects
   */
  listSessions() {
    return Array.from(this.sessions.values()).map(s => s.toJSON());
  }

  /**
   * Remove a session (does not unlink tools from agent)
   *
   * @param {string} agentId - Letta agent ID
   * @returns {boolean} True if session was removed
   */
  removeSession(agentId) {
    const removed = this.sessions.delete(agentId);
    if (removed) {
      this._saveState();
      logger.info({ agentId }, 'Removed Letta Code session');
    }
    return removed;
  }

  /**
   * Resolve project directory for a Huly project
   * Uses the existing textParsers logic
   *
   * @param {Object} hulyProject - Huly project object with description
   * @returns {string} Resolved project directory path
   */
  resolveProjectDir(hulyProject) {
    return determineGitRepoPath(hulyProject);
  }

  /**
   * Configure an agent for a Huly project
   * Links the agent to the project's filesystem path
   *
   * @param {string} agentId - Letta agent ID
   * @param {Object} hulyProject - Huly project object
   * @param {string} [agentName] - Optional agent name
   * @returns {Promise<Object>} Link result
   */
  async configureForProject(agentId, hulyProject, agentName = null) {
    const projectDir = this.resolveProjectDir(hulyProject);

    logger.info({
      agentId,
      projectIdentifier: hulyProject.identifier,
      projectDir,
    }, 'Configuring agent for Huly project');

    return this.linkTools(agentId, projectDir, agentName || hulyProject.name);
  }
}

/**
 * Create a LettaCodeService instance
 *
 * @param {Object} [options] - Service options
 * @returns {LettaCodeService}
 */
export function createLettaCodeService(options = {}) {
  return new LettaCodeService(options);
}

export default LettaCodeService;
