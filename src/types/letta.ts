/**
 * Letta integration types. Source from LettaMemoryBuilders.d.ts,
 * @letta-ai/letta-client, and database repositories.
 */

export interface ProjectMeta {
  name: string;
  identifier: string;
  description?: string;
  status?: string;
}

export interface MemoryBlock {
  label: string;
  value: unknown;
  limit?: number;
}

export interface ProjectLettaInfo {
  letta_agent_id?: string;
  letta_folder_id?: string;
  letta_source_id?: string;
  letta_last_sync_at?: number;
}

export interface TemplateVars {
  identifier: string;
  name: string;
  agentId: string;
  agentName: string;
  projectPath: string;
  [key: string]: string;
}

export interface SectionChange {
  section: string;
  action: string;
  reason?: string;
}

export interface GenerateOptions {
  sections?: string[];
  dryRun?: boolean;
}

export interface GenerateResult {
  content: string;
  changes: SectionChange[];
}

export interface SectionStatus {
  exists: boolean;
  custom?: boolean;
}

export type MemoryBlockLabel =
  | 'project-meta'
  | 'board-config'
  | 'board-metrics'
  | 'hotspots'
  | 'backlog-summary'
  | 'recent-activity'
  | 'components-summary'
  | 'change-log'
  | 'expression'
  | 'scratchpad';
