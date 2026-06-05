FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy source
COPY . .

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3002

ENV NODE_ENV=production \
    PORT=3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "index.js"]
