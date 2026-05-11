/** Graphiti knowledge-graph API types. Sourced from lib/GraphitiClient.js and lib/graphiti/. */

export interface GraphitiEntity {
  id?: string;
  name: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface GraphitiEdge {
  source_id: string;
  target_id: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface GraphitiNode {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphitiEdgeResult {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphitiQueryResult<T = unknown> {
  nodes: GraphitiNode[];
  edges: GraphitiEdgeResult[];
  result?: T;
}

export interface GraphitiFunctionInfo {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  decorators?: string[];
  params?: string[];
}

export interface GraphitiClassInfo {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  methods: GraphitiFunctionInfo[];
}

export interface GraphitiModuleSummary {
  file: string;
  functions: GraphitiFunctionInfo[];
  classes: GraphitiClassInfo[];
  imports: string[];
  exports: string[];
}
