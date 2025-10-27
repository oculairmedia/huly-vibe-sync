# Huly-Vibe Sync Service

[![Build and Push Docker Image](https://github.com/oculairmedia/huly-vibe-sync/actions/workflows/docker-build.yml/badge.svg)](https://github.com/oculairmedia/huly-vibe-sync/actions/workflows/docker-build.yml)

Bidirectional synchronization service between [Huly](https://huly.io) and [Vibe Kanban](https://github.com/oculairmedia/vibe-kanban) using the Model Context Protocol (MCP).

## Features

- ✅ **Bidirectional Sync**: Projects and issues from Huly → Tasks in Vibe Kanban
- ✅ **REST API Integration**: Fast, efficient Huly REST API client for optimal performance
- ✅ **Incremental Sync**: Only fetches issues modified since last sync (timestamp-based)
- ✅ **Full Description Support**: Multi-line issue descriptions preserved with all formatting
- ✅ **Status Synchronization**: Task status changes sync both ways
- ✅ **Filesystem Path Mapping**: Automatic project path detection from Huly descriptions
- ✅ **Configurable Intervals**: Run once, continuous sync, or on-demand
- ✅ **Docker Support**: Fully containerized with health checks
- ✅ **MCP Fallback**: Optional MCP protocol support for backwards compatibility

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

## Full Documentation

See comprehensive documentation in [BookStack](https://docs.oculair.ca) under "MCP Integration Research" → "Huly-Vibe Bidirectional Sync Service"
