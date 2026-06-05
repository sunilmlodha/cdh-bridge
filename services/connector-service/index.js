'use strict';

const express = require('express');
const cors = require('cors');
const { createLogger, format, transports } = require('winston');
const connectorsRouter = require('./src/routes/connectors');
const ConnectorRegistry = require('./src/connector-registry');
const KafkaProducer = require('./src/kafka-producer');

const PORT = process.env.PORT || 3005;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const logger = createLogger({
  level: LOG_LEVEL,
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple())
    })
  ]
});

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { query: req.query, ip: req.ip });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'connector-service',
    timestamp: new Date().toISOString(),
    connectors: ConnectorRegistry.getHealthSummary()
  });
});

// Mount routes
app.use('/v1/connectors', connectorsRouter);

// Webhook receiver endpoint (for http-webhook connector)
const WebhookConnector = require('./src/connectors/http-webhook');
app.post('/v1/webhooks/:connectorId', async (req, res) => {
  try {
    const connector = ConnectorRegistry.get(req.params.connectorId);
    if (!connector || !(connector instanceof WebhookConnector)) {
      return res.status(404).json({ error: 'Webhook connector not found' });
    }
    await connector.handleWebhook(req, res);
  } catch (err) {
    logger.error('Webhook handler error', { err: err.message });
    res.status(500).json({ error: 'Internal error' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { err: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    logger.info('Starting Connector Service...');

    // Initialize Kafka producer
    await KafkaProducer.connect();
    logger.info('Kafka producer connected');

    // Initialize connector registry (loads persisted configs from Redis)
    await ConnectorRegistry.init();
    logger.info('Connector registry initialized');

    app.listen(PORT, () => {
      logger.info(`Connector Service listening on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start service', { err: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await ConnectorRegistry.stopAll();
  await KafkaProducer.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await ConnectorRegistry.stopAll();
  await KafkaProducer.disconnect();
  process.exit(0);
});

start();

module.exports = app;
