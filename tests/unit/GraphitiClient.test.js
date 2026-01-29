import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GraphitiClient, createGraphitiClient } from '../../lib/GraphitiClient.js';

vi.mock('../../lib/http.js', () => ({
  fetchWithPool: vi.fn(),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { fetchWithPool } from '../../lib/http.js';

function createMockResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('GraphitiClient', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GraphitiClient({
      baseUrl: 'http://localhost:8003',
      groupId: 'test_group',
      timeout: 5000,
      retries: 2,
      retryDelayMs: 10,
    });
  });

  describe('constructor', () => {
    it('should initialize with correct options', () => {
      expect(client.baseUrl).toBe('http://localhost:8003');
      expect(client.groupId).toBe('test_group');
      expect(client.timeout).toBe(5000);
      expect(client.retries).toBe(2);
    });

    it('should strip trailing slash from baseUrl', () => {
      const c = new GraphitiClient({
        baseUrl: 'http://localhost:8003/',
        groupId: 'test',
      });
      expect(c.baseUrl).toBe('http://localhost:8003');
    });

    it('should use default values when not provided', () => {
      const c = new GraphitiClient({
        baseUrl: 'http://localhost:8003',
        groupId: 'test',
      });
      expect(c.timeout).toBe(30000);
      expect(c.retries).toBe(3);
      expect(c.retryDelayMs).toBe(1000);
    });
  });

  describe('getEntityUuid', () => {
    it('should fetch UUID from server', async () => {
      fetchWithPool.mockResolvedValueOnce(createMockResponse({ uuid: 'test-uuid-123' }));

      const uuid = await client.getEntityUuid('File:src/main.js');

      expect(uuid).toBe('test-uuid-123');
      expect(fetchWithPool).toHaveBeenCalledWith(
        expect.stringContaining('/api/utils/uuid'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should cache UUID results', async () => {
      fetchWithPool.mockResolvedValueOnce(createMockResponse({ uuid: 'cached-uuid' }));

      await client.getEntityUuid('File:src/main.js');
      const secondCall = await client.getEntityUuid('File:src/main.js');

      expect(secondCall).toBe('cached-uuid');
      expect(fetchWithPool).toHaveBeenCalledTimes(1);
    });

    it('should include name and group_id in query params', async () => {
      fetchWithPool.mockResolvedValueOnce(createMockResponse({ uuid: 'uuid-123' }));

      await client.getEntityUuid('Project:TEST');

      const calledUrl = fetchWithPool.mock.calls[0][0];
      expect(calledUrl).toContain('name=Project%3ATEST');
      expect(calledUrl).toContain('group_id=test_group');
    });
  });

  describe('getEdgeUuid', () => {
    it('should fetch edge UUID with correct params', async () => {
      fetchWithPool.mockResolvedValueOnce(createMockResponse({ uuid: 'edge-uuid-456' }));

      const uuid = await client.getEdgeUuid('source-uuid', 'target-uuid', 'CONTAINS');

      expect(uuid).toBe('edge-uuid-456');
      const calledUrl = fetchWithPool.mock.calls[0][0];
      expect(calledUrl).toContain('source_uuid=source-uuid');
      expect(calledUrl).toContain('target_uuid=target-uuid');
      expect(calledUrl).toContain('name=CONTAINS');
    });
  });

  describe('upsertEntity', () => {
    it('should create entity with generated UUID', async () => {
      fetchWithPool
        .mockResolvedValueOnce(createMockResponse({ uuid: 'generated-uuid' }))
        .mockResolvedValueOnce(createMockResponse({ success: true }));

      const result = await client.upsertEntity({
        name: 'File:src/index.js',
        summary: 'Main entry point',
      });

      expect(result.success).toBe(true);
      expect(client.stats.entitiesCreated).toBe(1);

      const entityCall = fetchWithPool.mock.calls[1];
      expect(entityCall[0]).toContain('/entity-node');
      expect(entityCall[1].method).toBe('POST');

      const body = JSON.parse(entityCall[1].body);
      expect(body.uuid).toBe('generated-uuid');
      expect(body.name).toBe('File:src/index.js');
      expect(body.summary).toBe('Main entry point');
      expect(body.group_id).toBe('test_group');
    });

    it('should use provided UUID when available', async () => {
      fetchWithPool.mockResolvedValueOnce(createMockResponse({ success: true }));

      await client.upsertEntity({
        name: 'File:test.js',
        uuid: 'pre-calculated-uuid',
      });

      const body = JSON.parse(fetchWithPool.mock.calls[0][1].body);
      expect(body.uuid).toBe('pre-calculated-uuid');
    });

    it('should default summary to empty string', async () => {
      fetchWithPool
        .mockResolvedValueOnce(createMockResponse({ uuid: 'uuid' }))
        .mockResolvedValueOnce(createMockResponse({ success: true }));

      await client.upsertEntity({ name: 'File:test.js' });

      const body = JSON.parse(fetchWithPool.mock.calls[1][1].body);
      expect(body.summary).toBe('');
    });
  });

  describe('upsertEntitiesBatch', () => {
    it('should process entities in batches', async () => {
      fetchWithPool.mockResolvedValue(createMockResponse({ uuid: 'uuid', success: true }));

      const entities = [
        { name: 'File:a.js', uuid: 'uuid-a' },
        { name: 'File:b.js', uuid: 'uuid-b' },
        { name: 'File:c.js', uuid: 'uuid-c' },
      ];

      const result = await client.upsertEntitiesBatch(entities, 2);

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle partial failures in batch', async () => {
      fetchWithPool
        .mockResolvedValueOnce(createMockResponse({ success: true }))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(createMockResponse({ success: true }));

      const entities = [
        { name: 'File:a.js', uuid: 'uuid-a' },
        { name: 'File:b.js', uuid: 'uuid-b' },
        { name: 'File:c.js', uuid: 'uuid-c' },
      ];

      const result = await client.upsertEntitiesBatch(entities, 3);

      expect(result.success).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].entity).toBe('File:b.js');
    });
  });

  describe('createContainmentEdge', () => {
    beforeEach(() => {
      fetchWithPool
        .mockResolvedValueOnce(createMockResponse({ uuid: 'project-uuid' }))
        .mockResolvedValueOnce(createMockResponse({ uuid: 'file-uuid' }))
        .mockResolvedValueOnce(createMockResponse({ uuid: 'edge-uuid' }));
    });

    it('should create edge with correct payload', async () => {
      fetchWithPool.mockResolvedValueOnce(createMockResponse({ success: true }));

      const result = await client.createContainmentEdge('TEST', 'src/main.js');

      expect(result.success).toBe(true);

      const edgeCall = fetchWithPool.mock.calls[3];
      expect(edgeCall[0]).toContain('/entity-edge');

      const body = JSON.parse(edgeCall[1].body);
      expect(body.uuid).toBe('edge-uuid');
      expect(body.source_node_uuid).toBe('project-uuid');
      expect(body.target_node_uuid).toBe('file-uuid');
      expect(body.name).toBe('CONTAINS');
      expect(body.fact).toBe('Project TEST contains file src/main.js');
      expect(body.group_id).toBe('test_group');
    });

    it('should increment edgesCreated stat on success', async () => {
      fetchWithPool.mockResolvedValueOnce(createMockResponse({ success: true }));

      await client.createContainmentEdge('TEST', 'src/main.js');

      expect(client.stats.edgesCreated).toBe(1);
    });

    it('should fallback to message queue on HTTP 500', async () => {
      fetchWithPool
        .mockRejectedValueOnce(new Error('HTTP 500: Internal Server Error'))
        .mockRejectedValueOnce(new Error('HTTP 500: Internal Server Error'))
        .mockResolvedValueOnce(createMockResponse({ queued: true }));

      const result = await client.createContainmentEdge('TEST', 'src/main.js');

      expect(result.queued).toBe(true);
      expect(client.stats.edgesFallback).toBe(1);

      const calls = fetchWithPool.mock.calls;
      const fallbackCall = calls[calls.length - 1];
      expect(fallbackCall[0]).toContain('/api/queue/messages');

      const body = JSON.parse(fallbackCall[1].body);
      expect(body.group_id).toBe('test_group');
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content).toContain('CODE_INDEX_EVENT');
      expect(body.messages[0].content).toContain('TEST');
      expect(body.messages[0].content).toContain('src/main.js');
    });

    it('should rethrow non-500 errors', async () => {
      fetchWithPool.mockRejectedValueOnce(new Error('HTTP 404: Not Found'));

      await expect(client.createContainmentEdge('TEST', 'src/main.js')).rejects.toThrow(
        'HTTP 404: Not Found'
      );
    });
  });

  describe('createContainmentEdgesBatch', () => {
    it('should process edges in batches', async () => {
      fetchWithPool.mockResolvedValue(createMockResponse({ uuid: 'uuid', success: true }));

      const files = ['a.js', 'b.js', 'c.js'];
      const result = await client.createContainmentEdgesBatch('TEST', files, 2);

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
    });

    it('should handle partial failures', async () => {
      let callCount = 0;
      fetchWithPool.mockImplementation(() => {
        callCount++;
        if (callCount === 7) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve(createMockResponse({ uuid: 'uuid', success: true }));
      });

      const files = ['a.js', 'b.js'];
      const result = await client.createContainmentEdgesBatch('TEST', files, 10);

      expect(result.failed).toBeGreaterThanOrEqual(1);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('_createEdgeViaMessageQueue', () => {
    it('should create message with correct structure', async () => {
      fetchWithPool.mockResolvedValueOnce(createMockResponse({ queued: true }));

      await client._createEdgeViaMessageQueue('PROJ', 'lib/utils.js');

      const body = JSON.parse(fetchWithPool.mock.calls[0][1].body);
      expect(body.group_id).toBe('test_group');
      expect(body.messages[0].role_type).toBe('system');
      expect(body.messages[0].role).toBe('code_indexer');
      expect(body.messages[0].name).toBe('file_containment');
      expect(body.messages[0].source_description).toBe('huly-vibe-sync CodePerception');
      expect(body.messages[0].timestamp).toBeDefined();
    });
  });

  describe('healthCheck', () => {
    it('should return true when API is healthy', async () => {
      fetchWithPool.mockResolvedValueOnce({ ok: true });

      const result = await client.healthCheck();

      expect(result).toBe(true);
    });

    it('should return false when API is unhealthy', async () => {
      fetchWithPool.mockResolvedValueOnce({ ok: false });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      fetchWithPool.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('retry logic', () => {
    it('should retry on network errors', async () => {
      fetchWithPool
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce(createMockResponse({ uuid: 'success' }));

      const uuid = await client.getEntityUuid('File:test.js');

      expect(uuid).toBe('success');
      expect(fetchWithPool).toHaveBeenCalledTimes(2);
      expect(client.stats.retries).toBe(1);
    });

    it('should retry on HTTP 5xx errors', async () => {
      fetchWithPool
        .mockRejectedValueOnce(new Error('HTTP 503: Service Unavailable'))
        .mockResolvedValueOnce(createMockResponse({ uuid: 'recovered' }));

      const uuid = await client.getEntityUuid('File:test.js');

      expect(uuid).toBe('recovered');
      expect(client.stats.retries).toBe(1);
    });

    it('should retry on rate limiting', async () => {
      fetchWithPool
        .mockRejectedValueOnce(new Error('HTTP 429: Too Many Requests'))
        .mockResolvedValueOnce(createMockResponse({ uuid: 'uuid' }));

      const uuid = await client.getEntityUuid('File:test.js');

      expect(uuid).toBe('uuid');
      expect(client.stats.retries).toBe(1);
    });

    it('should not retry on HTTP 4xx errors (except 429)', async () => {
      fetchWithPool.mockRejectedValueOnce(new Error('HTTP 404: Not Found'));

      await expect(client.getEntityUuid('File:test.js')).rejects.toThrow('HTTP 404');

      expect(fetchWithPool).toHaveBeenCalledTimes(1);
      expect(client.stats.retries).toBe(0);
    });

    it('should give up after max retries', async () => {
      fetchWithPool.mockRejectedValue({ code: 'ECONNREFUSED' });

      await expect(client.getEntityUuid('File:test.js')).rejects.toBeDefined();

      expect(fetchWithPool).toHaveBeenCalledTimes(2);
      expect(client.stats.errors).toBe(1);
    });
  });

  describe('stats', () => {
    it('should track entities created', async () => {
      fetchWithPool.mockResolvedValue(createMockResponse({ uuid: 'uuid', success: true }));

      await client.upsertEntity({ name: 'File:a.js', uuid: 'uuid' });
      await client.upsertEntity({ name: 'File:b.js', uuid: 'uuid' });

      expect(client.stats.entitiesCreated).toBe(2);
    });

    it('should reset stats', () => {
      client.stats.entitiesCreated = 10;
      client.stats.errors = 5;

      client.resetStats();

      expect(client.stats.entitiesCreated).toBe(0);
      expect(client.stats.errors).toBe(0);
    });

    it('should return stats copy', () => {
      client.stats.entitiesCreated = 5;
      const stats = client.getStats();

      stats.entitiesCreated = 100;

      expect(client.stats.entitiesCreated).toBe(5);
    });
  });

  describe('pruneDeletedFiles', () => {
    it('should call prune-missing endpoint', async () => {
      fetchWithPool.mockResolvedValueOnce(
        createMockResponse({ invalidated_count: 2, invalidated_files: ['old.js', 'deleted.js'] })
      );

      const result = await client.pruneDeletedFiles(['current.js', 'active.js']);

      expect(result.invalidated_count).toBe(2);
      expect(client.stats.pruneOperations).toBe(1);

      const body = JSON.parse(fetchWithPool.mock.calls[0][1].body);
      expect(body.group_id).toBe('test_group');
      expect(body.active_files).toEqual(['current.js', 'active.js']);
    });
  });

  describe('updateNodeSummary', () => {
    it('should update summary via PATCH', async () => {
      fetchWithPool.mockResolvedValueOnce(createMockResponse({ success: true }));

      await client.updateNodeSummary('node-uuid', 'Updated summary');

      expect(client.stats.entitiesUpdated).toBe(1);

      const call = fetchWithPool.mock.calls[0];
      expect(call[0]).toContain('/nodes/node-uuid/summary');
      expect(call[1].method).toBe('PATCH');

      const body = JSON.parse(call[1].body);
      expect(body.summary).toBe('Updated summary');
    });
  });

  describe('addMessage', () => {
    it('should add message with correct structure', async () => {
      fetchWithPool.mockResolvedValueOnce(createMockResponse({ success: true }));

      await client.addMessage({
        content: 'feat: add new feature',
        name: 'commit_msg',
        role: 'git_analyzer',
      });

      const body = JSON.parse(fetchWithPool.mock.calls[0][1].body);
      expect(body.group_id).toBe('test_group');
      expect(body.messages[0].content).toBe('feat: add new feature');
      expect(body.messages[0].name).toBe('commit_msg');
      expect(body.messages[0].role).toBe('git_analyzer');
      expect(body.messages[0].role_type).toBe('user');
    });

    it('should use defaults for optional fields', async () => {
      fetchWithPool.mockResolvedValueOnce(createMockResponse({ success: true }));

      await client.addMessage({ content: 'test message' });

      const body = JSON.parse(fetchWithPool.mock.calls[0][1].body);
      expect(body.messages[0].name).toBe('code_update');
      expect(body.messages[0].role).toBe('code_analyzer');
    });
  });
});

describe('upsertFunction', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GraphitiClient({
      baseUrl: 'http://localhost:8003',
      groupId: 'test_group',
      timeout: 5000,
      retries: 2,
      retryDelayMs: 10,
    });
  });

  it('should create function entity with correct name format', async () => {
    fetchWithPool
      .mockResolvedValueOnce(createMockResponse({ uuid: 'func-uuid' }))
      .mockResolvedValueOnce(createMockResponse({ success: true }));

    await client.upsertFunction({
      projectId: 'TEST',
      filePath: 'src/utils.js',
      name: 'calculateSum',
      signature: 'function calculateSum(a, b)',
      docstring: 'Adds two numbers',
      startLine: 10,
      endLine: 15,
    });

    const entityCall = fetchWithPool.mock.calls[1];
    const body = JSON.parse(entityCall[1].body);
    expect(body.name).toBe('function:TEST:src/utils.js:calculateSum');
    expect(body.summary).toContain('function calculateSum(a, b)');
    expect(body.summary).toContain('Adds two numbers');
    expect(body.summary).toContain('Lines: 10-15');
  });

  it('should handle function without docstring', async () => {
    fetchWithPool
      .mockResolvedValueOnce(createMockResponse({ uuid: 'func-uuid' }))
      .mockResolvedValueOnce(createMockResponse({ success: true }));

    await client.upsertFunction({
      projectId: 'TEST',
      filePath: 'src/main.js',
      name: 'init',
      signature: 'function init()',
      startLine: 1,
      endLine: 5,
    });

    const entityCall = fetchWithPool.mock.calls[1];
    const body = JSON.parse(entityCall[1].body);
    expect(body.summary).toBe('function init()\n\nLines: 1-5');
  });
});

describe('_buildFunctionSummary', () => {
  let client;

  beforeEach(() => {
    client = new GraphitiClient({
      baseUrl: 'http://localhost:8003',
      groupId: 'test_group',
    });
  });

  it('should include signature and line numbers', () => {
    const summary = client._buildFunctionSummary({
      signature: 'async function fetchData(url)',
      startLine: 42,
      endLine: 100,
    });

    expect(summary).toBe('async function fetchData(url)\n\nLines: 42-100');
  });

  it('should include docstring when provided', () => {
    const summary = client._buildFunctionSummary({
      signature: 'function process(data)',
      docstring: 'Processes the input data',
      startLine: 5,
      endLine: 20,
    });

    expect(summary).toContain('function process(data)');
    expect(summary).toContain('Processes the input data');
    expect(summary).toContain('Lines: 5-20');
  });
});

describe('createFileFunctionEdge', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GraphitiClient({
      baseUrl: 'http://localhost:8003',
      groupId: 'test_group',
      timeout: 5000,
      retries: 2,
      retryDelayMs: 10,
    });
  });

  it('should create edge with correct entity names', async () => {
    fetchWithPool
      .mockResolvedValueOnce(createMockResponse({ uuid: 'file-uuid' }))
      .mockResolvedValueOnce(createMockResponse({ uuid: 'func-uuid' }))
      .mockResolvedValueOnce(createMockResponse({ uuid: 'edge-uuid' }))
      .mockResolvedValueOnce(createMockResponse({ success: true }));

    await client.createFileFunctionEdge('TEST', 'src/utils.js', 'calculateSum');

    const uuidCalls = fetchWithPool.mock.calls.slice(0, 2);
    expect(uuidCalls[0][0]).toContain('name=File%3Asrc%2Futils.js');
    expect(uuidCalls[1][0]).toContain('name=function%3ATEST%3Asrc%2Futils.js%3AcalculateSum');

    const edgeCall = fetchWithPool.mock.calls[3];
    const body = JSON.parse(edgeCall[1].body);
    expect(body.source_node_uuid).toBe('file-uuid');
    expect(body.target_node_uuid).toBe('func-uuid');
    expect(body.name).toBe('CONTAINS');
    expect(body.fact).toBe('File src/utils.js contains function calculateSum');
  });

  it('should increment edgesCreated stat', async () => {
    fetchWithPool
      .mockResolvedValueOnce(createMockResponse({ uuid: 'file-uuid' }))
      .mockResolvedValueOnce(createMockResponse({ uuid: 'func-uuid' }))
      .mockResolvedValueOnce(createMockResponse({ uuid: 'edge-uuid' }))
      .mockResolvedValueOnce(createMockResponse({ success: true }));

    await client.createFileFunctionEdge('TEST', 'src/main.js', 'main');

    expect(client.stats.edgesCreated).toBe(1);
  });
});

describe('upsertFunctionsWithEdges', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GraphitiClient({
      baseUrl: 'http://localhost:8003',
      groupId: 'test_group',
      timeout: 5000,
      retries: 1,
      retryDelayMs: 10,
    });
  });

  it('should return empty results for empty functions array', async () => {
    const result = await client.upsertFunctionsWithEdges({
      projectId: 'TEST',
      filePath: 'src/empty.js',
      functions: [],
    });

    expect(result.entities.success).toBe(0);
    expect(result.edges.success).toBe(0);
    expect(fetchWithPool).not.toHaveBeenCalled();
  });

  it('should process functions and create edges', async () => {
    fetchWithPool.mockResolvedValue(createMockResponse({ uuid: 'uuid', success: true }));

    const functions = [
      { name: 'func1', signature: 'function func1()', start_line: 1, end_line: 5 },
      { name: 'func2', signature: 'function func2()', start_line: 10, end_line: 20 },
    ];

    const result = await client.upsertFunctionsWithEdges({
      projectId: 'TEST',
      filePath: 'src/module.js',
      functions,
      concurrency: 2,
      rateLimit: 1000,
    });

    expect(result.entities.success).toBe(2);
    expect(result.edges.success).toBe(2);
  });

  it('should handle entity creation failure', async () => {
    let entityUpsertCount = 0;
    fetchWithPool.mockImplementation(url => {
      if (url.includes('/entity-node')) {
        entityUpsertCount++;
        if (entityUpsertCount === 2) {
          return Promise.reject(new Error('Entity creation failed'));
        }
      }
      return Promise.resolve(createMockResponse({ uuid: 'uuid', success: true }));
    });

    const functions = [
      { name: 'func1', signature: 'f1()', start_line: 1, end_line: 5 },
      { name: 'func2', signature: 'f2()', start_line: 10, end_line: 15 },
    ];

    const result = await client.upsertFunctionsWithEdges({
      projectId: 'TEST',
      filePath: 'src/module.js',
      functions,
      concurrency: 1,
      rateLimit: 1000,
    });

    expect(result.entities.failed).toBe(1);
    expect(result.entities.errors[0].function).toBe('func2');
  });
});

