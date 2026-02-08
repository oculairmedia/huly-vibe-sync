/**
 * Shared Huly dedupe helpers for Temporal activities.
 *
 * Uses local sync DB mappings first to avoid expensive Huly API title scans.
 */
export declare function findMappedIssueByBeadsId(projectIdentifier: string, beadsIssueId: string): Promise<string | null>;
export declare function findMappedIssueByTitle(projectIdentifier: string, title: string): Promise<string | null>;
//# sourceMappingURL=huly-dedupe.d.ts.map