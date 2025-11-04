/**
 * Text Parsing Utilities
 * 
 * Parses structured text output from Huly MCP tools
 */

/**
 * Parse projects from structured text output
 * 
 * Expected format:
 * 📁 Project Name (CODE)
 * Description: Project description
 * Issues: 10 open
 * Status: active
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

    // Project header: 📁 Project Name (CODE)
    if (trimmed.startsWith('📁 ') && trimmed.includes('(') && trimmed.endsWith(')')) {
      if (currentProject) {
        projects.push(currentProject);
      }

      // Extract name and identifier
      const content = trimmed.substring(2); // Remove "📁 "
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
    }
    // Description line
    else if (trimmed.startsWith('Description: ') && currentProject) {
      currentProject.description = trimmed.substring(13).trim();
    }
    // Issues count
    else if (trimmed.startsWith('Issues: ') && currentProject) {
      const count = parseInt(trimmed.substring(8).split(' ')[0], 10);
      currentProject.issues = isNaN(count) ? 0 : count;
    }
    // Status
    else if (trimmed.startsWith('Status: ') && currentProject) {
      currentProject.status = trimmed.substring(8).trim().toLowerCase();
    }
    // Filesystem path (special handling for our synced projects)
    else if (trimmed.startsWith('Filesystem: ') && currentProject) {
      if (!currentProject.description.includes('Filesystem:')) {
        currentProject.description += `\n\n---\n${trimmed}`;
      }
    }
    else if (trimmed.includes('Filesystem:') && !trimmed.startsWith('Description:') && currentProject) {
      // Sometimes filesystem path appears on its own line
      if (!currentProject.description.includes('Filesystem:')) {
        currentProject.description += `\n\n---\n${trimmed}`;
      }
    }
  }

  // Add the last project
  if (currentProject) {
    projects.push(currentProject);
  }

  return projects;
}

/**
 * Parse issues from structured text output
 * 
 * Expected format:
 * 📋 **PROJ-123**: Issue Title
 * Status: in progress
 * Priority: high
 * Description: Issue description
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

    // Issue header: 📋 **PROJ-123**: Issue Title
    if (trimmed.startsWith('📋 **') && trimmed.includes('**:')) {
      if (currentIssue) {
        issues.push(currentIssue);
      }

      // Extract identifier and title
      const parts = trimmed.split('**:', 1);
      const identifier = parts[0].substring(5).trim(); // Remove "📋 **"
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
    }
    // Status line
    else if (trimmed.startsWith('Status: ') && currentIssue) {
      currentIssue.status = trimmed.substring(8).trim().toLowerCase();
    }
    // Priority line
    else if (trimmed.startsWith('Priority: ') && currentIssue) {
      currentIssue.priority = trimmed.substring(10).trim().toLowerCase();
    }
    // Description line
    else if (trimmed.startsWith('Description: ') && currentIssue) {
      currentIssue.description = trimmed.substring(13).trim();
    }
    // Component line
    else if (trimmed.startsWith('Component: ') && currentIssue) {
      currentIssue.component = trimmed.substring(11).trim();
    }
    // Milestone line
    else if (trimmed.startsWith('Milestone: ') && currentIssue) {
      currentIssue.milestone = trimmed.substring(11).trim();
    }
  }

  // Add the last issue
  if (currentIssue) {
    issues.push(currentIssue);
  }

  return issues;
}

/**
 * Extract filesystem path from Huly project description
 * 
 * @param {string} description - The project description
 * @returns {string|null} The extracted filesystem path or null
 */
export function extractFilesystemPath(description) {
  if (!description) {
    return null;
  }

  // Match patterns like: Path:, Filesystem:, Directory:, Location:
  const patterns = [
    /(?:Path|Filesystem|Directory|Location):\s*([^\n\r]+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const path = match[1].trim();
      // Clean up common suffixes
      return path.replace(/[,;.]$/, '').trim();
    }
  }
  
  return null;
}

/**
 * Extract Huly identifier from Vibe task description
 * 
 * @param {string} description - The Vibe task description
 * @returns {string|null} The extracted Huly identifier or null
 */
export function extractHulyIdentifierFromDescription(description) {
  if (!description) {
    return null;
  }

  // Match pattern: "Huly Issue: PROJ-123"
  const patterns = [
    /Huly Issue:\s*([A-Z]+-\d+)/i,
    /Synced from Huly:\s*([A-Z]+-\d+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return null;
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

  // Extract first number from text
  const match = text.match(/\d+/);
  if (match) {
    return parseInt(match[0], 10);
  }

  return 0;
}
