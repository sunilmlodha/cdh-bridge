'use strict';

const { Kafka, CompressionTypes } = require('kafkajs');
const axios = require('axios');
const { createLogger, format, transports } = require('winston');
const {
  setOptOut,
  recordErasureRequest,
  updateErasureProgress,
  deleteCustomerConsent,
  completeRequest
} = require('./consent-store');
const { log: auditLog } = require('./audit-log');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()]
});

// ─── Kafka setup ──────────────────────────────────────────────────────────────
let producer;

const kafka = new Kafka({
  clientId: 'consent-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  connectionTimeout: 5000,
  requestTimeout: 10000,
  retry: {
    initialRetryTime: 100,
    retries: 5
  }
});

async function initKafka() {
  producer = kafka.producer({
    allowAutoTopicCreation: true,
    transactionTimeout: 30000
  });
  await producer.connect();
  logger.info('Kafka producer connected');
}

// ─── CDH Pega integration ─────────────────────────────────────────────────────

const CDH_BASE_URL = process.env.CDH_BASE_URL || 'http://cdh-service:3001';
const CDH_API_KEY = process.env.CDH_API_KEY || '';
const CDH_TIMEOUT_MS = parseInt(process.env.CDH_TIMEOUT_MS || '450'); // keep under 500ms

async function suppressInCDH(customerId, channels) {
  const start = Date.now();
  try {
    const response = await axios.post(
      `${CDH_BASE_URL}/api/v1/profiles/${customerId}/suppress`,
      { channels, suppressedAt: new Date().toISOString() },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CDH_API_KEY
        },
        timeout: CDH_TIMEOUT_MS
      }
    );
    const elapsed = Date.now() - start;
    logger.info('CDH suppression complete', { customerId, channels, elapsedMs: elapsed });
    return { success: true, elapsedMs: elapsed, data: response.data };
  } catch (err) {
    const elapsed = Date.now() - start;
    logger.error('CDH suppression failed', {
      customerId,
      channels,
      elapsedMs: elapsed,
      error: err.message,
      status: err.response?.status
    });
    return { success: false, elapsedMs: elapsed, error: err.message };
  }
}

async function deleteFromCDH(customerId) {
  try {
    const response = await axios.delete(
      `${CDH_BASE_URL}/api/v1/profiles/${customerId}`,
      {
        headers: { 'x-api-key': CDH_API_KEY },
        timeout: 10000
      }
    );
    logger.info('CDH profile deleted', { customerId });
    return { success: true, data: response.data };
  } catch (err) {
    logger.error('CDH profile deletion failed', { customerId, error: err.message });
    return { success: false, error: err.message };
  }
}

// ─── Kafka publishing ─────────────────────────────────────────────────────────

async function publishToKafka(topic, key, value) {
  if (!producer) {
    logger.warn('Kafka producer not ready, skipping publish', { topic, key });
    return { success: false, error: 'Producer not ready' };
  }
  try {
    const result = await producer.send({
      topic,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key,
          value: JSON.stringify(value),
          headers: {
            'content-type': 'application/json',
            'source-service': 'consent-service',
            timestamp: String(Date.now())
          }
        }
      ]
    });
    logger.info('Kafka message published', { topic, key, partition: result[0]?.partition });
    return { success: true };
  } catch (err) {
    logger.error('Kafka publish failed', { topic, key, error: err.message });
    return { success: false, error: err.message };
  }
}

// ─── Propagate opt-out ────────────────────────────────────────────────────────

/**
 * Immediate fan-out for marketing opt-out.
 * 1. Redis write (sync)
 * 2. Pega CDH suppression (async, <500ms target)
 * 3. Kafka event (all downstream services consume)
 * 4. Audit log
 */
