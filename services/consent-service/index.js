'use strict';

const express = require('express');
const cors = require('cors');
const { createLogger, format, transports } = require('winston');
const consentRoutes = require('./src/routes/consent');
const { initKafka } = require('./src/propagation-engine');
const { initRedis } = require('./src/consent-store');
const { startCronJobs } = require('./src/cron-jobs');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' })
  ]
});

const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'consent-service',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Mount consent routes
app.use('/v1/consent', consentRoutes);

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    requestId: req.headers['x-request-id']
  });
});

async function bootstrap() {
  try {
    await initRedis();
    logger.info('Redis connection established');

    await initKafka();
    logger.info('Kafka connection established');

    startCronJobs();
    logger.info('Cron jobs started');

    app.listen(PORT, () => {
      logger.info(`Consent service listening on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start consent service', { error: err.message });
    process.exit(1);
  }
}

bootstrap();

module.exports = app;
