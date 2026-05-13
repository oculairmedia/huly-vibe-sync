/**
 * Mock Factories for Letta API Responses
 *
 * Provides reusable mock data for Letta API testing
 */

interface LettaAgent {
  id: string;
  name: string;
  description: string;
  system: string;
  tools: string[];
  sources: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface LettaTool {
  id: string;
  name: string;
  description: string;
  source_type: string;
  source_code: string;
  tags: string[];
}

interface LettaSource {
  id: string;
  name: string;
  description: string;
  created_at: string;
  embedding_config: { model: string };
}

interface LettaFolder {
  id: string;
  name: string;
  created_at: string;
}

interface LettaMemoryBlock {
  id: string;
  label: string;
  value: string;
  limit: number;
}

/**
 * Create a mock Letta agent
 * @param overrides - Properties to override
 * @returns Mock agent object
 */
export function createMockLettaAgent(overrides: Partial<LettaAgent> = {}): LettaAgent {
  return {
    id: overrides.id ?? 'agent-123',
    name: overrides.name ?? 'Test-Agent',
    description: overrides.description ?? 'Test agent description',
    system: overrides.system ?? 'You are a helpful assistant.',
    tools: overrides.tools ?? [],
    sources: overrides.sources ?? [],
    metadata: overrides.metadata ?? {},
    created_at: overrides.created_at ?? new Date(Date.now() - 86400000).toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
  };
}

/**
 * Create a mock Letta tool
 * @param overrides - Properties to override
 * @returns Mock tool object
 */
export function createMockLettaTool(overrides: Partial<LettaTool> = {}): LettaTool {
  return {
    id: overrides.id ?? 'tool-123',
    name: overrides.name ?? 'test_tool',
    description: overrides.description ?? 'Test tool',
    source_type: overrides.source_type ?? 'json',
    source_code: overrides.source_code ?? 'function test() {}',
    tags: overrides.tags ?? [],
  };
}

/**
 * Create a mock Letta source
 * @param overrides - Properties to override
 * @returns Mock source object
 */
export function createMockLettaSource(overrides: Partial<LettaSource> = {}): LettaSource {
  return {
    id: overrides.id ?? 'source-123',
    name: overrides.name ?? 'test-source',
    description: overrides.description ?? 'Test source',
    created_at: overrides.created_at ?? new Date(Date.now() - 86400000).toISOString(),
    embedding_config: overrides.embedding_config ?? { model: 'letta/letta-free' },
  };
}

/**
 * Create a mock Letta folder
 * @param overrides - Properties to override
 * @returns Mock folder object
 */
export function createMockLettaFolder(overrides: Partial<LettaFolder> = {}): LettaFolder {
  return {
    id: overrides.id ?? 'folder-123',
    name: overrides.name ?? 'test-folder',
    created_at: overrides.created_at ?? new Date(Date.now() - 86400000).toISOString(),
  };
}

/**
 * Create a mock Letta memory block
 * @param overrides - Properties to override
 * @returns Mock memory block object
 */
export function createMockLettaMemoryBlock(overrides: Partial<LettaMemoryBlock> = {}): LettaMemoryBlock {
  return {
    id: overrides.id ?? 'block-123',
    label: overrides.label ?? 'test_block',
    value: overrides.value ?? 'Test memory content',
    limit: overrides.limit ?? 2000,
  };
}

/**
 * Create a mock list agents response
 * @param agents - Array of agents or count
 * @returns Mock agents array
 */
export function createMockListAgentsResponse(agents: LettaAgent[] | number = []): LettaAgent[] {
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
 * @param tools - Array of tools or count
 * @returns Mock tools array
 */
export function createMockListToolsResponse(tools: LettaTool[] | number = []): LettaTool[] {
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
 * @param agentData - Agent data
 * @returns Mock created agent
 */
export function createMockCreateAgentResponse(agentData: Partial<LettaAgent> = {}): LettaAgent {
  return createMockLettaAgent({
    id: agentData.id ?? `agent-${Date.now()}`,
    ...agentData,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

/**
 * Create a mock attach tool response
 * @param agentId - Agent ID
 * @param toolId - Tool ID
 * @returns Mock attach response
 */
export function createMockAttachToolResponse(agentId: string, toolId: string): Record<string, unknown> {
  return {
    success: true,
    agent_id: agentId,
    tool_id: toolId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a mock detach tool response
 * @param agentId - Agent ID
 * @param toolId - Tool ID
 * @returns Mock detach response
 */
export function createMockDetachToolResponse(agentId: string, toolId: string): Record<string, unknown> {
  return {
    success: true,
    agent_id: agentId,
    tool_id: toolId,
    detached_at: new Date().toISOString(),
  };
}

/**
 * Create a mock upload file response
 * @param sourceId - Source ID
 * @param filename - File name
 * @returns Mock upload response
 */
export function createMockUploadFileResponse(sourceId: string, filename: string): Record<string, unknown> {
  return {
    success: true,
    source_id: sourceId,
    filename,
    uploaded_at: new Date().toISOString(),
  };
}

/**
 * Create a mock error response
 * @param message - Error message
 * @param statusCode - HTTP status code
 * @returns Mock error response
 */
export function createMockLettaErrorResponse(message: string, statusCode = 500): Record<string, unknown> {
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
 * @param resource - Resource type
 * @param identifier - Resource identifier
 * @returns Mock conflict response
 */
export function createMock409Response(resource: string, identifier: string): Record<string, unknown> {
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

interface MockLettaSetupOptions {
  controlAgentName?: string;
  controlTools?: string[];
  agentCount?: number;
  inheritTools?: boolean;
  toolCount?: number;
  sourceCount?: number;
}

/**
 * Create a complete mock Letta setup
 * @param options - Configuration options
 * @returns Mock setup with agents, tools, sources
 */
export function createMockLettaSetup(options: MockLettaSetupOptions = {}): {
  controlAgent: LettaAgent;
  pmAgents: LettaAgent[];
  tools: LettaTool[];
  sources: LettaSource[];
  allAgents: LettaAgent[];
} {
  const controlAgent = createMockLettaAgent({
    id: 'control-agent-id',
    name: options.controlAgentName ?? 'PM-Control',
    tools: options.controlTools ?? ['tool-1', 'tool-2', 'tool-3'],
  });

  const pmAgents = Array.from({ length: options.agentCount ?? 3 }, (_, i) => {
    const identifier = `PROJ${i + 1}`;
    return createMockLettaAgent({
      id: `agent-${identifier}`,
      name: `PM-${identifier}`,
      metadata: { project: identifier },
      tools: options.inheritTools ? controlAgent.tools : [],
    });
  });

  const tools = createMockListToolsResponse(options.toolCount ?? 5);
  const sources = Array.from({ length: options.sourceCount ?? 2 }, (_, i) =>
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

interface LettaApiMockOptions {
  agents?: LettaAgent[];
  agent?: Partial<LettaAgent>;
  tools?: LettaTool[];
}

/**
 * Create mock Letta API responses for nock
 * @param baseUrl - Base URL for mocking
 * @param options - Mock configuration
 * @returns Mock configuration for nock
 */
export function createLettaApiMocks(baseUrl: string, options: LettaApiMockOptions = {}): {
  listAgents: { url: string; method: string; response: LettaAgent[] };
  getAgent: (agentId: string) => { url: string; method: string; response: LettaAgent };
  createAgent: (agentData: Partial<LettaAgent>) => { url: string; method: string; response: LettaAgent };
  listTools: { url: string; method: string; response: LettaTool[] };
  attachTool: (agentId: string, toolId: string) => { url: string; method: string; response: Record<string, unknown> };
  detachTool: (agentId: string, toolId: string) => { url: string; method: string; response: Record<string, unknown> };
  uploadFile: (sourceId: string, filename: string) => { url: string; method: string; response: Record<string, unknown> };
} {
  return {
    listAgents: {
      url: `${baseUrl}/v1/agents`,
      method: 'GET',
      response: createMockListAgentsResponse(options.agents ?? []),
    },
    getAgent: (agentId: string) => ({
      url: `${baseUrl}/v1/agents/${agentId}`,
      method: 'GET',
      response: createMockLettaAgent({ id: agentId, ...options.agent }),
    }),
    createAgent: (agentData: Partial<LettaAgent>) => ({
      url: `${baseUrl}/v1/agents`,
      method: 'POST',
      response: createMockCreateAgentResponse(agentData),
    }),
    listTools: {
      url: `${baseUrl}/v1/tools`,
      method: 'GET',
      response: createMockListToolsResponse(options.tools ?? []),
    },
    attachTool: (agentId: string, toolId: string) => ({
      url: `${baseUrl}/v1/agents/${agentId}/tools/${toolId}`,
      method: 'POST',
      response: createMockAttachToolResponse(agentId, toolId),
    }),
    detachTool: (agentId: string, toolId: string) => ({
      url: `${baseUrl}/v1/agents/${agentId}/tools/${toolId}`,
      method: 'DELETE',
      response: createMockDetachToolResponse(agentId, toolId),
    }),
    uploadFile: (sourceId: string, filename: string) => ({
      url: `${baseUrl}/v1/sources/${sourceId}/upload`,
      method: 'POST',
      response: createMockUploadFileResponse(sourceId, filename),
    }),
  };
}
