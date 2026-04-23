export class SyncDatabase {
  constructor(dbPath: string);
  db: any;
  syncState: any;
  projects: any;
  issues: any;
  metadata: any;
  syncHistory: any;
  projectFiles: any;
  bookstack: any;
  initialize(): void;
  static computeDescriptionHash(description: string | null | undefined): string | null;
  static computeIssueContentHash(issue: Record<string, unknown>): string | null;
  static hasIssueContentChanged(
    newIssue: Record<string, unknown>,
    storedHash: string | null | undefined
  ): boolean;
  getProjectLettaInfo(identifier: string): { letta_agent_id?: string } | null;
  setProjectLettaAgent(identifier: string, lettaInfo: { agentId: string }): void;
  setProjectLettaSyncAt(identifier: string, timestamp: number): void;
  [key: string]: any;
  close(): void;
}
export function migrateFromJSON(db: SyncDatabase, jsonFilePath: string): boolean;
export function createSyncDatabase(dbPath: string): SyncDatabase;
