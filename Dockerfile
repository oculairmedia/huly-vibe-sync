# =============================================================================
# Stage 1: Install Node.js production dependencies (with native compilation)
# =============================================================================
FROM node:20-alpine AS node-builder

# Native deps needed to compile better-sqlite3, etc.
RUN apk add --no-cache make g++ python3

WORKDIR /build
COPY package*.json ./
RUN npm ci --production

# =============================================================================
# Stage 2: Install Python tree-sitter dependencies
# =============================================================================
FROM node:20-alpine AS python-builder

RUN apk add --no-cache python3 py3-pip

COPY python/requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages --prefix=/python-deps -r /tmp/requirements.txt

# =============================================================================
# Stage 3: Runtime image
# =============================================================================
FROM node:20-alpine AS runtime

LABEL maintainer="Oculair Media"
LABEL description="Vibesync project registry and PM-agent coordination service"

# Runtime-only system packages.
# gcompat keeps glibc-linked helper binaries such as Beads runnable on Alpine.
RUN apk add --no-cache git curl bash python3 gcompat

# Copy Python packages from builder
COPY --from=python-builder /python-deps /usr

WORKDIR /app

# Copy node_modules from builder
COPY --from=node-builder /build/node_modules ./node_modules

# Copy package files (needed at runtime for version info, etc.)
COPY package*.json ./

# Copy application files
COPY index.js ./
COPY lib ./lib
COPY python ./python
COPY *.md ./

# Copy Letta configuration (shared settings, local state will be generated)
COPY .letta ./.letta

# Create logs directory and ensure writable by node user
RUN mkdir -p /app/logs && \
    chown -R node:node /app /app/.letta /app/logs && \
    chmod -R 755 /app/.letta

# Configure git identity and safe directory as node user (UID 1000)
USER node
RUN git config --global user.email "vibesync@oculairmedia.com" && \
    git config --global user.name "Vibesync Service" && \
    git config --global --add safe.directory '*'

# Health check - query the /health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${HEALTH_PORT:-3099}/health | grep -q '"status": "healthy"' || exit 1

# Run as node user (UID 1000) — matches host mcp-user for correct file ownership
USER node

# Default command
CMD ["node", "index.js"]
