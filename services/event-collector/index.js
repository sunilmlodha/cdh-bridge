'use strict';

const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const logger = require('./src/logger');
const eventsRouter = require('./src/routes/events');
const kafkaProducer = require('./src/kafka-producer');
const consentCheck = require('./src/consent-check');

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();

// Trust proxy headers when running behind a load balancer / reverse proxy
// (needed for accurate IP-based rate limiting and X-Forwarded-For logging)
app.set('trust proxy', process.env.TRUST_PROXY ? parseInt(process.env.TRUST_PROXY, 10) : 1);

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        objectSrc:  ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: {
      maxAge:            31_536_000,
      includeSubDomains: true,
      preload:           true,
    },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : ['*'];

app.use(
  cors({
    origin: allowedOrigins.includes('*')
      ? '*'
      : (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error(`CORS: origin ${origin} not allowed`));
          }
        },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 600,
  })
);

// ---------------------------------------------------------------------------
// Rate limiting — 1000 requests per minute per IP
// ---------------------------------------------------------------------------
const limiter = rateLimit({
  windowMs:         60 * 1_000,   // 1 minute
  max:              1_000,
  standardHeaders:  true,
  legacyHeaders:    false,
  keyGenerator:     (req) => req.ip,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({
      success: false,
      error: {
        code:    'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests — please retry after 1 minute.',
      },
    });
  },
});

app.use(limiter);

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

// ---------------------------------------------------------------------------
// Request logging middleware
// ---------------------------------------------------------------------------
app.use((req, _res, next) => {
  logger.info('Incoming request', {
    method:    req.method,
    path:      req.path,
    ip:        req.ip,
    requestId: req.headers['x-request-id'] || null,
  });
  next();
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  const kafkaReady  = kafkaProducer.isReady();
  const redisReady  = consentCheck.isReady();
  // Return 200 even when Kafka is reconnecting — service is alive and will retry
  res.status(200).json({
    status:  'healthy',
    service: 'event-collector',
    version: process.env.npm_package_version || '1.0.0',
    uptime:  Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies: {
      kafka: { connected: kafkaReady, note: kafkaReady ? undefined : 'reconnecting' },
      redis: { connected: redisReady },
    },
  });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/v1/events', eventsRouter);

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found.` },
  });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error('Unhandled express error', { message: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
});

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(app);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
  try {
    // Connect Kafka eagerly so the first event doesn't incur connection latency
    await kafkaProducer.connect();
  } catch (err) {
    // Non-fatal at startup — producer will retry on first publish
    logger.warn('Kafka initial connection failed; will retry on first publish', {
      error: err.message,
    });
  }

  server.listen(PORT, HOST, () => {
    logger.info(`Event Collector service started`, { host: HOST, port: PORT });
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let shutdownInProgress = false;

async function gracefulShutdown(signal) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  logger.info(`${signal} received — starting graceful shutdown`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await kafkaProducer.disconnect();
    } catch (err) {
      logger.warn('Error disconnecting Kafka producer', { error: err.message });
    }

    try {
      await consentCheck.disconnect();
    } catch (err) {
      logger.warn('Error disconnecting Redis', { error: err.message });
    }

    logger.info('Graceful shutdown complete');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 15_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
start();

module.exports = app; // exported for testing