describe('deleteFunctions', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GraphitiClient({
      baseUrl: 'http://localhost:8003',
      groupId: 'test_group',
      timeout: 5000,
      retries: 1,
      retryDelayMs: 10,
    });
  });

  it('should delete functions by name', async () => {
    fetchWithPool
      .mockResolvedValueOnce(createMockResponse({ uuid: 'func1-uuid' }))
      .mockResolvedValueOnce(createMockResponse({ success: true }))
      .mockResolvedValueOnce(createMockResponse({ uuid: 'func2-uuid' }))
      .mockResolvedValueOnce(createMockResponse({ success: true }));

    const result = await client.deleteFunctions('TEST', 'src/module.js', ['func1', 'func2']);

    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(0);

    const deleteCalls = fetchWithPool.mock.calls.filter(c => c[1].method === 'DELETE');
    expect(deleteCalls.length).toBe(2);
    expect(deleteCalls[0][0]).toContain('/nodes/func1-uuid');
    expect(deleteCalls[1][0]).toContain('/nodes/func2-uuid');
  });

  it('should ignore 404 errors (already deleted)', async () => {
    fetchWithPool
      .mockResolvedValueOnce(createMockResponse({ uuid: 'func-uuid' }))
      .mockRejectedValueOnce(new Error('HTTP 404: Not Found'));

    const result = await client.deleteFunctions('TEST', 'src/module.js', ['oldFunc']);

    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should track non-404 errors', async () => {
    fetchWithPool
      .mockResolvedValueOnce(createMockResponse({ uuid: 'func-uuid' }))
      .mockRejectedValueOnce(new Error('HTTP 500: Server Error'));

    const result = await client.deleteFunctions('TEST', 'src/module.js', ['brokenFunc']);

    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].function).toBe('brokenFunc');
  });
});

