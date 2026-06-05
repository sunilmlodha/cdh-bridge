FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies only when package files change
COPY package.json ./

RUN npm install --omit=dev

# Copy application source
COPY index.js ./
COPY src/ ./src/

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3003

ENV NODE_ENV=production \
    PORT=3003 \
    LOG_LEVEL=info

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3003/health || exit 1

CMD ["node", "index.js"]
