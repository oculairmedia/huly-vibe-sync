#!/bin/bash

# Cleanup Huly Agents
# Deletes all Huly PM agents from Letta

set -e

LETTA_URL="http://192.168.50.90:8283"
LETTA_PASSWORD="lettaSecurePass123"

echo "🧹 Cleaning up Huly agents from Letta..."
echo

# Get all agents
echo "📋 Fetching agent list..."
AGENTS=$(curl -s "$LETTA_URL/admin/agents" -H "Authorization: Bearer $LETTA_PASSWORD")
TOTAL=$(echo "$AGENTS" | jq 'length')
echo "✓ Found $TOTAL total agents"
echo

# Filter Huly agents
HULY_AGENTS=$(echo "$AGENTS" | jq '[.[] | select(.name | startswith("Huly-"))]')
COUNT=$(echo "$HULY_AGENTS" | jq 'length')

echo "🎯 Found $COUNT Huly agents to delete"
echo

if [ "$COUNT" -eq 0 ]; then
  echo "✅ No Huly agents to delete"
  exit 0
fi

# Show what will be deleted
echo "Agents to delete:"
echo "$HULY_AGENTS" | jq -r '.[] | "  \(.name) - \(.id)"' | head -20
if [ "$COUNT" -gt 20 ]; then
  echo "  ... and $((COUNT - 20)) more"
fi
echo

# Delete agents
echo "🗑️  Deleting agents..."
DELETED=0
ERRORS=0

echo "$HULY_AGENTS" | jq -r '.[].id' | while read -r AGENT_ID; do
  if curl -s -X DELETE "$LETTA_URL/v1/agents/$AGENT_ID" \
       -H "Authorization: Bearer $LETTA_PASSWORD" \
       -o /dev/null -w "%{http_code}" | grep -q "^2"; then
    ((DELETED++)) || true
    echo -ne "\r  ✓ Deleted $DELETED/$COUNT agents"
  else
    ((ERRORS++)) || true
  fi
done

echo
echo
echo "============================================================"
echo "✅ Cleanup complete!"
echo "   Attempted to delete: $COUNT agents"
echo "============================================================"
echo
echo "ℹ️  Next steps:"
echo "   1. Clear the database: rm logs/sync-state.db"
echo "   2. Clear agent mappings: echo '{\"version\":\"1.0.0\",\"agents\":{}}' > .letta/settings.local.json"
echo "   3. Start sync: docker-compose up -d"
echo "   4. Service will automatically create fresh agents for all projects"
echo
