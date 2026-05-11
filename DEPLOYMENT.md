# Deployment Guide

Complete guide for deploying Vibesync service and dashboard.

## Table of Contents

1. [Quick Start with Docker Compose](#quick-start-with-docker-compose)
2. [Manual Deployment](#manual-deployment)
3. [GitHub Container Registry](#github-container-registry)
4. [Environment Variables](#environment-variables)
5. [Production Considerations](#production-considerations)
6. [Monitoring](#monitoring)

## Quick Start with Docker Compose

The fastest way to run both backend and frontend together.

### Prerequisites

- Docker 20.10+
- Docker Compose 2.0+

### Steps

```bash
# Clone the repository
git clone https://github.com/your-org/vibesync.git
cd vibesync

# Copy environment file
cp .env.docker.example .env

# Edit .env with your configuration
nano .env

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Access

- **Frontend Dashboard**: http://localhost:3000
- **Backend API**: http://localhost:3099
- **Health Check**: http://localhost:3099/health
- **Metrics**: http://localhost:3099/metrics

## Manual Deployment

### Backend Service

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit configuration
nano .env

# Start service
npm start

# Or for development with auto-reload
npm run dev
```

### Frontend Dashboard

```bash
cd ui

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Edit configuration
nano .env.local

# Build for production
npm run build

# Start production server
npm start

# Or for development
npm run dev
```

## GitHub Container Registry

Images are automatically built and pushed to GitHub Container Registry on every push to `main` branch.

### Pull Images

```bash
# Backend
docker pull ghcr.io/your-org/vibesync:latest

# Frontend
docker pull ghcr.io/your-org/vibesync-ui:latest
```

### Authentication

```bash
# Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

### Run Pre-built Images

```bash
# Backend
docker run -d \
  --name vibesync \
  -p 3099:3099 \
  -e REMOVED_API_URL=http://your-legacy-api:3457/api \
  -e VIBE_API_URL=http://your-vibe-api:3105/api \
  -v $(pwd)/logs:/app/logs \
  ghcr.io/your-org/vibesync:latest

# Frontend
docker run -d \
  --name vibesync-ui \
  -p 3000:3000 \
  -e NEXT_PUBLIC_API_URL=http://localhost:3099 \
  ghcr.io/your-org/vibesync-ui:latest
```

## Environment Variables

### Backend (.env)

```bash
# Legacy Configuration
REMOVED_API_URL=http://192.168.50.90:3457/api
REMOVED_USE_REST=true

# Vibe Kanban Configuration
VIBE_API_URL=http://192.168.50.90:3105/api
VIBE_USE_REST=true

# Sync Configuration
SYNC_INTERVAL=300000          # 5 minutes (in milliseconds)
DRY_RUN=false                 # Set to true for testing
INCREMENTAL_SYNC=true         # Only sync changed issues
PARALLEL_SYNC=false           # Process projects in parallel
MAX_WORKERS=5                 # Max concurrent workers
SKIP_EMPTY_PROJECTS=false     # Skip projects with 0 issues
API_DELAY=10                  # Delay between API calls (ms)

# Letta AI Configuration (Optional)
LETTA_BASE_URL=http://localhost:8283
LETTA_PASSWORD=your-password

# Health Check Port
HEALTH_PORT=3099

# Stacks Directory (for git repo detection)
STACKS_DIR=/opt/stacks
```

### Frontend (.env.local)

```bash
# Backend API URL
NEXT_PUBLIC_API_URL=http://localhost:3099

# Application Settings
NEXT_PUBLIC_APP_NAME="Vibesync Dashboard"
NEXT_PUBLIC_POLLING_INTERVAL=5000
```

## Production Considerations

### 1. Resource Requirements

**Backend:**
- CPU: 1-2 cores
- RAM: 512MB - 1GB
- Disk: 100MB (for logs and database)

**Frontend:**
- CPU: 0.5-1 core
- RAM: 256MB - 512MB
- Disk: 50MB

### 2. Security

```bash
# Use secrets for sensitive data
docker secret create legacy_api_url -
docker secret create letta_password -

# Run with read-only filesystem
docker run --read-only \
  --tmpfs /tmp \
  --tmpfs /app/logs \
  ghcr.io/your-org/vibesync:latest
```

### 3. Networking

```yaml
# docker-compose.yml with custom network
networks:
  legacy-vibe-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/16
```

### 4. Logging

```bash
# Configure log rotation
docker run \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  ghcr.io/your-org/vibesync:latest
```

### 5. Health Checks

```bash
# Kubernetes liveness probe
livenessProbe:
  httpGet:
    path: /health
    port: 3099
  initialDelaySeconds: 10
  periodSeconds: 30

# Kubernetes readiness probe
readinessProbe:
  httpGet:
    path: /health
    port: 3099
  initialDelaySeconds: 5
  periodSeconds: 10
```

## Monitoring

### Prometheus Integration

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'vibesync'
    static_configs:
      - targets: ['localhost:3099']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

### Grafana Dashboard

Import the included Grafana dashboard:

```bash
# Located at: docs/grafana-dashboard.json
```

Key metrics:
- Sync success rate
- API latency (Legacy & Vibe)
- Memory usage
- Connection pool status
- Error count

### Alerts

```yaml
# Prometheus alerts
groups:
  - name: vibesync
    rules:
      - alert: SyncFailureRate
        expr: rate(sync_runs_total{status="error"}[5m]) > 0.1
        annotations:
          summary: "High sync failure rate"

      - alert: HighMemoryUsage
        expr: memory_usage_bytes{type="rss"} > 1000000000
        annotations:
          summary: "Memory usage above 1GB"
```

## Kubernetes Deployment

### Backend Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vibesync
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vibesync
  template:
    metadata:
      labels:
        app: vibesync
    spec:
      containers:
      - name: sync
        image: ghcr.io/your-org/vibesync:latest
        ports:
        - containerPort: 3099
          name: health
        env:
        - name: REMOVED_API_URL
          valueFrom:
            configMapKeyRef:
              name: sync-config
              key: legacy_api_url
        - name: VIBE_API_URL
          valueFrom:
            configMapKeyRef:
              name: sync-config
              key: vibe_api_url
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3099
          initialDelaySeconds: 10
          periodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: vibesync
spec:
  selector:
    app: vibesync
  ports:
  - port: 3099
    targetPort: 3099
    name: health
```

### Frontend Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vibesync-ui
spec:
  replicas: 2
  selector:
    matchLabels:
      app: vibesync-ui
  template:
    metadata:
      labels:
        app: vibesync-ui
    spec:
      containers:
      - name: ui
        image: ghcr.io/your-org/vibesync-ui:latest
        ports:
        - containerPort: 3000
          name: http
        env:
        - name: NEXT_PUBLIC_API_URL
          value: "http://vibesync:3099"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: vibesync-ui
spec:
  type: LoadBalancer
  selector:
    app: vibesync-ui
  ports:
  - port: 80
    targetPort: 3000
    name: http
```

## Troubleshooting

### Backend Issues

```bash
# Check logs
docker logs vibesync

# Check health
curl http://localhost:3099/health

# Check metrics
curl http://localhost:3099/metrics
```

### Frontend Issues

```bash
# Check logs
docker logs vibesync-ui

# Check build logs
docker build --progress=plain ./ui

# Test API connection
curl http://localhost:3000/api/health
```

### Database Issues

```bash
# Reset sync state
rm logs/sync-state.db

# Restart service
docker-compose restart backend
```

## Backup & Recovery

### Backup

```bash
# Backup sync state database
docker cp vibesync:/app/logs/sync-state.db ./backup/

# Backup logs
docker cp vibesync:/app/logs ./backup/logs/
```

### Restore

```bash
# Restore database
docker cp ./backup/sync-state.db vibesync:/app/logs/

# Restart service
docker restart vibesync
```

## Support

For deployment issues:
- Check logs: `docker logs vibesync`
- Review health endpoint: `/health`
- Open GitHub issue with logs and configuration (redact secrets!)

---

**Last Updated**: 2025-11-11
**Version**: 1.0.0
