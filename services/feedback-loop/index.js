'use strict';

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const logger = require('./src/logger');
const feedbackRoutes = require('./src/routes/feedback');
const kafkaConsumer = require('./src/kafka-consumer');
const decisionStore = require('./src/decision-store');
const feedbackProcessor = require('./src/feedback-processor');

const PORT = parseInt(process.env.PORT || '3003', 10);

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// ─── Routes ────────────────────────────────────────────────────────────────────
app.use('/v1/feedback', feedbackRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'cdh-feedback-loop', ts: new Date().toISOString() }));

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { err: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Scheduled jobs ────────────────────────────────────────────────────────────
// Every 5 minutes: log a quick stats snapshot
cron.schedule('*/5 * * * *', async () => {
  try {
    const stats = await decisionStore.getStats();
    logger.info('Periodic stats snapshot', stats);
  } catch (err) {
    logger.warn('Periodic stats job failed', { err: err.message });
  }
});

// ─── Bootstrap ─────────────────────────────────────────────────────────────────
async function start() {
  // Start Kafka consumer (non-fatal if broker is unavailable)
  try {
    await kafkaConsumer.start();
  } catch (err) {
    logger.warn('Kafka consumer failed to start — continuing without it', { err: err.message });
  }

  app.listen(PORT, () => {
    logger.info(`CDH Feedback Loop service listening on port ${PORT}`);
  });
}

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  try {
    await kafkaConsumer.stop();
    await feedbackProcessor.disconnect();
    await decisionStore.disconnect();
  } catch (err) {
    logger.warn('Error during shutdown', { err: err.message });
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  logger.error('Failed to start service', { err: err.message });
  process.exit(1);
});