async function propagateOptOut(customerId, channels, source = 'unknown') {
  const startTime = Date.now();
  const results = {};

  // Step 1 — Redis (synchronous, must complete before we return)
  await setOptOut(customerId, channels);
  results.redis = { success: true, elapsedMs: Date.now() - startTime };

  // Steps 2 & 3 run concurrently to maximise speed
  const [cdhResult, kafkaResult] = await Promise.all([
    // Step 2 — CDH suppression (<500ms)
    suppressInCDH(customerId, channels),

    // Step 3 — Kafka fan-out (downstream services react asynchronously)
    publishToKafka('cdh-consent', customerId, {
      event: 'OPT_OUT',
      customerId,
      channels,
      source,
      timestamp: new Date().toISOString()
    })
  ]);

  results.cdh = cdhResult;
  results.kafka = kafkaResult;

  const totalMs = Date.now() - startTime;

  // Step 4 — Audit log
  await auditLog('OPT_OUT', customerId, {
    channels,
    source,
    cdhSuccess: cdhResult.success,
    cdhElapsedMs: cdhResult.elapsedMs,
    kafkaSuccess: kafkaResult.success,
    totalElapsedMs: totalMs
  });

  if (!cdhResult.success) {
    logger.warn('CDH suppression failed during opt-out — queued for retry', { customerId });
    await queueForRetry('opt-out', customerId, { channels, source });
  }

  logger.info('Opt-out propagation complete', { customerId, channels, totalMs });
  return { customerId, channels, totalMs, results };
}

// ─── Propagate GDPR erasure ───────────────────────────────────────────────────

const DOWNSTREAM_SYSTEMS = [
  'cdh',
  'event-collector',
  'recommendation-engine',
  'email-platform',
  'analytics-warehouse',
  'crm',
  'data-lake'
];

/**
 * Full erasure fan-out for GDPR right to be forgotten.
 * 1. Delete from Redis profile store
 * 2. Delete from Pega CDH
 * 3. Publish erasure event to Kafka
 * 4. Schedule downstream deletion jobs (72h window)
 * 5. Track per-system completion
 */
async function propagateErasure(customerId, requestId) {
  const startTime = Date.now();

  await auditLog('ERASURE_STARTED', customerId, { requestId });

  // Step 1 — Redis profile deletion
  const redisDeletedCount = await deleteCustomerConsent(customerId);
  await updateErasureProgress(requestId, 'redis', 'completed');

  // Step 2 — CDH deletion
  const cdhResult = await deleteFromCDH(customerId);
  await updateErasureProgress(requestId, 'cdh', cdhResult.success ? 'completed' : 'failed');

  // Step 3 — Kafka erasure event (downstream systems self-delete within 72h)
  const kafkaResult = await publishToKafka('cdh-consent', customerId, {
    event: 'ERASURE_REQUEST',
    customerId,
    requestId,
    targetSystems: DOWNSTREAM_SYSTEMS,
    deadline: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    timestamp: new Date().toISOString()
  });
  await updateErasureProgress(requestId, 'kafka', kafkaResult.success ? 'completed' : 'failed');

  // Step 4 — Schedule downstream systems (they consume Kafka and acknowledge)
  // Each downstream system should publish to cdh-consent-ack topic when done
  logger.info('Erasure event published — downstream systems have 72h to complete deletion', {
    customerId,
    requestId,
    systems: DOWNSTREAM_SYSTEMS
  });

  const totalMs = Date.now() - startTime;

  await auditLog('ERASURE_PROPAGATED', customerId, {
    requestId,
    redisDeletedKeys: redisDeletedCount,
    cdhSuccess: cdhResult.success,
    kafkaSuccess: kafkaResult.success,
    totalElapsedMs: totalMs
  });

  return {
    customerId,
    requestId,
    totalMs,
    redisDeletedKeys: redisDeletedCount,
    cdhSuccess: cdhResult.success,
    kafkaSuccess: kafkaResult.success
  };
}

// ─── Propagate CCPA Do Not Sell ───────────────────────────────────────────────

/**
 * CCPA Do Not Sell propagation.
 * Similar to opt-out but targets data sale / sharing pipelines.
 * 15-day SLA.
 */
async function propagateCCPA(customerId, requestId) {
  const startTime = Date.now();

  await auditLog('CCPA_DNS_STARTED', customerId, { requestId });

  // Suppress all data-sale channels immediately
  await setOptOut(customerId, ['data-sale', 'third-party-share', 'targeted-ads']);

  // CDH suppression
  const cdhResult = await suppressInCDH(customerId, ['data-sale', 'third-party-share']);

  // Kafka event
  const kafkaResult = await publishToKafka('cdh-consent', customerId, {
    event: 'CCPA_DO_NOT_SELL',
    customerId,
    requestId,
    deadline: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    timestamp: new Date().toISOString()
  });

  const totalMs = Date.now() - startTime;

  await auditLog('CCPA_DNS_PROPAGATED', customerId, {
    requestId,
    cdhSuccess: cdhResult.success,
    kafkaSuccess: kafkaResult.success,
    totalElapsedMs: totalMs
  });

  return { customerId, requestId, totalMs, cdhSuccess: cdhResult.success, kafkaSuccess: kafkaResult.success };
}

