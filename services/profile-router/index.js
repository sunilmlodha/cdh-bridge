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

// Identity resolution routes — extract identity sub-routes from profiles router
// and also mount directly at /v1/identity for clean API surface
const identityRouter = require('express').Router();
const profileRoutesRef = require('./src/routes/profiles');

// Re-mount identity sub-paths at /v1/identity
const reviewQueue      = require('./src/identity/review-queue');
const anonymousStitcher = require('./src/identity/anonymous-stitcher');
const deviceLinker     = require('./src/identity/device-linker');
const identityGraph    = require('./src/identity/identity-graph');
const aliasManager     = require('./src/identity/alias-manager');
const matchEngine      = require('./src/identity/match-engine');

// Review queue
identityRouter.get('/review/stats',            async (req, res) => { try { res.json(await reviewQueue.getStats()) } catch(e) { res.status(500).json({error:e.message}) } })
identityRouter.get('/review/queue',            async (req, res) => { try { res.json(await reviewQueue.getPending(Number(req.query.limit)||50)) } catch(e) { res.status(500).json({error:e.message}) } })
identityRouter.get('/review/:id',              async (req, res) => { try { const item = await reviewQueue.getItem(req.params.id); item ? res.json(item) : res.status(404).json({error:'Not found'}) } catch(e) { res.status(500).json({error:e.message}) } })
identityRouter.post('/review/:id/approve',     async (req, res) => { try { const r = await reviewQueue.approve(req.params.id, req.body.resolvedBy||'api'); const merged = await matchEngine.deduplicateAndMerge(r.primaryId, r.secondaryId); res.json({merged:true, goldenId:r.primaryId, merged_profile:merged}) } catch(e) { res.status(500).json({error:e.message}) } })
identityRouter.post('/review/:id/reject',      async (req, res) => { try { await reviewQueue.reject(req.params.id, req.body.resolvedBy||'api'); res.json({rejected:true}) } catch(e) { res.status(500).json({error:e.message}) } })

// Anonymous stitching
identityRouter.post('/stitch',                 async (req, res) => { try { const { cookieId, customerId, source } = req.body; if (!cookieId||!customerId) return res.status(400).json({error:'cookieId and customerId required'}); const r = await anonymousStitcher.stitchToKnown(cookieId, customerId, source||'api'); res.json(r) } catch(e) { res.status(500).json({error:e.message}) } })
identityRouter.get('/stitch/stats',            async (req, res) => { try { res.json(await anonymousStitcher.getStitchStats()) } catch(e) { res.status(500).json({error:e.message}) } })
identityRouter.get('/anon/:cookieId',          async (req, res) => { try { const p = await anonymousStitcher.getAnon(req.params.cookieId); if (!p) return res.status(404).json({error:'Anonymous profile not found or already stitched', cookieId:req.params.cookieId}); res.json({cookieId:req.params.cookieId, eventCount:p.events?.length||0, segments:p.segments||[], createdAt:p.createdAt, lastSeenAt:p.lastSeenAt}) } catch(e) { res.status(500).json({error:e.message}) } })
identityRouter.post('/anon/:cookieId/event',   async (req, res) => { try { const p = await anonymousStitcher.trackAnonEvent(req.params.cookieId, req.body); res.json({tracked:true, eventCount:p.events?.length||0, segments:p.segments||[]}) } catch(e) { res.status(500).json({error:e.message}) } })
identityRouter.get('/anon/count',              async (req, res) => { try { res.json({count: await anonymousStitcher.getAnonCount()}) } catch(e) { res.status(500).json({error:e.message}) } })

// Device / identity graph
identityRouter.post('/device/register',        async (req, res) => { try { const { customerId, deviceId, deviceType, metadata } = req.body; if (!customerId||!deviceId) return res.status(400).json({error:'customerId and deviceId required'}); await deviceLinker.registerDevice(customerId, deviceId, deviceType||'web-cookie', metadata||{}); res.json({registered:true, customerId, deviceId}) } catch(e) { res.status(500).json({error:e.message}) } })
identityRouter.get('/device/:deviceId',        async (req, res) => { try { const cid = await deviceLinker.resolveDevice(req.params.deviceId); cid ? res.json({deviceId:req.params.deviceId, customerId:cid}) : res.status(404).json({error:'Device not found'}) } catch(e) { res.status(500).json({error:e.message}) } })

// Identity cluster (full picture of all linked identifiers for a customer)
identityRouter.get('/cluster/:identifier',     async (req, res) => { try { const golden = await aliasManager.resolve(req.params.identifier); const cluster = await identityGraph.getIdentityCluster(golden||req.params.identifier); res.json({...cluster, resolvedFrom:req.params.identifier}) } catch(e) { res.status(500).json({error:e.message}) } })

// Graph stats
identityRouter.get('/stats',                   async (req, res) => { try { const [graphStats, reviewStats, stitchStats] = await Promise.all([identityGraph.getStats(), reviewQueue.getStats(), anonymousStitcher.getStitchStats()]); res.json({ graph: graphStats, reviews: reviewStats, stitches: stitchStats }) } catch(e) { res.status(500).json({error:e.message}) } })

app.use('/v1/identity', identityRouter);

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
