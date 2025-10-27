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

# Create logs directory
RUN mkdir -p /app/logs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# Run as non-root user
USER node

# Default command
CMD ["node", "index.js"]
