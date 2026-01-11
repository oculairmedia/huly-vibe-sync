# Temporal Worker Dockerfile
# Uses Debian-based Node image for glibc compatibility

FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only (Temporal SDK includes pre-built binaries)
RUN npm ci --omit=dev

# Copy compiled temporal code
COPY temporal/dist ./temporal/dist
COPY temporal/package.json ./temporal/

# Set environment variables
ENV NODE_ENV=production
ENV TEMPORAL_ADDRESS=localhost:7233
ENV TEMPORAL_TASK_QUEUE=vibesync-queue

# Run the worker
CMD ["node", "temporal/dist/worker.js"]
