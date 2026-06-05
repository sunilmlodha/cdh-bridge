FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Copy application code
COPY index.js ./
COPY src/ ./src/

# Create logs directory
RUN mkdir -p logs

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3004/health || exit 1

CMD ["node", "index.js"]
