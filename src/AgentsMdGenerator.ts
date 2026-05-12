import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger';
import { resolveFromAppRoot } from './runtimePaths';

const SECTION_ORDER = [
  'project-info', 'reporting-hierarchy', 'beads-instructions', 'bookstack-docs',
  'session-completion', 'codebase-context', 'custom-rules',
] as const;

type SectionId = (typeof SECTION_ORDER)[number];

interface Markers {
  start: string;
  end: string;
  custom: string;
}

interface ChangeRecord {
  section: SectionId;
  action: string;
  reason?: string;
}

interface SectionInfo {
  exists: boolean;
  custom?: boolean;
}

interface GenerateOptions {
  sections?: string[];
  dryRun?: boolean;
}

interface TemplateVars {
  [key: string]: string | number | boolean | undefined;
}

function markers(sectionId: string): Markers {
  return {
    start: `<!-- VIBESYNC:${sectionId}:START -->`,
    end: `<!-- VIBESYNC:${sectionId}:END -->`,
    custom: `<!-- VIBESYNC:${sectionId}:CUSTOM -->`,
  };
}

function interpolate(template: string, vars: TemplateVars): string {
  if (!vars || !template) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`;
  });
}

function loadTemplate(sectionId: string): string | null {
  const templatePath = resolveFromAppRoot('templates', 'agents-md', `${sectionId}.md`);
  if (!fs.existsSync(templatePath)) return null;
  return fs.readFileSync(templatePath, 'utf8');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findEndOfCustomBlock(content: string, afterMarkerIdx: number): number {
  const nextMarkerMatch = content.slice(afterMarkerIdx).search(/<!-- VIBESYNC:/);
  if (nextMarkerMatch === -1) return content.length;
  const absoluteIdx = afterMarkerIdx + nextMarkerMatch;
  let insertAt = absoluteIdx;
  while (insertAt > 0 && content[insertAt - 1] === '\n') insertAt--;
  return insertAt;
}

export class AgentsMdGenerator {
  private log = logger.child({ service: 'AgentsMdGenerator' });

  generate(filePath: string, vars: TemplateVars, options: GenerateOptions = {}): { content: string; changes: ChangeRecord[] } {
    const sections = options.sections || [...SECTION_ORDER];
    const dryRun = options.dryRun || false;

    let existing = '';
    if (fs.existsSync(filePath)) existing = fs.readFileSync(filePath, 'utf8');

    const changes: ChangeRecord[] = [];
    let result = existing;

    for (const sectionId of SECTION_ORDER) {
      if (!sections.includes(sectionId)) continue;

      const m = markers(sectionId);
      if (result.includes(m.custom)) {
        changes.push({ section: sectionId, action: 'skipped', reason: 'CUSTOM marker' });
        continue;
      }

      const template = loadTemplate(sectionId);
      if (!template) {
        changes.push({ section: sectionId, action: 'skipped', reason: 'no template file' });
        continue;
      }

      const rendered = interpolate(template.trim(), vars);
      const block = `${m.start}\n${rendered}\n${m.end}`;

      if (result.includes(m.start)) {
        const regex = new RegExp(`${escapeRegex(m.start)}[\\s\\S]*?${escapeRegex(m.end)}`, 'g');
        result = result.replace(regex, block);
        changes.push({ section: sectionId, action: 'updated' });
      } else {
        result = this._insertSection(result, sectionId, block);
        changes.push({ section: sectionId, action: 'inserted' });
      }
    }

    result = result.replace(/\n{3,}/g, '\n\n').trim() + '\n';

    if (!dryRun) {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, result, { mode: 0o666 });
      this.log.info({ path: filePath, changes }, 'AGENTS.md updated');
    }

    return { content: result, changes };
  }

  removeSection(filePath: string, sectionId: string): boolean {
    if (!fs.existsSync(filePath)) return false;

    const content = fs.readFileSync(filePath, 'utf8');
    const m = markers(sectionId);

    if (!content.includes(m.start) && !content.includes(m.custom)) return false;

    let result = content;
    const regex = new RegExp(`${escapeRegex(m.start)}[\\s\\S]*?${escapeRegex(m.end)}\\n*`, 'g');
    result = result.replace(regex, '');
    result = result.replace(new RegExp(`${escapeRegex(m.custom)}\\n*`, 'g'), '');

    result = result.replace(/\n{3,}/g, '\n\n').trim() + '\n';
    fs.writeFileSync(filePath, result, { mode: 0o666 });
    return true;
  }

  hasSection(filePath: string, sectionId: string): SectionInfo {
    if (!fs.existsSync(filePath)) return { exists: false };
    const content = fs.readFileSync(filePath, 'utf8');
    const m = markers(sectionId);

    if (content.includes(m.custom)) return { exists: true, custom: true };
    if (content.includes(m.start)) return { exists: true, custom: false };
    return { exists: false };
  }

  inspect(filePath: string): Record<string, SectionInfo> {
    const result: Record<string, SectionInfo> = {};
    for (const sectionId of SECTION_ORDER) {
      result[sectionId] = this.hasSection(filePath, sectionId);
    }
    return result;
  }

  private _insertSection(content: string, sectionId: string, block: string): string {
    const idx = SECTION_ORDER.indexOf(sectionId as SectionId);

    for (let i = idx - 1; i >= 0; i--) {
      const prevId = SECTION_ORDER[i];
      if (!prevId) continue;
      const prevMarkers = markers(prevId);

      const endIdx = content.indexOf(prevMarkers.end);
      if (endIdx !== -1) {
        const insertAt = endIdx + prevMarkers.end.length;
        return content.slice(0, insertAt) + '\n\n' + block + content.slice(insertAt);
      }

      const customIdx = content.indexOf(prevMarkers.custom);
      if (customIdx !== -1) {
        const insertAt = findEndOfCustomBlock(content, customIdx + prevMarkers.custom.length);
        return content.slice(0, insertAt) + '\n\n' + block + content.slice(insertAt);
      }
    }

    if (content.trim()) return block + '\n\n' + content;
    return block + '\n';
  }
}

export const agentsMdGenerator = new AgentsMdGenerator();
export { markers, SECTION_ORDER, interpolate, loadTemplate };
export default AgentsMdGenerator;
