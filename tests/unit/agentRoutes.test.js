import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncDatabase } from '../../lib/database.js';
import fs from 'fs';
import path from 'path';

describe('Agent lookup API', () => {
  let db;
  let testDbPath;

  beforeEach(() => {
    testDbPath = path.join(process.env.DB_PATH.replace('.db', `-agents-${Date.now()}.db`));
    db = new SyncDatabase(testDbPath);
    db.initialize();

    db.upsertProject({
      identifier: 'HVSYN',
      name: 'Huly-Vibe Sync Service',
      git_url: 'https://github.com/oculairmedia/huly-vibe-sync',
      filesystem_path: '/opt/stacks/huly-vibe-sync',
      status: 'active',
    });
    db.projects.setProjectLettaAgent('HVSYN', {
      agentId: 'agent-b417b8da-84d2-40dd-97ad-3a35454934f7',
    });

    db.upsertProject({
      identifier: 'GRAPH',
      name: 'Graphiti Knowledge Graph Platform',
      git_url: 'https://github.com/oculairmedia/graphiti',
      filesystem_path: '/opt/stacks/graphiti',
      status: 'active',
    });
    db.projects.setProjectLettaAgent('GRAPH', {
      agentId: 'agent-80ac3bb8-1087-412d-a19c-7c8c6aeb5916',
    });

    db.upsertProject({
      identifier: 'NOAGENT',
      name: 'No Agent Project',
      git_url: null,
      filesystem_path: '/opt/stacks/no-agent',
      status: 'active',
    });
  });

  afterEach(() => {
    if (db.db) db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = testDbPath + suffix;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  describe('getAllProjectsWithAgents', () => {
    it('should return only projects with agents', () => {
      const agents = db.getAllProjectsWithAgents();
      expect(agents).toHaveLength(2);
      expect(agents.every(a => a.agent_id != null)).toBe(true);
    });

    it('should return the expected shape', () => {
      const agents = db.getAllProjectsWithAgents();
      const hvsyn = agents.find(a => a.project_identifier === 'HVSYN');
      expect(hvsyn).toEqual({
        agent_id: 'agent-b417b8da-84d2-40dd-97ad-3a35454934f7',
        agent_name: 'Huly-Vibe Sync Service',
        project_identifier: 'HVSYN',
        git_url: 'https://github.com/oculairmedia/huly-vibe-sync',
        filesystem_path: '/opt/stacks/huly-vibe-sync',
      });
    });

    it('should exclude projects without agents', () => {
      const agents = db.getAllProjectsWithAgents();
      expect(agents.find(a => a.project_identifier === 'NOAGENT')).toBeUndefined();
    });
  });

  describe('lookupProjectByRepo', () => {
    it('should match by repo name', () => {
      const result = db.lookupProjectByRepo('huly-vibe-sync');
      expect(result).not.toBeNull();
      expect(result.project_identifier).toBe('HVSYN');
      expect(result.agent_id).toBe('agent-b417b8da-84d2-40dd-97ad-3a35454934f7');
    });

    it('should match by full org/repo', () => {
      const result = db.lookupProjectByRepo('oculairmedia/huly-vibe-sync');
      expect(result).not.toBeNull();
      expect(result.project_identifier).toBe('HVSYN');
    });

    it('should be case-insensitive', () => {
      const result = db.lookupProjectByRepo('HULY-VIBE-SYNC');
      expect(result).not.toBeNull();
      expect(result.project_identifier).toBe('HVSYN');
    });

    it('should return null for no match', () => {
      const result = db.lookupProjectByRepo('nonexistent-repo');
      expect(result).toBeUndefined();
    });

    it('should match partial repo name', () => {
      const result = db.lookupProjectByRepo('graphiti');
      expect(result).not.toBeNull();
      expect(result.project_identifier).toBe('GRAPH');
    });

    it('should not match projects without git_url', () => {
      const result = db.lookupProjectByRepo('no-agent');
      expect(result).toBeUndefined();
    });
  });
});
