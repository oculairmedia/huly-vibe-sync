/**
 * Memory builder wrappers for Temporal activities.
 *
 * The main lib/LettaMemoryBuilders.js is ESM (package.json "type": "module")
 * but Temporal workers compile to CJS. This module provides CJS-compatible
 * wrappers that lazily import the ESM builders via dynamic import().
 *
 * We use Function('return import(...)') to prevent TypeScript from converting
 * the dynamic import() into require() during CJS compilation.
 */
export declare function buildBoardMetrics(issues: any[]): Promise<any>;
export declare function buildProjectMeta(project: any, repoPath: string | null, gitUrl: string | null): Promise<any>;
export declare function buildBoardConfig(): Promise<any>;
export declare function buildHotspots(issues: any[]): Promise<any>;
export declare function buildBacklogSummary(issues: any[]): Promise<any>;
export declare function buildRecentActivity(activityData: any): Promise<any>;
export declare function buildComponentsSummary(issues: any[]): Promise<any>;
//# sourceMappingURL=memoryBuilders.d.ts.map