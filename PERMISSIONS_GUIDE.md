# Permissions Guide

## Overview

The huly-vibe-sync service runs as the `node` user (UID 1000) inside a Docker container. It needs to write `.letta/settings.local.json` files to project directories across `/opt/stacks` to maintain Letta Code compatibility.

## Permission Requirements

### Service Directories (This Project)
The service's own directories must be writable by the container:

```bash
# Main database and logs
chmod 664 /opt/stacks/huly-vibe-sync/huly-vibe-sync.db
chmod 777 /opt/stacks/huly-vibe-sync/logs/
chmod 664 /opt/stacks/huly-vibe-sync/logs/*.db*

# .letta configuration
chmod 777 /opt/stacks/huly-vibe-sync/.letta/
chmod 666 /opt/stacks/huly-vibe-sync/.letta/settings.local.json
```

### Project Directories (External)
Each Huly project that the service manages needs a writable `.letta` directory:

```bash
# Pattern for each project
sudo chmod 777 /opt/stacks/<project>/.letta/
sudo chmod 666 /opt/stacks/<project>/.letta/settings.local.json  # if exists
```

## Common Issues

### Issue: "EACCES: permission denied, open '.../.letta/settings.local.json'"

**Symptom**: Logs show permission denied errors when writing to project `.letta` directories.

**Impact**: **Non-fatal** - Agent state is still tracked in the main database (`huly-vibe-sync.db`). The only missing functionality is Letta Code CLI integration for that specific project.

**Fix**: Run the provided permission fix script:

```bash
cd /opt/stacks/huly-vibe-sync
./fix-letta-permissions.sh
```

Or manually for a specific project:

```bash
sudo chmod 777 /opt/stacks/<project>/.letta/
```

## Automated Fix Script

The `fix-letta-permissions.sh` script automatically fixes permissions for all known project directories:

```bash
cd /opt/stacks/huly-vibe-sync
./fix-letta-permissions.sh
```

This script:
- Sets `.letta` directories to `777` (world-writable)
- Sets `settings.local.json` files to `666` (world-readable/writable)
- Provides a summary of fixed directories

## Best Practices

### 1. Run Permission Fix After New Project Creation
When adding a new Huly project to the system:

```bash
# Create project in Huly
# Service will auto-create .letta directory
# Run permission fix
cd /opt/stacks/huly-vibe-sync
./fix-letta-permissions.sh
```

### 2. Add Permission Fix to Project Setup Scripts
If you have automated project creation scripts, add:

```bash
# After creating project directory
mkdir -p /opt/stacks/new-project/.letta
chmod 777 /opt/stacks/new-project/.letta
```

### 3. Update fix-letta-permissions.sh for New Projects
Add new project paths to the `PROJECTS` array in `fix-letta-permissions.sh`:

```bash
PROJECTS=(
  "/opt/stacks/augment-mcp-tool"
  "/opt/stacks/your-new-project"  # Add here
  # ... other projects
)
```

## Security Considerations

### Why 777 Permissions?

The `.letta` directories are set to `777` (world-writable) because:

1. **Multi-user environment**: Different projects may be owned by different users
2. **Container isolation**: The Docker container runs as UID 1000 (node user)
3. **Non-sensitive data**: `.letta/settings.local.json` only contains agent IDs (UUIDs)
4. **Gitignored**: These files are never committed to version control

### What's Stored

The `.letta/settings.local.json` files contain:

```json
{
  "lastAgent": "agent-uuid-here"
}
```

This is simply a mapping to the agent ID and contains no secrets or sensitive data.

### Alternative Approaches

If `777` permissions are not acceptable in your environment:

#### Option 1: Use ACLs (Access Control Lists)
```bash
# Grant specific user/group write access
setfacl -m u:node:rwx /opt/stacks/project/.letta/
setfacl -m u:1000:rwx /opt/stacks/project/.letta/
```

#### Option 2: Change Project Ownership
```bash
# Make all project directories owned by the sync service user
sudo chown -R 1000:1000 /opt/stacks/*/
```

#### Option 3: Disable Per-Project Files
Modify `lib/LettaService.js` to skip writing to project directories:

```javascript
// Comment out the _saveAgentIdToProjectFolder() call
// Agent state will only be tracked in main database
```

## Troubleshooting

### Check Current Permissions
```bash
# Check .letta directory permissions
find /opt/stacks -name ".letta" -type d -exec ls -ld {} \;

# Check settings.local.json permissions
find /opt/stacks -name "settings.local.json" -exec ls -l {} \;

# Count writable .letta directories
find /opt/stacks -name ".letta" -type d -perm 0777 2>/dev/null | wc -l
```

### Verify Container User
```bash
docker-compose exec huly-vibe-sync id
# Should show: uid=1000(node) gid=1000(node)
```

### Check for Permission Errors in Logs
```bash
docker-compose logs | grep "permission denied"
docker-compose logs | grep "EACCES"
```

### Test Write Access
```bash
# From inside container
docker-compose exec huly-vibe-sync sh -c 'touch /opt/stacks/test-project/.letta/test.txt'
```

## Recovery

### If Database Becomes Read-Only
```bash
docker-compose down
sudo chown -R mcp-user:mcp-user /opt/stacks/huly-vibe-sync/logs/
sudo chmod 664 /opt/stacks/huly-vibe-sync/logs/*.db*
docker-compose up -d
```

### If .letta Directories Missing
The service will auto-create them on next sync, but they may have wrong permissions:

```bash
# Wait for one sync cycle
sleep 10

# Then fix permissions
cd /opt/stacks/huly-vibe-sync
./fix-letta-permissions.sh
```

## Maintenance

### Regular Tasks
1. **After adding new projects**: Run `./fix-letta-permissions.sh`
2. **After host OS updates**: Verify permissions haven't changed
3. **After Docker rebuild**: Check database file permissions

### Monitoring
Add to your monitoring/alerting:

```bash
# Check for permission errors in last hour
docker-compose logs --since 1h | grep -c "permission denied"

# Alert if > 0
```

## See Also

- `.letta/README.md` - Letta persistence documentation
- `.letta/CONFIGURATION.md` - Configuration reference
- `fix-letta-permissions.sh` - Automated permission fix script
- `CONTROL_AGENT_GUIDE.md` - Control agent documentation