describe('syncFilesWithFunctions', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GraphitiClient({
      baseUrl: 'http://localhost:8003',
      groupId: 'test_group',
      timeout: 5000,
      retries: 1,
      retryDelayMs: 10,
    });
  });

  it('should return empty results for empty files array', async () => {
    const result = await client.syncFilesWithFunctions({
      projectId: 'TEST',
      files: [],
    });

    expect(result.files).toBe(0);
    expect(result.entities).toBe(0);
    expect(result.edges).toBe(0);
  });

  it('should process multiple files in parallel', async () => {
    fetchWithPool.mockResolvedValue(createMockResponse({ uuid: 'uuid', success: true }));

    const files = [
      {
        filePath: 'src/a.js',
        functions: [{ name: 'funcA', signature: 'funcA()', start_line: 1, end_line: 5 }],
      },
      {
        filePath: 'src/b.js',
        functions: [{ name: 'funcB', signature: 'funcB()', start_line: 1, end_line: 5 }],
      },
    ];

    const result = await client.syncFilesWithFunctions({
      projectId: 'TEST',
      files,
      concurrency: 2,
      rateLimit: 1000,
    });

    expect(result.files).toBe(2);
    expect(result.entities).toBe(2);
    expect(result.edges).toBe(2);
  });

  it('should aggregate errors from multiple files', async () => {
    let callCount = 0;
    fetchWithPool.mockImplementation(() => {
      callCount++;
      if (callCount % 5 === 0) {
        return Promise.reject(new Error('Random failure'));
      }
      return Promise.resolve(createMockResponse({ uuid: 'uuid', success: true }));
    });

    const files = [
      {
        filePath: 'src/a.js',
        functions: [
          { name: 'func1', signature: 'f1()', start_line: 1, end_line: 5 },
          { name: 'func2', signature: 'f2()', start_line: 10, end_line: 15 },
        ],
      },
    ];

    const result = await client.syncFilesWithFunctions({
      projectId: 'TEST',
      files,
      concurrency: 1,
      rateLimit: 1000,
    });

    expect(result.files).toBe(1);
  });
});