// ─── SLA Compliance Check ─────────────────────────────────────────────────────

const { getPendingRequests } = require('./consent-store');

/**
 * Check all open requests for SLA compliance.
 * Alerts if any request has < 24h remaining.
 * Called by cron every 15 minutes.
 */
async function checkSlaCompliance() {
  const pending = await getPendingRequests();
  const now = Date.now();
  const warnings = [];
  const breaches = [];

  for (const req of pending) {
    const hoursRemaining = (req.deadline - now) / (1000 * 60 * 60);

    if (hoursRemaining < 0) {
      breaches.push({ requestId: req.requestId, customerId: req.customerId, type: req.type, hoursOverdue: Math.abs(hoursRemaining) });
      await auditLog('SLA_BREACH', req.customerId, { requestId: req.requestId, type: req.type, hoursOverdue: Math.abs(hoursRemaining) });
      logger.error('SLA BREACH detected', { requestId: req.requestId, customerId: req.customerId, hoursOverdue: Math.abs(hoursRemaining) });
    } else if (hoursRemaining < 24) {
      warnings.push({ requestId: req.requestId, customerId: req.customerId, type: req.type, hoursRemaining });
      await auditLog('SLA_WARNING', req.customerId, { requestId: req.requestId, type: req.type, hoursRemaining });
      logger.warn('SLA warning — less than 24h remaining', { requestId: req.requestId, hoursRemaining });
    }
  }

  logger.info('SLA compliance check complete', {
    totalPending: pending.length,
    warnings: warnings.length,
    breaches: breaches.length
  });

  return { totalPending: pending.length, warnings, breaches };
}

// ─── Retry failed propagations ────────────────────────────────────────────────

const RETRY_KEY = 'consent:retry_queue';

async function queueForRetry(type, customerId, data) {
  try {
    const { getRedis } = require('./consent-store');
    const r = getRedis();
    await r.rpush(RETRY_KEY, JSON.stringify({ type, customerId, data, queuedAt: Date.now(), attempts: 0 }));
  } catch (err) {
    logger.error('Failed to queue for retry', { type, customerId, error: err.message });
  }
}

async function retryFailedPropagations() {
  const { getRedis } = require('./consent-store');
  const r = getRedis();
  const MAX_ATTEMPTS = 5;
  let retried = 0;
  let failed = 0;

  // Process up to 100 items per run
  for (let i = 0; i < 100; i++) {
    const raw = await r.lpop(RETRY_KEY);
    if (!raw) break;

    let item;
    try { item = JSON.parse(raw); } catch (_) { continue; }

    if (item.attempts >= MAX_ATTEMPTS) {
      logger.error('Max retry attempts reached, dropping', { item });
      await auditLog('RETRY_EXHAUSTED', item.customerId, { type: item.type, attempts: item.attempts });
      failed++;
      continue;
    }

    item.attempts++;

    try {
      if (item.type === 'opt-out') {
        const result = await suppressInCDH(item.customerId, item.data.channels);
        if (result.success) {
          retried++;
          logger.info('Retry succeeded', { type: item.type, customerId: item.customerId });
        } else {
          // Re-queue
          await r.rpush(RETRY_KEY, JSON.stringify(item));
        }
      } else if (item.type === 'erasure') {
        const result = await deleteFromCDH(item.customerId);
        if (result.success) {
          retried++;
        } else {
          await r.rpush(RETRY_KEY, JSON.stringify(item));
        }
      }
    } catch (err) {
      logger.error('Retry attempt failed', { item, error: err.message });
      await r.rpush(RETRY_KEY, JSON.stringify(item));
    }
  }

  logger.info('Retry run complete', { retried, failed });
  return { retried, failed };
}

module.exports = {
  initKafka,
  propagateOptOut,
  propagateErasure,
  propagateCCPA,
  checkSlaCompliance,
  retryFailedPropagations
};
