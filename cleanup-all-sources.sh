#!/bin/bash
# Cleanup all sources/folders from Letta using direct REST API

set -e

API_URL="${LETTA_BASE_URL}/v1"
TOKEN="${LETTA_PASSWORD}"

echo "=== Letta Source/Folder Cleanup (Direct REST API) ===="
echo ""

# Get all sources
echo "[1/2] Fetching all sources..."
SOURCES=$(curl -s -X GET "${API_URL}/sources?limit=200" -H "Authorization: Bearer ${TOKEN}")
COUNT=$(echo "$SOURCES" | jq 'length')
echo "Found $COUNT sources/folders"

# Delete each one
echo ""
echo "[2/2] Deleting all sources/folders..."
DELETED=0
ERRORS=0

echo "$SOURCES" | jq -c '.[]' | while read -r source; do
    ID=$(echo "$source" | jq -r '.id')
    NAME=$(echo "$source" | jq -r '.name')
    
    # Try DELETE /v1/sources/{id}
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${API_URL}/sources/${ID}" -H "Authorization: Bearer ${TOKEN}")
    
    if [[ "$HTTP_CODE" == "204" || "$HTTP_CODE" == "200" ]]; then
        echo "  ✓ Deleted: $NAME ($ID)"
        ((DELETED++))
    else
        echo "  ✗ Failed ($HTTP_CODE): $NAME ($ID)"
        ((ERRORS++))
    fi
done

echo ""
echo "=== Cleanup Complete ==="
echo "Deleted: $DELETED"
echo "Errors: $ERRORS"
