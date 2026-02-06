export class SyncDatabase {
  constructor(dbPath: string);
  getProjectLettaInfo(identifier: string): { letta_agent_id?: string } | null;
  setProjectLettaAgent(identifier: string, lettaInfo: { agentId: string }): void;
  setProjectLettaSyncAt(identifier: string, timestamp: number): void;
  close(): void;
}
export function createSyncDatabase(dbPath: string): SyncDatabase;
