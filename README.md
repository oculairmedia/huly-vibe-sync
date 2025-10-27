# Huly-Vibe Sync Service

Bidirectional synchronization service between [Huly](https://huly.io) and [Vibe Kanban](https://github.com/oculairmedia/vibe-kanban) using the Model Context Protocol (MCP).

## Features

- ✅ **Bidirectional Sync**: Projects and issues from Huly → Tasks in Vibe Kanban
- ✅ **Full Description Support**: Multi-line issue descriptions preserved with all formatting
- ✅ **Status Synchronization**: Task status changes sync both ways
- ✅ **Filesystem Path Mapping**: Automatic project path detection from Huly descriptions
- ✅ **Configurable Intervals**: Run once, continuous sync, or on-demand
- ✅ **Docker Support**: Fully containerized with health checks
- ✅ **MCP Protocol**: Uses Model Context Protocol for reliable communication

## Quick Start

### Using Docker (Recommended)

```bash
cd /opt/stacks/huly-vibe-sync
cp .env.example .env
docker-compose up -d
docker-compose logs -f
```

See full documentation in [/opt/stacks/huly-vibe-sync/README.md](./README.md)
