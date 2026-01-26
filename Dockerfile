FROM node:20-alpine

LABEL maintainer="Oculair Media"
LABEL description="Huly to Vibe Kanban bidirectional sync service with Letta Code support"

# Install build dependencies for better-sqlite3 and other native modules
# Also install bash for Letta Code shell operations, Go for beads, and pip for Tree-sitter
RUN apk add --no-cache \
    git \
    curl \
    bash \
    python3 \
    py3-pip \
    make \
    g++ \
    go

# Install Letta Code CLI globally
RUN npm install -g @letta-ai/letta-code

# Install beads CLI
RUN go install github.com/steveyegge/beads/cmd/bd@latest && \
    cp /root/go/bin/bd /usr/local/bin/bd && \
    chmod +x /usr/local/bin/bd

# Create app directory
WORKDIR /app

# Copy and install Python dependencies for Tree-sitter AST parsing
COPY python/requirements.txt ./python/
RUN pip3 install --no-cache-dir --break-system-packages -r python/requirements.txt

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy application files
COPY index.js ./
COPY lib ./lib
COPY python ./python
COPY *.md ./

# Copy Letta configuration (shared settings, local state will be generated)
COPY .letta ./.letta

# Create logs directory, .letta-code state dir, and ensure writable by node user
RUN mkdir -p /app/logs /app/.letta-code && \
    chown -R node:node /app/.letta /app/.letta-code /app/logs && \
    chmod -R 755 /app/.letta /app/.letta-code

# Configure git identity for beads commits (as node user)
USER node
RUN git config --global user.email "huly-vibe-sync@oculairmedia.com" && \
    git config --global user.name "Huly Vibe Sync Service"
USER root

# Configure git safe directory for root user (when running container as root)
RUN git config --global --add safe.directory '*' && \
    git config --global user.email "huly-vibe-sync@oculairmedia.com" && \
    git config --global user.name "Huly Vibe Sync Service"

# Health check - query the /health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${HEALTH_PORT:-3099}/health | grep -q '"status": "healthy"' || exit 1

# Note: Container runs as root via docker-compose.yml user: root
# This allows access to mounted /opt/stacks directories regardless of ownership

# Default command
CMD ["node", "index.js"]
