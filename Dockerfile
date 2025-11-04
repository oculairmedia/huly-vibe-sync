FROM node:20-alpine

LABEL maintainer="Oculair Media"
LABEL description="Huly to Vibe Kanban bidirectional sync service"

# Install build dependencies for better-sqlite3 and other native modules
RUN apk add --no-cache \
    git \
    curl \
    python3 \
    make \
    g++

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy application files
COPY index.js ./
COPY lib ./lib
COPY *.md ./

# Copy Letta configuration (shared settings, local state will be generated)
COPY .letta ./.letta

# Create logs directory and ensure .letta is writable by node user
RUN mkdir -p /app/logs && \
    chown -R node:node /app/.letta /app/logs && \
    chmod -R 755 /app/.letta

# Health check - query the /health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${HEALTH_PORT:-3099}/health | grep -q '"status": "healthy"' || exit 1

# Run as non-root user
USER node

# Default command
CMD ["node", "index.js"]