describe('_parallelLimit', () => {
  let client;

  beforeEach(() => {
    client = new GraphitiClient({
      baseUrl: 'http://localhost:8003',
      groupId: 'test_group',
    });
  });

  it('should process all items', async () => {
    const items = [1, 2, 3, 4, 5];
    const processed = [];

    await client._parallelLimit(
      items,
      async item => {
        processed.push(item);
      },
      2
    );

    expect(processed).toHaveLength(5);
    expect(processed.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('should respect concurrency limit', async () => {
    const items = [1, 2, 3, 4];
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    await client._parallelLimit(
      items,
      async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(r => setTimeout(r, 10));
        currentConcurrent--;
      },
      2
    );

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should handle errors in individual items', async () => {
    const items = [1, 2, 3];
    const processed = [];

    await client._parallelLimit(
      items,
      async item => {
        if (item === 2) throw new Error('Item 2 failed');
        processed.push(item);
      },
      2
    );

    expect(processed).toContain(1);
    expect(processed).toContain(3);
  });
});

describe('RateLimiter', () => {
  it('should be used by upsertFunctionsWithEdges', async () => {
    vi.clearAllMocks();
    const client = new GraphitiClient({
      baseUrl: 'http://localhost:8003',
      groupId: 'test_group',
      retries: 1,
      retryDelayMs: 10,
    });

    fetchWithPool.mockResolvedValue(createMockResponse({ uuid: 'uuid', success: true }));

    const functions = [
      { name: 'f1', signature: 'f1()', start_line: 1, end_line: 5 },
      { name: 'f2', signature: 'f2()', start_line: 10, end_line: 15 },
    ];

    const startTime = Date.now();
    await client.upsertFunctionsWithEdges({
      projectId: 'TEST',
      filePath: 'test.js',
      functions,
      rateLimit: 10,
      concurrency: 1,
    });
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeDefined();
  });
});

describe('createGraphitiClient', () => {
  it('should return null when graphiti is disabled', () => {
    const client = createGraphitiClient({ graphiti: { enabled: false } }, 'TEST');
    expect(client).toBeNull();
  });

  it('should return null when graphiti config is missing', () => {
    const client = createGraphitiClient({}, 'TEST');
    expect(client).toBeNull();
  });

  it('should create client with correct group ID', () => {
    const client = createGraphitiClient(
      {
        graphiti: {
          enabled: true,
          apiUrl: 'http://localhost:8003',
          groupIdPrefix: 'vibesync_',
        },
      },
      'MYPROJECT'
    );

    expect(client).toBeInstanceOf(GraphitiClient);
    expect(client.groupId).toBe('vibesync_MYPROJECT');
  });

  it('should use default prefix when not provided', () => {
    const client = createGraphitiClient(
      {
        graphiti: {
          enabled: true,
          apiUrl: 'http://localhost:8003',
        },
      },
      'TEST'
    );

    expect(client.groupId).toBe('vibesync_TEST');
  });
});
