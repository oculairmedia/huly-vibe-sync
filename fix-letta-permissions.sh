#!/bin/bash

# Fix .letta directory ownership for huly-vibe-sync
# Ensures directories are owned by mcp-user (UID 1000) to match container user

echo "Fixing .letta directory ownership..."

find /opt/stacks -name ".letta" -type d 2>/dev/null | while read lettaDir; do
  echo "  Fixing: $lettaDir"
  sudo chown -R 1000:1000 "$lettaDir"
done

echo ""
echo "Done. Fixed directories:"
find /opt/stacks -name ".letta" -type d -user 1000 2>/dev/null | wc -l
