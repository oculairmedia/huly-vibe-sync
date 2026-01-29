/**
 * AgentsMdGenerator - Composable AGENTS.md generation with marker-based sections
 *
 * Each section is independently managed via HTML comment markers:
 *   <!-- VIBESYNC:section-name:START -->
 *   ...content...
 *   <!-- VIBESYNC:section-name:END -->
 *
 * Sections marked as CUSTOM are never overwritten:
 *   <!-- VIBESYNC:section-name:CUSTOM -->
 *
 * @see HVSYN-910
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'agents-md');

/** Ordered list of section IDs (determines output order) */
const SECTION_ORDER = [
  'project-info',
  'reporting-hierarchy',
  'beads-instructions',
  'bookstack-docs',
  'session-completion',
  'codebase-context',
  'custom-rules',
];

/**
 * Build start/end/custom markers for a section
 */
function markers(sectionId) {
  return {
    start: `<!-- VIBESYNC:${sectionId}:START -->`,
    end: `<!-- VIBESYNC:${sectionId}:END -->`,
    custom: `<!-- VIBESYNC:${sectionId}:CUSTOM -->`,
  };
}

/**
 * Simple Mustache-style template interpolation: {{key}}
 */
function interpolate(template, vars) {
  if (!vars || !template) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`;
  });
}

/**
 * Load a section template from disk
 */
function loadTemplate(sectionId) {
  const templatePath = path.join(TEMPLATES_DIR, `${sectionId}.md`);
  if (!fs.existsSync(templatePath)) return null;
  return fs.readFileSync(templatePath, 'utf8');
}

export class AgentsMdGenerator {
  constructor() {
    this.log = logger.child({ service: 'AgentsMdGenerator' });
  }

  /**
   * Generate or update an AGENTS.md file with composable sections.
   *
   * @param {string} filePath - Absolute path to AGENTS.md
   * @param {Object} vars - Template variables (identifier, name, agentId, agentName, projectPath, etc.)
   * @param {Object} [options]
   * @param {string[]} [options.sections] - Section IDs to include (defaults to all)
   * @param {boolean} [options.dryRun=false] - Return content without writing
   * @returns {{ content: string, changes: Object[] }} Generated content and change log
   */
  generate(filePath, vars, options = {}) {
    const sections = options.sections || SECTION_ORDER;
    const dryRun = options.dryRun || false;

    // Read existing content
    let existing = '';
    if (fs.existsSync(filePath)) {
      existing = fs.readFileSync(filePath, 'utf8');
    }

    const changes = [];
    let result = existing;

    for (const sectionId of SECTION_ORDER) {
      if (!sections.includes(sectionId)) continue;

      const m = markers(sectionId);

      // Check if section is marked CUSTOM — never touch it
      if (result.includes(m.custom)) {
        changes.push({ section: sectionId, action: 'skipped', reason: 'CUSTOM marker' });
        continue;
      }

      // Load and interpolate template
      const template = loadTemplate(sectionId);
      if (!template) {
        changes.push({ section: sectionId, action: 'skipped', reason: 'no template file' });
        continue;
      }

      const rendered = interpolate(template.trim(), vars);
      const block = `${m.start}\n${rendered}\n${m.end}`;

      // Check if section already exists
      if (result.includes(m.start)) {
        // Replace existing block
        const regex = new RegExp(`${escapeRegex(m.start)}[\\s\\S]*?${escapeRegex(m.end)}`, 'g');
        result = result.replace(regex, block);
        changes.push({ section: sectionId, action: 'updated' });
      } else {
        // Insert at correct position based on SECTION_ORDER
        result = this._insertSection(result, sectionId, block);
        changes.push({ section: sectionId, action: 'inserted' });
      }
    }

    // Clean up excessive blank lines
    result = result.replace(/\n{3,}/g, '\n\n').trim() + '\n';

    if (!dryRun) {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, result, { mode: 0o666 });
      this.log.info({ path: filePath, changes }, 'AGENTS.md updated');
    }

    return { content: result, changes };
  }

  /**
   * Remove a section from an AGENTS.md file
   */
  removeSection(filePath, sectionId) {
    if (!fs.existsSync(filePath)) return false;

    const content = fs.readFileSync(filePath, 'utf8');
    const m = markers(sectionId);

    if (!content.includes(m.start) && !content.includes(m.custom)) return false;

    let result = content;

    // Remove managed block
    const regex = new RegExp(`${escapeRegex(m.start)}[\\s\\S]*?${escapeRegex(m.end)}\\n*`, 'g');
    result = result.replace(regex, '');

    // Remove custom marker if present
    result = result.replace(new RegExp(`${escapeRegex(m.custom)}\\n*`, 'g'), '');

    result = result.replace(/\n{3,}/g, '\n\n').trim() + '\n';
    fs.writeFileSync(filePath, result, { mode: 0o666 });
    return true;
  }

  /**
   * Check if a section exists (managed or custom) in an AGENTS.md
   */
  hasSection(filePath, sectionId) {
    if (!fs.existsSync(filePath)) return { exists: false };
    const content = fs.readFileSync(filePath, 'utf8');
    const m = markers(sectionId);

    if (content.includes(m.custom)) return { exists: true, custom: true };
    if (content.includes(m.start)) return { exists: true, custom: false };
    return { exists: false };
  }

  /**
   * Get info about all sections in an AGENTS.md
   */
  inspect(filePath) {
    const result = {};
    for (const sectionId of SECTION_ORDER) {
      result[sectionId] = this.hasSection(filePath, sectionId);
    }
    return result;
  }

  /**
   * Insert a section block at the correct position relative to other sections.
   * Finds the last existing section that should come before this one,
   * and inserts after it. If none found, prepends.
   */
  _insertSection(content, sectionId, block) {
    const idx = SECTION_ORDER.indexOf(sectionId);

    // Look for the last existing section that comes before this one
    for (let i = idx - 1; i >= 0; i--) {
      const prevId = SECTION_ORDER[i];
      const prevMarkers = markers(prevId);

      // Find end of previous section
      const endIdx = content.indexOf(prevMarkers.end);
      if (endIdx !== -1) {
        const insertAt = endIdx + prevMarkers.end.length;
        return content.slice(0, insertAt) + '\n\n' + block + content.slice(insertAt);
      }

      // Check for custom marker
      const customIdx = content.indexOf(prevMarkers.custom);
      if (customIdx !== -1) {
        const insertAt = customIdx + prevMarkers.custom.length;
        return content.slice(0, insertAt) + '\n\n' + block + content.slice(insertAt);
      }
    }

    // No previous section found — prepend with title
    if (content.trim()) {
      return block + '\n\n' + content;
    }
    return block + '\n';
  }
}

/**
 * Escape a string for use in a RegExp
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Singleton for convenience */
export const agentsMdGenerator = new AgentsMdGenerator();

/** Export markers helper for migration script */
export { markers, SECTION_ORDER, interpolate, loadTemplate };

export default AgentsMdGenerator;
