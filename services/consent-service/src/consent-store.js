'use strict';

const Redis = require('ioredis');
const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()]
});

let redis;

function initRedis() {
  return new Promise((resolve, reject) => {
    const REDIS_URL = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });

    redis.on('error', (err) => {
      logger.error('Redis connection error', { error: err.message });
    });

    redis.on('ready', () => {
      logger.info('Redis ready');
    });

    redis.connect().then(resolve).catch(reject);
  });
}

function getRedis() {
  if (!redis) throw new Error('Redis not initialised — call initRedis() first');
  return redis;
}

// ─── Keys ─────────────────────────────────────────────────────────────────────
const keys = {
  consent: (cid) => `consent:profile:${cid}`,
  optout: (cid, channel) => `consent:optout:${cid}:${channel}`,
  erasureRequest: (requestId) => `consent:erasure:${requestId}`,
  erasureProgress: (requestId) => `consent:erasure:progress:${requestId}`,
  pendingRequests: () => 'consent:pending_requests',
  auditLog: (cid) => `consent:audit:${cid}`,
  globalAudit: () => 'consent:audit:global'
};

// ─── Opt-out ──────────────────────────────────────────────────────────────────

/**
 * Set opt-out for given channels. Permanent (no TTL).
 */
async function setOptOut(customerId, channels) {
  const r = getRedis();
  const pipeline = r.pipeline();
  const now = Date.now();

  // Store per-channel flags for fast O(1) lookup
  for (const channel of channels) {
    pipeline.set(keys.optout(customerId, channel), '1');
    pipeline.hset(keys.consent(customerId), `optout_${channel}`, now);
  }

  // Update master consent record
  pipeline.hset(keys.consent(customerId), {
    customerId,
    lastUpdated: now,
    optoutChannels: JSON.stringify(channels)
  });

  await pipeline.exec();
  logger.info('Opt-out stored in Redis', { customerId, channels });
}

/**
 * Fast channel-level opt-out check (used by event-collector hot path).
 */
async function isOptedOut(customerId, channel) {
  const r = getRedis();
  const val = await r.get(keys.optout(customerId, channel));
  return val === '1';
}

/**
 * Return full consent record for a customer.
 */
async function getConsent(customerId) {
  const r = getRedis();
  const raw = await r.hgetall(keys.consent(customerId));
  if (!raw || Object.keys(raw).length === 0) return null;

  // Deserialise JSON fields
  if (raw.optoutChannels) {
    try { raw.optoutChannels = JSON.parse(raw.optoutChannels); } catch (_) {}
  }
  if (raw.erasureRequestIds) {
    try { raw.erasureRequestIds = JSON.parse(raw.erasureRequestIds); } catch (_) {}
  }
  return raw;
}

// ─── Erasure / CCPA ───────────────────────────────────────────────────────────

const SLA_HOURS = {
  gdpr_erasure: 72,
  ccpa_dns: 360 // 15 days
};

/**
 * Persist an erasure / CCPA request and add to the pending-requests set.
 */
async function recordErasureRequest(request) {
  const r = getRedis();
  const { requestId, customerId, type } = request;
  const now = Date.now();
  const slaHours = SLA_HOURS[type] || 72;
  const deadlineMs = now + slaHours * 60 * 60 * 1000;

  const payload = {
    ...request,
    createdAt: now,
    status: 'pending',
    slaHours,
    deadlineMs,
    systemsCompleted: JSON.stringify([]),
    systemsFailed: JSON.stringify([])
  };

  const pipeline = r.pipeline();
  pipeline.hset(keys.erasureRequest(requestId), payload);
  // Track pending requests in a sorted set (score = deadline for easy SLA queries)
  pipeline.zadd(keys.pendingRequests(), deadlineMs, requestId);
  // Link request to customer profile
  const existing = await r.hget(keys.consent(customerId), 'erasureRequestIds');
  const ids = existing ? JSON.parse(existing) : [];
  ids.push(requestId);
  pipeline.hset(keys.consent(customerId), 'erasureRequestIds', JSON.stringify(ids));

  await pipeline.exec();
  logger.info('Erasure request recorded', { requestId, customerId, type, deadlineMs });
  return payload;
}

/**
 * Mark a specific downstream system as done/failed for a given request.
 */
