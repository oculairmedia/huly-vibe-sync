/**
 * MCP Text Parsers - Parse structured text output from Huly MCP tools
 */

/**
 * Parse projects from structured text output
 *
 * @param {string} text - The text to parse
 * @returns {Array} Array of project objects
 */
export function parseProjectsFromText(text) {
  const projects = [];
  const lines = text.split('\n');

  let currentProject = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('\u{1F4C1} ') && trimmed.includes('(') && trimmed.endsWith(')')) {
      if (currentProject) {
        projects.push(currentProject);
      }

      const content = trimmed.substring(2);
      const lastParen = content.lastIndexOf('(');
      const name = content.substring(0, lastParen).trim();
      const identifier = content.substring(lastParen + 1, content.length - 1).trim();

      currentProject = {
        name,
        identifier,
        description: '',
        issues: 0,
        status: 'active',
      };
    } else if (trimmed.startsWith('Description: ') && currentProject) {
      currentProject.description = trimmed.substring(13).trim();
    } else if (trimmed.startsWith('Issues: ') && currentProject) {
      const count = parseInt(trimmed.substring(8).split(' ')[0], 10);
      currentProject.issues = isNaN(count) ? 0 : count;
    } else if (trimmed.startsWith('Status: ') && currentProject) {
      currentProject.status = trimmed.substring(8).trim().toLowerCase();
    } else if (trimmed.startsWith('Filesystem: ') && currentProject) {
      if (!currentProject.description.includes('Filesystem:')) {
        currentProject.description += `\n\n---\n${trimmed}`;
      }
    } else if (
      trimmed.includes('Filesystem:') &&
      !trimmed.startsWith('Description:') &&
      currentProject
    ) {
      if (!currentProject.description.includes('Filesystem:')) {
        currentProject.description += `\n\n---\n${trimmed}`;
      }
    }
  }

  if (currentProject) {
    projects.push(currentProject);
  }

  return projects;
}

/**
 * Parse issues from structured text output
 *
 * @param {string} text - The text to parse
 * @param {string} projectId - Optional project ID to associate with issues
 * @returns {Array} Array of issue objects
 */
export function parseIssuesFromText(text, projectId = null) {
  const issues = [];
  const lines = text.split('\n');

  let currentIssue = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('\u{1F4CB} **') && trimmed.includes('**:')) {
      if (currentIssue) {
        issues.push(currentIssue);
      }

      const parts = trimmed.split('**:', 1);
      const identifier = parts[0].substring(5).trim();
      const title = trimmed.substring(trimmed.indexOf('**:') + 3).trim();

      currentIssue = {
        identifier,
        title,
        description: '',
        status: 'unknown',
        priority: 'medium',
        component: null,
        milestone: null,
      };

      if (projectId) {
        currentIssue.project = projectId;
      }
    } else if (trimmed.startsWith('Status: ') && currentIssue) {
      currentIssue.status = trimmed.substring(8).trim().toLowerCase();
    } else if (trimmed.startsWith('Priority: ') && currentIssue) {
      currentIssue.priority = trimmed.substring(10).trim().toLowerCase();
    } else if (trimmed.startsWith('Description: ') && currentIssue) {
      currentIssue.description = trimmed.substring(13).trim();
    } else if (trimmed.startsWith('Component: ') && currentIssue) {
      currentIssue.component = trimmed.substring(11).trim();
    } else if (trimmed.startsWith('Milestone: ') && currentIssue) {
      currentIssue.milestone = trimmed.substring(11).trim();
    }
  }

  if (currentIssue) {
    issues.push(currentIssue);
  }

  return issues;
}

/**
 * Parse issue count from text (e.g., "10 open", "5 total")
 *
 * @param {string} text - The text containing issue count
 * @returns {number} The parsed count or 0
 */
export function parseIssueCount(text) {
  if (!text) {
    return 0;
  }

  const match = text.match(/\d+/);
  if (match) {
    return parseInt(match[0], 10);
  }

  return 0;
}
