# Huly-Vibe Sync Service

[![Build and Push Docker Image](https://github.com/oculairmedia/huly-vibe-sync/actions/workflows/docker-build.yml/badge.svg)](https://github.com/oculairmedia/huly-vibe-sync/actions/workflows/docker-build.yml)

Bidirectional synchronization service between [Huly](https://huly.io) and [Vibe Kanban](https://github.com/oculairmedia/vibe-kanban) using the Model Context Protocol (MCP).

## Features

- ✅ **Bidirectional Sync**: Huly ↔ Vibe Kanban for project and task state
- ✅ **REST API Integration**: Fast, efficient Huly REST API client for optimal performance
- ✅ **Incremental Sync**: Only fetches issues modified since last sync (timestamp-based)
- ⚡ **Parallel Processing**: Concurrent project sync with configurable workers (default: 5)
- 🚀 **Smart Caching**: Skips empty projects to reduce API load
- ⏱️ **Fast Sync**: 10-second intervals for near real-time updates (~3-5s per cycle)
- ✅ **Full Description Support**: Multi-line issue descriptions preserved with all formatting
- ✅ **Status Synchronization**: Task status changes sync both ways (Huly and Vibe)
- ✅ **Filesystem Path Mapping**: Automatic project path detection from Huly descriptions
- ✅ **Configurable Intervals**: Run once, continuous sync, or on-demand
- ✅ **Docker Support**: Fully containerized with health checks
- ✅ **MCP Fallback**: Optional MCP protocol support for backwards compatibility

## Performance

**Current Configuration (Optimized):**

- **Sync Interval**: 10 seconds (configurable)
- **Incremental Sync Time**: 3-5 seconds (only fetches changed issues)
- **Active Projects**: Processes only ~8-10 projects with issues (skips 30+ empty)
- **Parallel Workers**: 5 concurrent project syncs
- **Near Real-Time**: Changes sync within 10-15 seconds

**Previous (Sequential):**

- Sync Interval: 30 seconds
- Full Sync Time: 25-30 seconds
- All 44 projects processed sequentially

## Quick Start

### Using Pre-built Docker Image (Recommended)

```bash
# Pull the latest image from GitHub Container Registry
docker pull ghcr.io/oculairmedia/huly-vibe-sync:latest

# Or use docker-compose with the pre-built image
cd /opt/stacks/huly-vibe-sync
cp .env.example .env
# Edit docker-compose.yml to use: image: ghcr.io/oculairmedia/huly-vibe-sync:latest
docker-compose up -d
docker-compose logs -f
```

### Building from Source

```bash
cd /opt/stacks/huly-vibe-sync
cp .env.example .env
docker-compose build
docker-compose up -d
docker-compose logs -f
```

## Docker Images

Pre-built Docker images are automatically published to GitHub Container Registry:

- **Latest (main branch)**: `ghcr.io/oculairmedia/huly-vibe-sync:latest`
- **Develop branch**: `ghcr.io/oculairmedia/huly-vibe-sync:develop`
- **Tagged releases**: `ghcr.io/oculairmedia/huly-vibe-sync:v1.0.0`
- **Commit SHA**: `ghcr.io/oculairmedia/huly-vibe-sync:main-<sha>`

Images are built for both `linux/amd64` and `linux/arm64` platforms.

## Configuration

### Environment Variables

See `.env.example` for all available options. Key settings:

```bash
# Core Settings
HULY_API_URL=http://192.168.50.90:3457/api
HULY_USE_REST=true
VIBE_MCP_URL=http://192.168.50.90:9717/mcp

# Sync Behavior
SYNC_INTERVAL=10000           # 10 seconds (default: 10000ms)
INCREMENTAL_SYNC=true         # Only fetch changed issues
PARALLEL_SYNC=true            # Process projects concurrently
MAX_WORKERS=5                 # Max concurrent API calls
SKIP_EMPTY_PROJECTS=true      # Skip projects with 0 issues

# Dry Run Mode
DRY_RUN=false                 # Set to true for testing
```

### Performance Tuning

**For faster sync:**

- Reduce `SYNC_INTERVAL` to 5000 (5 seconds) or 3000 (3 seconds)
- Increase `MAX_WORKERS` to 8-10 (monitor API load)
- Enable `SKIP_EMPTY_PROJECTS=true` (recommended)

**For lower API load:**

- Increase `SYNC_INTERVAL` to 30000 (30 seconds) or higher
- Reduce `MAX_WORKERS` to 3
- Set `PARALLEL_SYNC=false` for sequential processing

**Monitor performance:**

```bash
docker logs huly-vibe-sync 2>&1 | grep "Slow tool execution"
docker logs huly-vibe-sync 2>&1 | grep "sync completed"
```

## Documentation

### 📚 Local Documentation

Comprehensive documentation is organized in the [`docs/`](./docs/) directory:

- **[Documentation Index](./docs/README.md)** - Complete documentation overview
- **[API Reference](./docs/api/)** - API specifications and integration guides
- **[Architecture](./docs/architecture/)** - System design and architecture
- **[Guides](./docs/guides/)** - Deployment, testing, and agent management
- **[Deployment Guide](./DEPLOYMENT.md)** - Quick deployment reference
- **[Testing Guide](./TESTING.md)** - Testing documentation

### 🌐 External Documentation

See comprehensive documentation in [BookStack](https://docs.oculair.ca) under "MCP Integration Research" → "Huly-Vibe Bidirectional Sync Service"

## Project Registry API

### Register a project

`POST /api/registry/projects`

Request body:

```json
{
  "filesystem_path": "/opt/stacks/letta-mobile-bz40.2.8",
  "name": "Letta Mobile",
  "git_url": "https://github.com/oculairmedia/letta-mobile-bz40.2.8.git"
}
```

- `filesystem_path` is required and must be an absolute path
- `name` and `git_url` are optional
- the path must exist and be a git repository

### Update a project

`PATCH /api/registry/projects/:id`

Request body:

```json
{
  "filesystem_path": "/opt/stacks/letta-mobile",
  "git_url": "https://github.com/oculairmedia/letta-mobile.git"
}
```

- `filesystem_path` must be absolute when provided
- existing fields are preserved when omitted
- returns the updated project row

## CLI usage

Register a project:

```bash
npm run vibesync -- project-register /opt/stacks/letta-mobile-bz40.2.8 \
  --name "Letta Mobile" \
  --git-url "https://github.com/oculairmedia/letta-mobile-bz40.2.8.git"
```

Update project path or git URL:

```bash
npm run vibesync -- project-update LETTAMOBILE \
  --filesystem-path /opt/stacks/letta-mobile \
  --git-url "https://github.com/oculairmedia/letta-mobile.git"
```
