FROM node:20-alpine

LABEL service="connector-service"
LABEL version="1.0.0"

# Install build tools for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production && npm cache clean --force

# Copy application source
COPY . .

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001 -G nodejs

USER nodeuser

EXPOSE 3005

ENV NODE_ENV=production
ENV PORT=3005

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3005/health || exit 1

CMD ["node", "index.js"]
