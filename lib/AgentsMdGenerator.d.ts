interface SectionChange {
  section: string;
  action: string;
  reason?: string;
}

interface GenerateOptions {
  sections?: string[];
  dryRun?: boolean;
}

interface GenerateResult {
  content: string;
  changes: SectionChange[];
}

interface TemplateVars {
  identifier: string;
  name: string;
  agentId: string;
  agentName: string;
  projectPath: string;
  [key: string]: string;
}

interface SectionStatus {
  exists: boolean;
  custom?: boolean;
}

export class AgentsMdGenerator {
  generate(filePath: string, vars: TemplateVars, options?: GenerateOptions): GenerateResult;
  removeSection(filePath: string, sectionId: string): boolean;
  hasSection(filePath: string, sectionId: string): SectionStatus;
  inspect(filePath: string): Record<string, SectionStatus>;
}

export const agentsMdGenerator: AgentsMdGenerator;

export function markers(sectionId: string): { start: string; end: string; custom: string };
export const SECTION_ORDER: string[];
export function interpolate(template: string, vars: Record<string, string>): string;
export function loadTemplate(sectionId: string): string | null;

export default AgentsMdGenerator;
