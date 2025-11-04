#!/bin/bash
# Complete cleanup of all Letta files, folders, and sources

set -e

API_URL="${LETTA_BASE_URL}/v1"
if [[ ! "$API_URL" =~ /v1$ ]]; then
    API_URL="${LETTA_BASE_URL}/v1"
fi

TOKEN="${LETTA_PASSWORD}"

echo "=== Complete Letta File Storage Cleanup ==="
echo "API URL: $API_URL"
echo ""

# Step 1: Delete all sources
echo "[1/2] Deleting all sources..."
SOURCES=$(curl -s -X GET "${API_URL}/sources?limit=200" -H "Authorization: Bearer ${TOKEN}")
SOURCE_COUNT=$(echo "$SOURCES" | jq 'length')
echo "Found $SOURCE_COUNT sources to delete"

DELETED_SOURCES=0
ERROR_SOURCES=0

echo "$SOURCES" | jq -r '.[] | @json' | while IFS= read -r source_json; do
    ID=$(echo "$source_json" | jq -r '.id')
    NAME=$(echo "$source_json" | jq -r '.name')
    
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
        "${API_URL}/sources/${ID}" \
        -H "Authorization: Bearer ${TOKEN}")
    
    if [[ "$HTTP_CODE" == "204" || "$HTTP_CODE" == "200" ]]; then
        echo "  ✓ Deleted source: $NAME"
        ((DELETED_SOURCES++)) || true
    else
        echo "  ✗ Failed to delete source $NAME (HTTP $HTTP_CODE)"
        ((ERROR_SOURCES++)) || true
    fi
done

echo ""
echo "Sources deleted: $DELETED_SOURCES, errors: $ERROR_SOURCES"
echo ""

# Step 2: Delete all folders (same endpoint as sources in Letta)
echo "[2/2] Deleting all folders..."
FOLDERS=$(curl -s -X GET "${API_URL}/folders?limit=200" -H "Authorization: Bearer ${TOKEN}")
FOLDER_COUNT=$(echo "$FOLDERS" | jq 'length')
echo "Found $FOLDER_COUNT folders to delete"

DELETED_FOLDERS=0
ERROR_FOLDERS=0

echo "$FOLDERS" | jq -r '.[] | @json' | while IFS= read -r folder_json; do
    ID=$(echo "$folder_json" | jq -r '.id')
    NAME=$(echo "$folder_json" | jq -r '.name')
    
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
        "${API_URL}/folders/${ID}" \
        -H "Authorization: Bearer ${TOKEN}")
    
    if [[ "$HTTP_CODE" == "204" || "$HTTP_CODE" == "200" ]]; then
        echo "  ✓ Deleted folder: $NAME"
        ((DELETED_FOLDERS++)) || true
    else
        echo "  ✗ Failed to delete folder $NAME (HTTP $HTTP_CODE)"
        ((ERROR_FOLDERS++)) || true
    fi
done

echo ""
echo "Folders deleted: $DELETED_FOLDERS, errors: $ERROR_FOLDERS"
echo ""

# Verify cleanup
echo "=== Verification ==="
REMAINING_SOURCES=$(curl -s -X GET "${API_URL}/sources?limit=200" -H "Authorization: Bearer ${TOKEN}" | jq 'length')
REMAINING_FOLDERS=$(curl -s -X GET "${API_URL}/folders?limit=200" -H "Authorization: Bearer ${TOKEN}" | jq 'length')

echo "Remaining sources: $REMAINING_SOURCES"
echo "Remaining folders: $REMAINING_FOLDERS"

if [[ "$REMAINING_SOURCES" == "0" && "$REMAINING_FOLDERS" == "0" ]]; then
    echo ""
    echo "✓ Cleanup complete! All files removed from Letta."
else
    echo ""
    echo "⚠️  Some items remain. May need manual cleanup."
fi
