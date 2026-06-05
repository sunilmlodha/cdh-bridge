'use strict';

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const logger = require('./src/logger');
const profileRoutes = require('./src/routes/profiles');
const { createRedisClient } = require('./src/profile-store');
const { startConsumer, stopConsumer } = require('./src/kafka-consumer');
const { scheduleRefresh, stopScheduler } = require('./src/cdh-push');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Request ID middleware
app.use((req, res, next) => {
  req.requestId = uuidv4();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('HTTP request', {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
});

// Health check
app.get('/health', async (req, res) => {
  const redis = createRedisClient();
  let redisStatus = 'unknown';
  try {
    await redis.ping();
    redisStatus = 'ok';
  } catch (err) {
    redisStatus = 'error';
  } finally {
    redis.disconnect();
  }

  const status = redisStatus === 'ok' ? 'healthy' : 'degraded';
  res.status(status === 'healthy' ? 200 : 503).json({
    status,
    service: 'profile-router',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    dependencies: {
      redis: redisStatus,
    },
  });
});

// Profile routes
app.use('/v1/profiles', profileRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, requestId: req.requestId });
  res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
});

// Start server
let server;
async function start() {
  try {
    // Start Kafka consumer
    await startConsumer();
    logger.info('Kafka consumer started');

    // Start CDH push scheduler
    scheduleRefresh();
    logger.info('CDH refresh scheduler started');

    server = app.listen(PORT, () => {
      logger.info(`Profile Router listening on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start service', { error: err.message });
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully`);

  if (server) {
    server.close(() => logger.info('HTTP server closed'));
  }

  try {
    await stopConsumer();
    logger.info('Kafka consumer stopped');
  } catch (err) {
    logger.warn('Error stopping Kafka consumer', { error: err.message });
  }

  try {
    stopScheduler();
    logger.info('CDH scheduler stopped');
  } catch (err) {
    logger.warn('Error stopping scheduler', { error: err.message });
  }

  setTimeout(() => {
    logger.info('Forcing shutdown after timeout');
    process.exit(0);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

start();

module.exports = app;
