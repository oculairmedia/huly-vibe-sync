/**
 * Mock Factories for Letta API Responses
 * 
 * Provides reusable mock data for Letta API testing
 */

/**
 * Create a mock Letta agent
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock agent object
 */
export function createMockLettaAgent(overrides = {}) {
  return {
    id: overrides.id || 'agent-123',
    name: overrides.name || 'Test-Agent',
    description: overrides.description || 'Test agent description',
    system: overrides.system || 'You are a helpful assistant.',
    tools: overrides.tools || [],
    sources: overrides.sources || [],
    metadata: overrides.metadata || {},
    created_at: overrides.created_at || new Date(Date.now() - 86400000).toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock Letta tool
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock tool object
 */
export function createMockLettaTool(overrides = {}) {
  return {
    id: overrides.id || 'tool-123',
    name: overrides.name || 'test_tool',
    description: overrides.description || 'Test tool',
    source_type: overrides.source_type || 'json',
    source_code: overrides.source_code || 'function test() {}',
    tags: overrides.tags || [],
    ...overrides,
  };
}

/**
 * Create a mock Letta source
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock source object
 */
export function createMockLettaSource(overrides = {}) {
  return {
    id: overrides.id || 'source-123',
    name: overrides.name || 'test-source',
    description: overrides.description || 'Test source',
    created_at: overrides.created_at || new Date(Date.now() - 86400000).toISOString(),
    embedding_config: overrides.embedding_config || { model: 'letta/letta-free' },
    ...overrides,
  };
}

/**
 * Create a mock Letta folder
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock folder object
 */
export function createMockLettaFolder(overrides = {}) {
  return {
    id: overrides.id || 'folder-123',
    name: overrides.name || 'test-folder',
    created_at: overrides.created_at || new Date(Date.now() - 86400000).toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock Letta memory block
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock memory block object
 */
export function createMockLettaMemoryBlock(overrides = {}) {
  return {
    id: overrides.id || 'block-123',
    label: overrides.label || 'test_block',
    value: overrides.value || 'Test memory content',
    limit: overrides.limit || 2000,
    ...overrides,
  };
}

/**
 * Create a mock list agents response
 * @param {Array|number} agents - Array of agents or count
 * @returns {Array} Mock agents array
 */
export function createMockListAgentsResponse(agents = []) {
  if (Array.isArray(agents)) {
    return agents;
  }
  
  return Array.from({ length: agents }, (_, i) =>
    createMockLettaAgent({
      id: `agent-${i + 1}`,
      name: `Agent-${i + 1}`,
    })
  );
}

/**
 * Create a mock list tools response
 * @param {Array|number} tools - Array of tools or count
 * @returns {Array} Mock tools array
 */
export function createMockListToolsResponse(tools = []) {
  if (Array.isArray(tools)) {
    return tools;
  }
  
  return Array.from({ length: tools }, (_, i) =>
    createMockLettaTool({
      id: `tool-${i + 1}`,
      name: `tool_${i + 1}`,
    })
  );
}

/**
 * Create a mock create agent response
 * @param {Object} agentData - Agent data
 * @returns {Object} Mock created agent
 */
export function createMockCreateAgentResponse(agentData = {}) {
  return createMockLettaAgent({
    id: agentData.id || `agent-${Date.now()}`,
    ...agentData,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

/**
 * Create a mock attach tool response
 * @param {string} agentId - Agent ID
 * @param {string} toolId - Tool ID
 * @returns {Object} Mock attach response
 */
export function createMockAttachToolResponse(agentId, toolId) {
  return {
    success: true,
    agent_id: agentId,
    tool_id: toolId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a mock detach tool response
 * @param {string} agentId - Agent ID
 * @param {string} toolId - Tool ID
 * @returns {Object} Mock detach response
 */
export function createMockDetachToolResponse(agentId, toolId) {
  return {
    success: true,
    agent_id: agentId,
    tool_id: toolId,
    detached_at: new Date().toISOString(),
  };
}

/**
 * Create a mock upload file response
 * @param {string} sourceId - Source ID
 * @param {string} filename - File name
 * @returns {Object} Mock upload response
 */
export function createMockUploadFileResponse(sourceId, filename) {
  return {
    success: true,
    source_id: sourceId,
    filename,
    uploaded_at: new Date().toISOString(),
  };
}

/**
 * Create a mock error response
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @returns {Object} Mock error response
 */
export function createMockLettaErrorResponse(message, statusCode = 500) {
  return {
    error: {
      message,
      code: statusCode,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a mock 409 conflict response (for file uploads)
 * @param {string} resource - Resource type
 * @param {string} identifier - Resource identifier
 * @returns {Object} Mock conflict response
 */
export function createMock409Response(resource, identifier) {
  return {
    error: {
      message: `${resource} '${identifier}' already exists`,
      code: 409,
      type: 'CONFLICT',
    },
    resource,
    identifier,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a complete mock Letta setup
 * @param {Object} options - Configuration options
 * @returns {Object} Mock setup with agents, tools, sources
 */
export function createMockLettaSetup(options = {}) {
  const controlAgent = createMockLettaAgent({
    id: 'control-agent-id',
    name: options.controlAgentName || 'Huly-PM-Control',
    tools: options.controlTools || ['tool-1', 'tool-2', 'tool-3'],
  });
  
  const pmAgents = Array.from({ length: options.agentCount || 3 }, (_, i) => {
    const identifier = `PROJ${i + 1}`;
    return createMockLettaAgent({
      id: `agent-${identifier}`,
      name: `Huly-PM-${identifier}`,
      metadata: { project: identifier },
      tools: options.inheritTools ? controlAgent.tools : [],
    });
  });
  
  const tools = createMockListToolsResponse(options.toolCount || 5);
  const sources = Array.from({ length: options.sourceCount || 2 }, (_, i) =>
    createMockLettaSource({
      id: `source-${i + 1}`,
      name: `source-${i + 1}`,
    })
  );
  
  return {
    controlAgent,
    pmAgents,
    tools,
    sources,
    allAgents: [controlAgent, ...pmAgents],
  };
}

/**
 * Create mock Letta API responses for nock
 * @param {string} baseUrl - Base URL for mocking
 * @param {Object} options - Mock configuration
 * @returns {Object} Mock configuration for nock
 */
export function createLettaApiMocks(baseUrl, options = {}) {
  return {
    listAgents: {
      url: `${baseUrl}/v1/agents`,
      method: 'GET',
      response: createMockListAgentsResponse(options.agents || []),
    },
    getAgent: (agentId) => ({
      url: `${baseUrl}/v1/agents/${agentId}`,
      method: 'GET',
      response: createMockLettaAgent({ id: agentId, ...options.agent }),
    }),
    createAgent: (agentData) => ({
      url: `${baseUrl}/v1/agents`,
      method: 'POST',
      response: createMockCreateAgentResponse(agentData),
    }),
    listTools: {
      url: `${baseUrl}/v1/tools`,
      method: 'GET',
      response: createMockListToolsResponse(options.tools || []),
    },
    attachTool: (agentId, toolId) => ({
      url: `${baseUrl}/v1/agents/${agentId}/tools/${toolId}`,
      method: 'POST',
      response: createMockAttachToolResponse(agentId, toolId),
    }),
    detachTool: (agentId, toolId) => ({
      url: `${baseUrl}/v1/agents/${agentId}/tools/${toolId}`,
      method: 'DELETE',
      response: createMockDetachToolResponse(agentId, toolId),
    }),
    uploadFile: (sourceId, filename) => ({
      url: `${baseUrl}/v1/sources/${sourceId}/upload`,
      method: 'POST',
      response: createMockUploadFileResponse(sourceId, filename),
    }),
  };
}
