#!/bin/bash

# Fix .letta directory permissions for huly-vibe-sync
# This script makes all .letta directories writable by the sync service

echo "🔧 Fixing .letta directory permissions..."

# List of project paths with permission issues
PROJECTS=(
  "/opt/stacks/augment-mcp-tool"
  "/opt/stacks/bookstack-mcp"
  "/opt/stacks/claude api gateway"
  "/opt/stacks/graphiti"
  "/opt/stacks/huly-selfhost/huly-mcp-server"
  "/opt/stacks/letta-MCP-server"
  "/opt/stacks/letta-opencode-plugin"
  "/opt/stacks/opencode"
  "/opt/stacks/surefinance-mcp-server"
)

for project in "${PROJECTS[@]}"; do
  if [ -d "$project/.letta" ]; then
    echo "  Fixing: $project/.letta"
    sudo chmod 777 "$project/.letta"
    
    # If settings.local.json exists, make it writable
    if [ -f "$project/.letta/settings.local.json" ]; then
      sudo chmod 666 "$project/.letta/settings.local.json"
    fi
  else
    echo "  ⚠️  Not found: $project/.letta"
  fi
done

echo ""
echo "✅ Permission fix complete!"
echo ""
echo "Summary of fixed directories:"
find /opt/stacks -name ".letta" -type d -perm 0777 2>/dev/null | wc -l
