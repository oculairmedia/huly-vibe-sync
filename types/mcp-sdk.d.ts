declare module '@modelcontextprotocol/sdk/server/mcp.js' {
  import { McpServer } from '@modelcontextprotocol/sdk/dist/esm/server/mcp';
  export { McpServer };
}

declare module '@modelcontextprotocol/sdk/server/index.js' {
  import { Server } from '@modelcontextprotocol/sdk/dist/esm/server/index';
  export { Server };
}

declare module '@modelcontextprotocol/sdk/types.js' {
  export * from '@modelcontextprotocol/sdk/dist/esm/types';
}
