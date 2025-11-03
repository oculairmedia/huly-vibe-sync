#!/bin/bash
set -e

echo "=== SearXNG Worker Recycling Fix ==="
echo ""

# Backup current config
echo "1. Backing up current uwsgi.ini..."
cd /opt/stacks/searxng/config
BACKUP_FILE="uwsgi.ini.backup-$(date +%Y%m%d-%H%M%S)"
cp uwsgi.ini "$BACKUP_FILE"
echo "   ✓ Backed up to: $BACKUP_FILE"

# Show differences
echo ""
echo "2. Configuration changes:"
echo "   Before (problematic settings):"
grep -E "max-requests|max-worker-lifetime|reload-on-rss|workers|threads" uwsgi.ini | sed 's/^/      /'

# Apply new configuration
echo ""
echo "3. Applying new configuration..."
mv uwsgi.ini.new uwsgi.ini
echo "   ✓ Applied optimized uwsgi.ini"

echo ""
echo "   After (optimized settings):"
grep -E "workers|threads|enable-threads|buffer-size|offload-threads" uwsgi.ini | sed 's/^/      /'

# Restart SearXNG
echo ""
echo "4. Restarting SearXNG container..."
cd /opt/stacks/searxng
docker-compose restart searxng

echo ""
echo "=== Fix Applied Successfully ==="
echo ""
echo "Monitor with:"
echo "  docker logs -f searxng_app"
echo ""
echo "Verify no worker restarts:"
echo "  docker logs searxng_app --since 5m | grep Respawned"
