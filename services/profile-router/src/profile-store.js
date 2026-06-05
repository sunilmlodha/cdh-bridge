'use strict';

const Redis = require('ioredis');
const logger = require('./logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const PROFILE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const LATENCY_SAMPLE_KEY = 'profile:latency:samples';
const LATENCY_SAMPLE_MAX = 1000;

// Singleton Redis client for the store
let _client = null;

function createRedisClient() {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

function getClient() {
  if (!_client) {
    _client = createRedisClient();
    _client.on('error', (err) => logger.error('Redis client error', { error: err.message }));
    _client.on('connect', () => logger.info('Redis connected'));
  }
  return _client;
}

function profileKey(customerId) {
  return `profile:${customerId}`;
}

function historyKey(customerId) {
  return `profile:history:${customerId}`;
}

function emailIndexKey(email) {
  return `idx:email:${email.toLowerCase()}`;
}

function phoneIndexKey(phone) {
  return `idx:phone:${phone.replace(/\D/g, '')}`;
}

/**
 * Record a latency sample (in ms) for percentile tracking.
 */
async function recordLatency(ms) {
  const client = getClient();
  try {
    await client.lpush(LATENCY_SAMPLE_KEY, ms);
    await client.ltrim(LATENCY_SAMPLE_KEY, 0, LATENCY_SAMPLE_MAX - 1);
  } catch (err) {
    // Non-critical — do not rethrow
    logger.debug('Failed to record latency sample', { error: err.message });
  }
}

/**
 * Retrieve a unified profile by customerId.
 * Returns null if not found.
 */
async function get(customerId) {
  const client = getClient();
  const start = Date.now();
  try {
    const raw = await client.get(profileKey(customerId));
    const latencyMs = Date.now() - start;
    await recordLatency(latencyMs);
    if (!raw) return null;
    const profile = JSON.parse(raw);
    logger.debug('Profile retrieved', { customerId, latencyMs });
    return profile;
  } catch (err) {
    logger.error('Redis get error', { customerId, error: err.message });
    throw err;
  }
}

/**
 * Store a profile with 30-day TTL. Also maintains email/phone indexes.
 */
async function set(customerId, profile) {
  const client = getClient();
  const key = profileKey(customerId);
  const data = { ...profile, customerId, updatedAt: new Date().toISOString() };
  const pipeline = client.pipeline();
  pipeline.set(key, JSON.stringify(data), 'EX', PROFILE_TTL_SECONDS);

  // Maintain email index
  if (data.email) {
    pipeline.set(emailIndexKey(data.email), customerId, 'EX', PROFILE_TTL_SECONDS);
  }
  // Maintain phone index
  if (data.phone) {
    pipeline.set(phoneIndexKey(data.phone), customerId, 'EX', PROFILE_TTL_SECONDS);
  }

  await pipeline.exec();
  logger.debug('Profile stored', { customerId });
}

/**
 * Merge a partial profile into the existing profile.
 * Scalar fields: latest value wins.
 * Array fields (segments, sources): union.
 * Preserves consent as most-restrictive.
 */
async function merge(customerId, partialProfile) {
  const client = getClient();
  const existing = await get(customerId) || { customerId };

  // Record a history snapshot before mutating
  const histKey = historyKey(customerId);
  const historyEntry = {
    snapshot: { ...existing },
    mergedAt: new Date().toISOString(),
    source: partialProfile._source || 'manual',
  };
  const pipeline = client.pipeline();
  pipeline.lpush(histKey, JSON.stringify(historyEntry));
  pipeline.ltrim(histKey, 0, 99); // keep last 100 history entries
  pipeline.expire(histKey, PROFILE_TTL_SECONDS);
  await pipeline.exec();

  // Merge logic
  const merged = { ...existing };

  for (const [field, value] of Object.entries(partialProfile)) {
    if (field.startsWith('_')) continue; // skip meta fields

    if (field === 'segments' || field === 'sources') {
      // Union of arrays
      const existingArr = Array.isArray(existing[field]) ? existing[field] : [];
      const newArr = Array.isArray(value) ? value : [value];
      merged[field] = [...new Set([...existingArr, ...newArr])];
    } else if (field === 'consent') {
      // Most restrictive: false/null overrides true
      if (typeof value === 'object' && value !== null) {
        merged.consent = merged.consent || {};
        for (const [consentKey, consentVal] of Object.entries(value)) {
          const existing_val = merged.consent[consentKey];
          // false/null is more restrictive than true
          if (existing_val === undefined) {
            merged.consent[consentKey] = consentVal;
          } else {
            merged.consent[consentKey] = existing_val === false || consentVal === false
              ? false
              : consentVal;
          }
        }
      }
    } else {
      // Scalar: take latest (incoming value)
      if (value !== undefined && value !== null) {
        merged[field] = value;
      }
    }
  }

  await set(customerId, merged);
  return merged;
}

/**
 * Delete all profile data for a customer (GDPR erasure).
 */
async function deleteProfile(customerId) {
  const client = getClient();
  const profile = await get(customerId);
  const pipeline = client.pipeline();

  if (profile) {
    if (profile.email) pipeline.del(emailIndexKey(profile.email));
    if (profile.phone) pipeline.del(phoneIndexKey(profile.phone));
  }
  pipeline.del(profileKey(customerId));
  pipeline.del(historyKey(customerId));

  await pipeline.exec();
  logger.info('Profile deleted (GDPR)', { customerId });
}

/**
 * Return approximate count of stored profiles.
 */
async function count() {
  const client = getClient();
  try {
    const keys = await client.keys('profile:*');
    // Filter only direct profile keys (not history or index)
    const profileKeys = keys.filter((k) => /^profile:[^:]+$/.test(k));
    return profileKeys.length;
  } catch (err) {
    logger.error('Redis count error', { error: err.message });
    return -1;
  }
}

/**
 * Compute latency percentiles from stored samples.
 */
async function getStats() {
  const client = getClient();
  try {
    const rawSamples = await client.lrange(LATENCY_SAMPLE_KEY, 0, -1);
    if (rawSamples.length === 0) {
      return { p50: null, p95: null, p99: null, sampleCount: 0 };
    }
    const samples = rawSamples.map(Number).sort((a, b) => a - b);
    const n = samples.length;
    const p = (pct) => samples[Math.floor((pct / 100) * n)] || samples[n - 1];
    return {
      p50: p(50),
      p95: p(95),
      p99: p(99),
      sampleCount: n,
    };
  } catch (err) {
    logger.error('Failed to compute stats', { error: err.message });
    return { p50: null, p95: null, p99: null, sampleCount: 0 };
  }
}

/**
 * Retrieve profile change history (last 100 entries).
 */
async function getHistory(customerId) {
  const client = getClient();
  try {
    const raw = await client.lrange(historyKey(customerId), 0, -1);
    return raw.map((entry) => JSON.parse(entry));
  } catch (err) {
    logger.error('Redis history error', { customerId, error: err.message });
    return [];
  }
}

module.exports = {
  createRedisClient,
  get,
  set,
  merge,
  deleteProfile,
  count,
  getStats,
  getHistory,
  emailIndexKey,
  phoneIndexKey,
  getClient,
};
