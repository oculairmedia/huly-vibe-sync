/**
 * Unit Tests for LettaService
 *
 * Comprehensive test coverage for:
 * - ensureAgent() - agent creation/retrieval
 * - ensureControlAgent() - control agent management
 * - attachPmTools() - tool attachment
 * - syncToolsFromControl() - tool synchronization
 * - ensureFolder() - folder creation with caching
 * - ensureSource() - source creation with caching
 * - getPersistedAgentId() / saveAgentId() - persistence
 * - clearCache() - cache management
 * - upsertMemoryBlocks() - memory block management
 * - Error scenarios (rate limits, 404s, 409 conflicts)
 * - Caching behavior (cache hits vs misses)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LettaService, createLettaService } from '../../lib/LettaService.js';

// Mock external dependencies
vi.mock('@letta-ai/letta-client', () => {
  class MockLettaClient {
    constructor() {
      this.agents = {
        list: vi.fn(),
        retrieve: vi.fn(),
        tools: {
          list: vi.fn(),
          attach: vi.fn(),
          detach: vi.fn(),
        },
        blocks: {
          list: vi.fn(),
          attach: vi.fn(),
        },
        folders: {
          list: vi.fn(),
          attach: vi.fn(),
        },
        sources: {
          list: vi.fn(),
          attach: vi.fn(),
        },
        files: {
          closeAll: vi.fn(),
        },
      };
      this.blocks = {
        create: vi.fn(),
        modify: vi.fn(),
      };
      this.folders = {
        list: vi.fn(),
        create: vi.fn(),
        files: {
          upload: vi.fn(),
        },
      };
      this.sources = {
        list: vi.fn(),
        create: vi.fn(),
        files: {
          list: vi.fn(),
          upload: vi.fn(),
        },
      };
      this.tools = {
        mcp: {
          list: vi.fn(),
          create: vi.fn(),
        },
      };
    }
  }

  return { LettaClient: MockLettaClient };
});

vi.mock('../../lib/http.js', () => ({
  fetchWithPool: vi.fn(),
}));

vi.mock('../../lib/LettaMemoryBuilders.js', () => ({
  buildScratchpad: vi.fn(() => ({
    notes: [],
    observations: [],
    action_items: [],
    context: {},
    usage_guide: 'Test scratchpad',
  })),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
    createReadStream: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
  createReadStream: vi.fn(),
}));

import { LettaClient } from '@letta-ai/letta-client';
import { fetchWithPool } from '../../lib/http.js';
import { buildScratchpad } from '../../lib/LettaMemoryBuilders.js';
import fs from 'fs';

describe('LettaService', () => {
  let service;
  let mockClient;
  let consoleSpy;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Get the mock client instance
    mockClient = new LettaClient();

    // Create service instance
    service = new LettaService('http://localhost:8283', 'test-password', {
      model: 'anthropic/sonnet-4-5',
      embedding: 'letta/letta-free',
    });

    // Replace the client with our mock
    service.client = mockClient;

    // Suppress console output during tests
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    };

    // Mock fs.existsSync to return false by default (no existing settings)
    fs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // Constructor Tests
  // ============================================================
  describe('constructor', () => {
    it('should initialize with correct defaults', () => {
      const svc = new LettaService('http://localhost:8283', 'password');

      expect(svc.baseURL).toBe('http://localhost:8283');
      expect(svc.apiURL).toBe('http://localhost:8283/v1');
      expect(svc.password).toBe('password');
      expect(svc.model).toBe('anthropic/sonnet-4-5');
      expect(svc.embedding).toBe('letta/letta-free');
    });

    it('should not append /v1 if already present', () => {
      const svc = new LettaService('http://localhost:8283/v1', 'password');

      expect(svc.apiURL).toBe('http://localhost:8283/v1');
    });

    it('should use provided options over defaults', () => {
      const svc = new LettaService('http://localhost:8283', 'password', {
        model: 'custom-model',
        embedding: 'custom-embedding',
        controlAgentName: 'Custom-Control',
      });

      expect(svc.model).toBe('custom-model');
      expect(svc.embedding).toBe('custom-embedding');
      expect(svc.controlAgentName).toBe('Custom-Control');
    });
  });

  // ============================================================
  // clearCache Tests
  // ============================================================
  describe('clearCache', () => {
    it('should clear folder and source caches', () => {
      // Populate caches
      service._folderCache.set('test-folder', { id: 'folder-1' });
      service._sourceCache.set('test-source', { id: 'source-1' });
      service._controlAgentCache = { agentId: 'control-1' };

      service.clearCache();

      expect(service._folderCache.size).toBe(0);
      expect(service._sourceCache.size).toBe(0);
      expect(service._controlAgentCache).toBeNull();
    });

    it('should retain block hash cache', () => {
      service._blockHashCache.set('agent-1', new Map([['label', 'hash']]));

      service.clearCache();

      expect(service._blockHashCache.size).toBe(1);
    });
  });

  // ============================================================
  // getPersistedAgentId / saveAgentId Tests
  // ============================================================
  describe('getPersistedAgentId', () => {
    it('should return null when no agent is persisted', () => {
      const result = service.getPersistedAgentId('TEST');

      expect(result).toBeNull();
    });

    it('should return persisted agent ID', () => {
      service._agentState.agents['TEST'] = 'agent-123';

      const result = service.getPersistedAgentId('TEST');

      expect(result).toBe('agent-123');
    });
  });

  describe('saveAgentId', () => {
    it('should save agent ID to state', () => {
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockImplementation(() => {});

      service.saveAgentId('TEST', 'agent-456');

      expect(service._agentState.agents['TEST']).toBe('agent-456');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should create directory if it does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockImplementation(() => {});
      fs.writeFileSync.mockImplementation(() => {});

      service.saveAgentId('TEST', 'agent-789');

      expect(fs.mkdirSync).toHaveBeenCalled();
    });
  });

  // ============================================================
  // ensureControlAgent Tests
  // ============================================================
  describe('ensureControlAgent', () => {
    it('should return cached control agent if available', async () => {
      const cachedConfig = {
        agentId: 'control-123',
        agentName: 'Huly-PM-Control',
        toolIds: ['tool-1', 'tool-2'],
        persona: 'Test persona',
      };
      service._controlAgentCache = cachedConfig;

      const result = await service.ensureControlAgent();

      expect(result).toEqual(cachedConfig);
      expect(mockClient.agents.list).not.toHaveBeenCalled();
    });

    it('should find existing control agent by name', async () => {
      const existingAgent = {
        id: 'control-456',
        name: 'Huly-PM-Control',
        memory: { blocks: [{ label: 'persona', value: 'Test persona' }] },
      };

      service.controlAgentName = existingAgent.name;

      mockClient.agents.list.mockResolvedValue([existingAgent]);
      mockClient.agents.retrieve.mockResolvedValue(existingAgent);
      mockClient.agents.tools.list.mockResolvedValue([{ id: 'tool-1' }, { id: 'tool-2' }]);

      const result = await service.ensureControlAgent();

      expect(result.agentId).toBe('control-456');
      expect(result.toolIds).toEqual(['tool-1', 'tool-2']);
      expect(service._controlAgentCache).toEqual(result);
    });

    it('should create control agent if not found', async () => {
      mockClient.agents.list.mockResolvedValue([]);

      fetchWithPool.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'new-control-789',
          name: 'Huly-PM-Control',
          memory: { blocks: [] },
        }),
      });

      mockClient.agents.retrieve.mockResolvedValue({
        id: 'new-control-789',
        name: 'Huly-PM-Control',
        memory: { blocks: [{ label: 'persona', value: 'Created persona' }] },
      });
      mockClient.agents.tools.list.mockResolvedValue([]);
      mockClient.agents.tools.attach.mockResolvedValue({});
      mockClient.blocks.create.mockResolvedValue({ id: 'block-1' });
      mockClient.agents.blocks.attach.mockResolvedValue({});

      const result = await service.ensureControlAgent();

      expect(result.agentId).toBe('new-control-789');
      expect(fetchWithPool).toHaveBeenCalledWith(
        expect.stringContaining('/agents'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should throw error on API failure', async () => {
      mockClient.agents.list.mockRejectedValue(new Error('API Error'));

      await expect(service.ensureControlAgent()).rejects.toThrow('API Error');
    });
  });

  // ============================================================
  // ensureAgent Tests
  // ============================================================
  describe('ensureAgent', () => {
    beforeEach(() => {
      // Setup control agent cache
      service._controlAgentCache = {
        agentId: 'control-123',
        toolIds: ['tool-1'],
        persona: 'Control persona',
      };
    });

    it('should return existing agent from Letta by name', async () => {
      const existingAgent = {
        id: 'agent-existing',
        name: 'Huly - Test Project',
        created_at: '2025-01-01T00:00:00Z',
      };

      fetchWithPool.mockResolvedValue({
        ok: true,
        json: async () => [existingAgent],
      });

      const result = await service.ensureAgent('TEST', 'Test Project');

      expect(result.id).toBe('agent-existing');
      expect(service._agentState.agents['TEST']).toBe('agent-existing');
    });

    it('should return persisted agent if found in Letta', async () => {
      service._agentState.agents['TEST'] = 'agent-persisted';

      const persistedAgent = {
        id: 'agent-persisted',
        name: 'Huly - Test Project',
      };

      fetchWithPool.mockResolvedValue({
        ok: true,
        json: async () => [persistedAgent],
      });

      const result = await service.ensureAgent('TEST', 'Test Project');

      expect(result.id).toBe('agent-persisted');
    });

    it('should create new agent if none exists', async () => {
      fetchWithPool
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [], // No existing agents
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'new-agent-123',
            name: 'Huly - New Project',
          }),
        });

      mockClient.agents.list.mockResolvedValue([]);
      mockClient.agents.retrieve.mockResolvedValue({
        id: 'control-123',
        name: 'Huly-PM-Control',
        memory: { blocks: [{ label: 'persona', value: 'Control persona' }] },
      });
      mockClient.agents.tools.list.mockResolvedValue([{ id: 'tool-1' }]);
      mockClient.blocks.create.mockResolvedValue({ id: 'block-1' });
      mockClient.agents.blocks.attach.mockResolvedValue({});

      const result = await service.ensureAgent('NEW', 'New Project');

      expect(result.id).toBe('new-agent-123');
      expect(service._agentState.agents['NEW']).toBe('new-agent-123');
    });

    it('should handle duplicate agents by using most recent', async () => {
      const duplicateAgents = [
        { id: 'agent-old', name: 'Huly - Test Project', created_at: '2025-01-01T00:00:00Z' },
        { id: 'agent-new', name: 'Huly - Test Project', created_at: '2025-01-20T00:00:00Z' },
      ];

      fetchWithPool.mockResolvedValue({
        ok: true,
        json: async () => duplicateAgents,
      });

      const result = await service.ensureAgent('TEST', 'Test Project');

      expect(result.id).toBe('agent-new');
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining('DUPLICATE AGENTS DETECTED')
      );
    });

    it('should retry on rate limit errors', async () => {
      fetchWithPool
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [], // No existing agents
        })
        .mockRejectedValueOnce(new Error('HTTP 500: Rate limit'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [], // Check if agent was created
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'retry-agent',
            name: 'Huly - Retry Project',
          }),
        });

      mockClient.agents.list.mockResolvedValue([]);
      mockClient.agents.retrieve.mockResolvedValue({
        id: 'control-123',
        name: 'Huly-PM-Control',
        memory: { blocks: [{ label: 'persona', value: 'Control persona' }] },
      });
      mockClient.agents.tools.list.mockResolvedValue([]);
      mockClient.blocks.create.mockResolvedValue({ id: 'block-1' });
      mockClient.agents.blocks.attach.mockResolvedValue({});

      const result = await service.ensureAgent('RETRY', 'Retry Project');

      expect(result.id).toBe('retry-agent');
      expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('Rate limit hit'));
    });

    it('should sanitize project name for agent name', async () => {
      fetchWithPool.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      // Will fail to create but we can check the name sanitization
      fetchWithPool.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });
      fetchWithPool.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'sanitized-agent',
          name: 'Huly - Test-Project-Name',
        }),
      });

      mockClient.agents.list.mockResolvedValue([]);
      mockClient.agents.retrieve.mockResolvedValue({
        id: 'control-123',
        name: 'Huly-PM-Control',
        memory: { blocks: [] },
      });
      mockClient.agents.tools.list.mockResolvedValue([]);
      mockClient.blocks.create.mockResolvedValue({ id: 'block-1' });
      mockClient.agents.blocks.attach.mockResolvedValue({});

      await service.ensureAgent('TEST', 'Test/Project:Name');

      // Check that the POST was called with sanitized name
      expect(fetchWithPool).toHaveBeenCalledWith(
        expect.stringContaining('/agents'),
        expect.objectContaining({
          body: expect.stringContaining('Huly - Test-Project-Name'),
        })
      );
    });
  });

  // ============================================================
  // attachPmTools Tests
  // ============================================================
  describe('attachPmTools', () => {
    beforeEach(() => {
      service._controlAgentCache = {
        agentId: 'control-123',
        toolIds: ['tool-1', 'tool-2', 'tool-3'],
        persona: 'Control persona',
      };
    });

    it('should attach all tools from control agent', async () => {
      mockClient.agents.list.mockResolvedValue([
        { id: 'control-123', name: 'Huly-PM-Control', memory: { blocks: [] } },
      ]);
      mockClient.agents.retrieve.mockResolvedValue({
        id: 'control-123',
        name: 'Huly-PM-Control',
        memory: { blocks: [] },
      });
      mockClient.agents.tools.list.mockResolvedValue([
        { id: 'tool-1' },
        { id: 'tool-2' },
        { id: 'tool-3' },
      ]);
      mockClient.agents.tools.attach.mockResolvedValue({});

      const result = await service.attachPmTools('agent-123');

      expect(result.total).toBe(3);
      expect(result.attached).toBe(3);
      expect(mockClient.agents.tools.attach).toHaveBeenCalledTimes(3);
    });

    it('should skip already attached tools', async () => {
      service._controlAgentCache.toolIds = ['tool-1', 'tool-2'];
      mockClient.agents.list.mockResolvedValue([
        { id: 'control-123', name: 'Huly-PM-Control', memory: { blocks: [] } },
      ]);
      mockClient.agents.retrieve.mockResolvedValue({
        id: 'control-123',
        name: 'Huly-PM-Control',
        memory: { blocks: [] },
      });
      mockClient.agents.tools.list.mockResolvedValue([{ id: 'tool-1' }, { id: 'tool-2' }]);
      mockClient.agents.tools.attach
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('already attached'));

      const result = await service.attachPmTools('agent-123');

      expect(result.attached).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('should track errors during attachment', async () => {
      service._controlAgentCache.toolIds = ['tool-1'];
      mockClient.agents.list.mockResolvedValue([
        { id: 'control-123', name: 'Huly-PM-Control', memory: { blocks: [] } },
      ]);
      mockClient.agents.retrieve.mockResolvedValue({
        id: 'control-123',
        name: 'Huly-PM-Control',
        memory: { blocks: [] },
      });
      mockClient.agents.tools.list.mockResolvedValue([{ id: 'tool-1' }]);
      mockClient.agents.tools.attach.mockRejectedValue(new Error('Network error'));

      const result = await service.attachPmTools('agent-123');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe('Network error');
    });
  });

  // ============================================================
  // syncToolsFromControl Tests
  // ============================================================
  describe('syncToolsFromControl', () => {
    beforeEach(() => {
      service._controlAgentCache = {
        agentId: 'control-123',
        toolIds: ['tool-1', 'tool-2'],
        persona: 'Control persona',
      };
    });

    it('should attach missing tools', async () => {
      mockClient.agents.tools.list.mockResolvedValue([{ id: 'tool-1' }]);
      mockClient.agents.tools.attach.mockResolvedValue({});

      const result = await service.syncToolsFromControl('pm-agent-123');

      expect(result.attached).toBe(1);
      expect(mockClient.agents.tools.attach).toHaveBeenCalledWith('pm-agent-123', 'tool-2');
    });

    it('should detach extra tools when forceSync is true', async () => {
      mockClient.agents.tools.list.mockResolvedValue([{ id: 'tool-1' }, { id: 'tool-extra' }]);
      mockClient.agents.tools.detach.mockResolvedValue({});

      const result = await service.syncToolsFromControl('pm-agent-123', true);

      expect(result.detached).toBe(1);
      expect(mockClient.agents.tools.detach).toHaveBeenCalledWith('pm-agent-123', 'tool-extra');
    });

    it('should not detach tools when forceSync is false', async () => {
      mockClient.agents.list.mockResolvedValue([
        { id: 'control-123', name: 'Huly-PM-Control', memory: { blocks: [] } },
      ]);
      mockClient.agents.retrieve.mockResolvedValue({
        id: 'control-123',
        name: 'Huly-PM-Control',
        memory: { blocks: [] },
      });
      mockClient.agents.tools.list
        .mockResolvedValueOnce([{ id: 'tool-1' }])
        .mockResolvedValueOnce([{ id: 'tool-1' }, { id: 'tool-extra' }]);

      const result = await service.syncToolsFromControl('pm-agent-123', false);

      expect(result.detached).toBe(0);
      expect(mockClient.agents.tools.detach).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // ensureFolder Tests
  // ============================================================
  describe('ensureFolder', () => {
    it('should return cached folder if available', async () => {
      const cachedFolder = { id: 'folder-cached', name: 'Huly-TEST' };
      service._folderCache.set('Huly-TEST', cachedFolder);

      const result = await service.ensureFolder('TEST');

      expect(result).toEqual(cachedFolder);
      expect(mockClient.folders.list).not.toHaveBeenCalled();
    });

    it('should find existing folder by name', async () => {
      const existingFolder = { id: 'folder-existing', name: 'Huly-TEST' };
      mockClient.folders.list.mockResolvedValue([existingFolder]);

      const result = await service.ensureFolder('TEST');

      expect(result.id).toBe('folder-existing');
      expect(service._folderCache.get('Huly-TEST')).toEqual(existingFolder);
    });

    it('should create new folder if not found', async () => {
      mockClient.folders.list.mockResolvedValue([]);
      mockClient.folders.create.mockResolvedValue({
        id: 'folder-new',
        name: 'Huly-NEW',
      });

      const result = await service.ensureFolder('NEW');

      expect(result.id).toBe('folder-new');
      expect(mockClient.folders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Huly-NEW',
          embedding: 'letta/letta-free',
        })
      );
    });

    it('should include filesystem path in metadata if provided', async () => {
      mockClient.folders.list.mockResolvedValue([]);
      mockClient.folders.create.mockResolvedValue({
        id: 'folder-with-path',
        name: 'Huly-PATH',
      });

      await service.ensureFolder('PATH', '/opt/projects/test');

      expect(mockClient.folders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { filesystem_path: '/opt/projects/test' },
        })
      );
    });
  });

  // ============================================================
  // ensureSource Tests
  // ============================================================
  describe('ensureSource', () => {
    it('should return cached source if available', async () => {
      const cachedSource = { id: 'source-cached', name: 'README' };
      service._sourceCache.set('README', cachedSource);

      const result = await service.ensureSource('README');

      expect(result).toEqual(cachedSource);
      expect(mockClient.sources.list).not.toHaveBeenCalled();
    });

    it('should find existing source by name', async () => {
      const existingSource = { id: 'source-existing', name: 'README' };
      mockClient.sources.list.mockResolvedValue([existingSource]);

      const result = await service.ensureSource('README');

      expect(result.id).toBe('source-existing');
      expect(service._sourceCache.get('README')).toEqual(existingSource);
    });

    it('should create new source if not found', async () => {
      mockClient.sources.list.mockResolvedValue([]);
      mockClient.sources.create.mockResolvedValue({
        id: 'source-new',
        name: 'NEW-SOURCE',
      });

      const result = await service.ensureSource('NEW-SOURCE');

      expect(result.id).toBe('source-new');
      expect(mockClient.sources.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'NEW-SOURCE',
          embedding: 'letta/letta-free',
        })
      );
    });

    it('should handle 409 conflict by fetching existing source', async () => {
      mockClient.sources.list.mockResolvedValue([]);
      mockClient.sources.create.mockRejectedValue(new Error('409 Conflict'));

      fetchWithPool.mockResolvedValue({
        ok: true,
        json: async () => [{ id: 'source-conflict', name: 'CONFLICT-SOURCE' }],
      });

      const result = await service.ensureSource('CONFLICT-SOURCE');

      expect(result.id).toBe('source-conflict');
    });

    it('should return placeholder on unrecoverable 409', async () => {
      mockClient.sources.list.mockResolvedValue([]);
      mockClient.sources.create.mockRejectedValue(new Error('409 Conflict'));

      fetchWithPool.mockResolvedValue({
        ok: true,
        json: async () => [], // Source not found via REST either
      });

      // Mock SDK list to also return empty
      mockClient.sources.list.mockResolvedValue([]);

      const result = await service.ensureSource('MISSING-SOURCE');

      expect(result._placeholder).toBe(true);
      expect(result.id).toBeNull();
    });
  });

  // ============================================================
  // upsertMemoryBlocks Tests
  // ============================================================
  describe('upsertMemoryBlocks', () => {
    it('should skip API calls when all blocks match cache', async () => {
      const blocks = [{ label: 'test-block', value: 'test content' }];

      // Pre-populate cache with matching hash
      const hash = service._hashContent('test content');
      service._blockHashCache.set('agent-123', new Map([['test-block', hash]]));

      await service.upsertMemoryBlocks('agent-123', blocks);

      expect(mockClient.agents.blocks.list).not.toHaveBeenCalled();
    });

    it('should update existing blocks when content changes', async () => {
      const blocks = [{ label: 'existing-block', value: 'new content' }];

      mockClient.agents.blocks.list.mockResolvedValue([
        { id: 'block-1', label: 'existing-block', value: 'old content' },
      ]);
      mockClient.blocks.modify.mockResolvedValue({});

      await service.upsertMemoryBlocks('agent-123', blocks);

      expect(mockClient.blocks.modify).toHaveBeenCalledWith('block-1', { value: 'new content' });
    });

    it('should create and attach new blocks', async () => {
      const blocks = [{ label: 'new-block', value: 'new content' }];

      mockClient.agents.blocks.list.mockResolvedValue([]);
      mockClient.blocks.create.mockResolvedValue({ id: 'created-block' });
      mockClient.agents.blocks.attach.mockResolvedValue({});

      await service.upsertMemoryBlocks('agent-123', blocks);

      expect(mockClient.blocks.create).toHaveBeenCalledWith({
        label: 'new-block',
        value: 'new content',
      });
      expect(mockClient.agents.blocks.attach).toHaveBeenCalledWith('agent-123', 'created-block');
    });

    it('should truncate blocks exceeding size limit', async () => {
      const largeContent = 'x'.repeat(60000); // Exceeds 50000 char limit
      const blocks = [{ label: 'large-block', value: largeContent }];

      mockClient.agents.blocks.list.mockResolvedValue([]);
      mockClient.blocks.create.mockResolvedValue({ id: 'truncated-block' });
      mockClient.agents.blocks.attach.mockResolvedValue({});

      await service.upsertMemoryBlocks('agent-123', blocks);

      expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('exceeds size limit'));
      expect(mockClient.blocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          value: expect.stringContaining('[truncated]'),
        })
      );
    });

    it('should skip unchanged blocks', async () => {
      const blocks = [{ label: 'unchanged-block', value: 'same content' }];

      mockClient.agents.blocks.list.mockResolvedValue([
        { id: 'block-1', label: 'unchanged-block', value: 'same content' },
      ]);

      await service.upsertMemoryBlocks('agent-123', blocks);

      expect(mockClient.blocks.modify).not.toHaveBeenCalled();
      expect(mockClient.blocks.create).not.toHaveBeenCalled();
    });

    it('should serialize object values to JSON', async () => {
      const blocks = [{ label: 'object-block', value: { key: 'value', nested: { a: 1 } } }];

      mockClient.agents.blocks.list.mockResolvedValue([]);
      mockClient.blocks.create.mockResolvedValue({ id: 'json-block' });
      mockClient.agents.blocks.attach.mockResolvedValue({});

      await service.upsertMemoryBlocks('agent-123', blocks);

      expect(mockClient.blocks.create).toHaveBeenCalledWith({
        label: 'object-block',
        value: JSON.stringify({ key: 'value', nested: { a: 1 } }, null, 2),
      });
    });
  });

  // ============================================================
  // initializeScratchpad Tests
  // ============================================================
  describe('initializeScratchpad', () => {
    it('should skip if scratchpad already exists', async () => {
      mockClient.agents.blocks.list.mockResolvedValue([
        { id: 'existing-scratchpad', label: 'scratchpad', value: '{}' },
      ]);

      await service.initializeScratchpad('agent-123');

      expect(mockClient.blocks.create).not.toHaveBeenCalled();
    });

    it('should create and attach scratchpad if not exists', async () => {
      mockClient.agents.blocks.list.mockResolvedValue([]);
      mockClient.blocks.create.mockResolvedValue({ id: 'new-scratchpad' });
      mockClient.agents.blocks.attach.mockResolvedValue({});

      await service.initializeScratchpad('agent-123');

      expect(mockClient.blocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'scratchpad',
        })
      );
      expect(mockClient.agents.blocks.attach).toHaveBeenCalledWith('agent-123', 'new-scratchpad');
    });
  });

  // ============================================================
  // getAgent / listAgents Tests
  // ============================================================
  describe('getAgent', () => {
    it('should retrieve agent by ID', async () => {
      const agent = { id: 'agent-123', name: 'Test Agent' };
      mockClient.agents.retrieve.mockResolvedValue(agent);

      const result = await service.getAgent('agent-123');

      expect(result).toEqual(agent);
      expect(mockClient.agents.retrieve).toHaveBeenCalledWith('agent-123');
    });

    it('should throw on error', async () => {
      mockClient.agents.retrieve.mockRejectedValue(new Error('Not found'));

      await expect(service.getAgent('invalid')).rejects.toThrow('Not found');
    });
  });

  describe('listAgents', () => {
    it('should list agents with filters', async () => {
      const agents = [{ id: 'agent-1' }, { id: 'agent-2' }];
      mockClient.agents.list.mockResolvedValue(agents);

      const result = await service.listAgents({ name: 'Test' });

      expect(result).toEqual(agents);
      expect(mockClient.agents.list).toHaveBeenCalledWith({ name: 'Test' });
    });
  });

  // ============================================================
  // attachFolderToAgent Tests
  // ============================================================
  describe('attachFolderToAgent', () => {
    it('should skip if folder already attached', async () => {
      mockClient.agents.folders.list.mockResolvedValue([{ id: 'folder-123' }]);

      await service.attachFolderToAgent('agent-123', 'folder-123');

      expect(mockClient.agents.folders.attach).not.toHaveBeenCalled();
    });

    it('should attach folder if not already attached', async () => {
      mockClient.agents.folders.list.mockResolvedValue([]);
      mockClient.agents.folders.attach.mockResolvedValue({});

      await service.attachFolderToAgent('agent-123', 'folder-456');

      expect(mockClient.agents.folders.attach).toHaveBeenCalledWith('agent-123', 'folder-456');
    });
  });

  // ============================================================
  // attachSourceToAgent Tests
  // ============================================================
  describe('attachSourceToAgent', () => {
    it('should skip if source already attached', async () => {
      mockClient.agents.sources.list.mockResolvedValue([{ id: 'source-123' }]);

      await service.attachSourceToAgent('agent-123', 'source-123');

      expect(mockClient.agents.sources.attach).not.toHaveBeenCalled();
    });

    it('should attach source if not already attached', async () => {
      mockClient.agents.sources.list.mockResolvedValue([]);
      mockClient.agents.sources.attach.mockResolvedValue({});

      await service.attachSourceToAgent('agent-123', 'source-456');

      expect(mockClient.agents.sources.attach).toHaveBeenCalledWith('agent-123', 'source-456');
    });
  });

  // ============================================================
  // listFolderFiles / closeAllFiles Tests
  // ============================================================
  describe('listFolderFiles', () => {
    it('should return files from folder', async () => {
      const files = [{ id: 'file-1' }, { id: 'file-2' }];
      mockClient.sources.files.list.mockResolvedValue(files);

      const result = await service.listFolderFiles('folder-123');

      expect(result).toEqual(files);
    });

    it('should return empty array on error', async () => {
      mockClient.sources.files.list.mockRejectedValue(new Error('Error'));

      const result = await service.listFolderFiles('folder-123');

      expect(result).toEqual([]);
    });
  });

  describe('closeAllFiles', () => {
    it('should close all files for agent', async () => {
      mockClient.agents.files.closeAll.mockResolvedValue({});

      await service.closeAllFiles('agent-123');

      expect(mockClient.agents.files.closeAll).toHaveBeenCalledWith('agent-123');
    });
  });

  // ============================================================
  // _hashContent Tests
  // ============================================================
  describe('_hashContent', () => {
    it('should return 0 for empty content', () => {
      expect(service._hashContent('')).toBe(0);
      expect(service._hashContent(null)).toBe(0);
    });

    it('should return consistent hash for same content', () => {
      const hash1 = service._hashContent('test content');
      const hash2 = service._hashContent('test content');

      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different content', () => {
      const hash1 = service._hashContent('content A');
      const hash2 = service._hashContent('content B');

      expect(hash1).not.toBe(hash2);
    });
  });

  // ============================================================
  // createLettaService Factory Tests
  // ============================================================
  describe('createLettaService', () => {
    it('should throw if LETTA_BASE_URL is not set', () => {
      const originalEnv = process.env.LETTA_BASE_URL;
      delete process.env.LETTA_BASE_URL;

      expect(() => createLettaService()).toThrow('LETTA_BASE_URL and LETTA_PASSWORD must be set');

      process.env.LETTA_BASE_URL = originalEnv;
    });

    it('should throw if LETTA_PASSWORD is not set', () => {
      const originalBaseUrl = process.env.LETTA_BASE_URL;
      const originalPassword = process.env.LETTA_PASSWORD;

      process.env.LETTA_BASE_URL = 'http://localhost:8283';
      delete process.env.LETTA_PASSWORD;

      expect(() => createLettaService()).toThrow('LETTA_BASE_URL and LETTA_PASSWORD must be set');

      process.env.LETTA_BASE_URL = originalBaseUrl;
      process.env.LETTA_PASSWORD = originalPassword;
    });

    it('should create service with environment variables', () => {
      const originalBaseUrl = process.env.LETTA_BASE_URL;
      const originalPassword = process.env.LETTA_PASSWORD;

      process.env.LETTA_BASE_URL = 'http://test:8283';
      process.env.LETTA_PASSWORD = 'test-pass';

      const svc = createLettaService();

      expect(svc).toBeInstanceOf(LettaService);
      expect(svc.baseURL).toBe('http://test:8283');

      process.env.LETTA_BASE_URL = originalBaseUrl;
      process.env.LETTA_PASSWORD = originalPassword;
    });
  });

  // ============================================================
  // Error Handling Tests
  // ============================================================
  describe('Error Handling', () => {
    it('should handle 404 errors gracefully in getControlAgentConfig', async () => {
      mockClient.agents.retrieve.mockRejectedValue(new Error('404 Not Found'));

      await expect(service.getControlAgentConfig('invalid-id')).rejects.toThrow('404 Not Found');
    });

    it('should handle network errors in ensureAgent', async () => {
      fetchWithPool.mockRejectedValue(new Error('Network Error'));

      await expect(service.ensureAgent('TEST', 'Test')).rejects.toThrow('Network Error');
    });

    it('should handle API errors in upsertMemoryBlocks', async () => {
      mockClient.agents.blocks.list.mockRejectedValue(new Error('API Error'));

      await expect(
        service.upsertMemoryBlocks('agent-123', [{ label: 'test', value: 'test' }])
      ).rejects.toThrow('API Error');
    });
  });
});
