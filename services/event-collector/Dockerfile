# ---- Build stage ----
FROM node:18-alpine AS builder

WORKDIR /app

# Copy manifests first to leverage layer caching
COPY package.json package-lock.json* ./

# Install only production dependencies
RUN npm install --only=production --ignore-scripts && \
    # Remove any dev artefacts that npm ci may have pulled in
    npm prune --production

# ---- Runtime stage ----
FROM node:18-alpine AS runtime

# Install dumb-init for proper signal handling inside containers
RUN apk add --no-cache dumb-init

# Create a non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY --chown=appuser:appgroup package.json ./
COPY --chown=appuser:appgroup index.js    ./
COPY --chown=appuser:appgroup src/        ./src/

# Drop privileges
USER appuser

# Expose the service port
EXPOSE 3001

# Health check so orchestrators know when the service is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

# Use dumb-init as PID 1 so SIGTERM is forwarded correctly to node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