async function updateErasureProgress(requestId, system, status) {
  const r = getRedis();
  const raw = await r.hgetall(keys.erasureProgress(requestId));

  const completed = raw.completed ? JSON.parse(raw.completed) : [];
  const failed = raw.failed ? JSON.parse(raw.failed) : [];

  if (status === 'completed' && !completed.includes(system)) {
    completed.push(system);
    // Remove from failed if previously failed
    const idx = failed.indexOf(system);
    if (idx !== -1) failed.splice(idx, 1);
  } else if (status === 'failed' && !failed.includes(system)) {
    failed.push(system);
  }

  const pipeline = r.pipeline();
  pipeline.hset(keys.erasureProgress(requestId), {
    completed: JSON.stringify(completed),
    failed: JSON.stringify(failed),
    lastUpdated: Date.now()
  });

  // Also update the parent request record
  pipeline.hset(keys.erasureRequest(requestId), {
    systemsCompleted: JSON.stringify(completed),
    systemsFailed: JSON.stringify(failed),
    lastUpdated: Date.now()
  });

  await pipeline.exec();
  logger.info('Erasure progress updated', { requestId, system, status });
}

/**
 * Return all open erasure/CCPA requests sorted by deadline (soonest first).
 */
async function getPendingRequests() {
  const r = getRedis();
  // Get all members from sorted set with scores (deadlines)
  const members = await r.zrangebyscore(keys.pendingRequests(), '-inf', '+inf', 'WITHSCORES');

  const requests = [];
  for (let i = 0; i < members.length; i += 2) {
    const requestId = members[i];
    const deadline = parseInt(members[i + 1]);
    const raw = await r.hgetall(keys.erasureRequest(requestId));
    if (raw && raw.status !== 'completed') {
      if (raw.systemsCompleted) {
        try { raw.systemsCompleted = JSON.parse(raw.systemsCompleted); } catch (_) {}
      }
      if (raw.systemsFailed) {
        try { raw.systemsFailed = JSON.parse(raw.systemsFailed); } catch (_) {}
      }
      raw.deadline = deadline;
      raw.slaStatus = getSlaStatusFromDeadline(deadline);
      requests.push(raw);
    }
  }
  return requests;
}

/**
 * Return SLA status for a single request.
 */
async function getSlaStatus(requestId) {
  const r = getRedis();
  const raw = await r.hgetall(keys.erasureRequest(requestId));
  if (!raw || Object.keys(raw).length === 0) return null;

  const deadline = parseInt(raw.deadlineMs);
  const slaStatus = getSlaStatusFromDeadline(deadline);

  return {
    requestId,
    customerId: raw.customerId,
    type: raw.type,
    status: raw.status,
    createdAt: parseInt(raw.createdAt),
    deadlineMs: deadline,
    hoursRemaining: slaStatus.hoursRemaining,
    slaBreached: slaStatus.breached,
    slaWarning: slaStatus.warning,
    systemsCompleted: raw.systemsCompleted ? JSON.parse(raw.systemsCompleted) : [],
    systemsFailed: raw.systemsFailed ? JSON.parse(raw.systemsFailed) : []
  };
}

function getSlaStatusFromDeadline(deadlineMs) {
  const now = Date.now();
  const msRemaining = deadlineMs - now;
  const hoursRemaining = msRemaining / (1000 * 60 * 60);
  return {
    hoursRemaining: Math.max(0, hoursRemaining),
    breached: msRemaining < 0,
    warning: msRemaining > 0 && hoursRemaining < 24
  };
}

/**
 * Mark a request as fully completed and remove from pending set.
 */
async function completeRequest(requestId) {
  const r = getRedis();
  const pipeline = r.pipeline();
  pipeline.hset(keys.erasureRequest(requestId), {
    status: 'completed',
    completedAt: Date.now()
  });
  pipeline.zrem(keys.pendingRequests(), requestId);
  await pipeline.exec();
}

/**
 * Delete all consent data for a customer (called during erasure).
 */
async function deleteCustomerConsent(customerId) {
  const r = getRedis();
  const pattern = `consent:*:${customerId}*`;
  const keyList = await r.keys(pattern);
  if (keyList.length > 0) {
    await r.del(...keyList);
  }
  logger.info('Customer consent data deleted from Redis', { customerId, keysDeleted: keyList.length });
  return keyList.length;
}

module.exports = {
  initRedis,
  getRedis,
  setOptOut,
  isOptedOut,
  getConsent,
  recordErasureRequest,
  updateErasureProgress,
  getPendingRequests,
  getSlaStatus,
  completeRequest,
  deleteCustomerConsent
};
