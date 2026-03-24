/**
 * Orchestration Activities — Project Fetching (Registry-Based)
 *
 * Activities for fetching projects from the local SQLite ProjectRegistry.
 * Phase 4: No more Huly API calls — registry is the single source of truth.
 */
import type { HulyProject } from './orchestration';
/**
 * Fetch all active projects from the local SQLite ProjectRegistry.
 *
 * Replaces the old fetchHulyProjects that called the dead Huly API.
 * Returns the same HulyProject[] shape for workflow compatibility.
 */
export declare function fetchRegistryProjects(): Promise<HulyProject[]>;
//# sourceMappingURL=orchestration-projects.d.ts.map