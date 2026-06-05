'use strict';

const Redis = require('ioredis');
const logger = require('./logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
// Key prefix used when storing opt-out records.
// A key of the form  cdh:optout:<customerId>  means the customer has opted out.
const OPT_OUT_KEY_PREFIX = process.env.REDIS_OPT_OUT_PREFIX || 'cdh:optout:';

let redisClient = null;
let connectionAttempted = false;

/**
 * Lazily initialise and return the Redis client.
 * If Redis is unreachable we log a warning and continue (fail-open):
 * it is better to process an event than to silently drop it due to an
 * infrastructure hiccup.
 */
function getRedisClient() {
  if (redisClient) return redisClient;

  redisClient = new Redis(REDIS_URL, {
    lazyConnect:        true,
    enableReadyCheck:   true,
    maxRetriesPerRequest: 2,
    connectTimeout:     3_000,
    commandTimeout:     2_000,
    retryStrategy: (times) => {
      if (times > 5) {
        logger.warn('Redis retry limit reached; will stop retrying', { times });
        return null; // stop retrying
      }
      return Math.min(times * 200, 2_000);
    },
  });

  redisClient.on('connect',   () => logger.info('Redis client connected'));
  redisClient.on('ready',     () => logger.info('Redis client ready'));
  redisClient.on('error',     (err) => logger.warn('Redis client error', { message: err.message }));
  redisClient.on('close',     () => logger.warn('Redis client connection closed'));
  redisClient.on('reconnecting', () => logger.info('Redis client reconnecting'));

  return redisClient;
}

/**
 * Check whether a customer has opted out of data collection.
 *
 * Returns true  → customer has opted out; the event SHOULD be dropped.
 * Returns false → customer has not opted out (or Redis is unavailable — fail-open).
 *
 * @param {string} customerId
 * @returns {Promise<boolean>}
 */
async function isOptedOut(customerId) {
  if (!customerId) return false;

  const client = getRedisClient();

  try {
    if (!connectionAttempted) {
      connectionAttempted = true;
      // connect() is safe to call when already connected
      await client.connect().catch(() => {}); // swallow initial connection errors
    }

    const key = `${OPT_OUT_KEY_PREFIX}${customerId}`;
    const value = await client.get(key);

    // Any truthy value (e.g. "1", "true", "opted_out") means opt-out
    const optedOut = value !== null && value !== undefined && value !== '';

    if (optedOut) {
      logger.info('Event skipped — customer opted out', { customerId, key });
    }

    return optedOut;
  } catch (err) {
    // Fail-open: if Redis is unavailable, do NOT drop the event
    logger.warn('Consent check failed (Redis error); processing event anyway', {
      customerId,
      error: err.message,
    });
    return false;
  }
}

/**
 * Record a customer opt-out in Redis.
 * Pass ttlSeconds = 0 (or omit) for a permanent opt-out.
 *
 * @param {string} customerId
 * @param {number} [ttlSeconds=0]
 */
async function setOptOut(customerId, ttlSeconds = 0) {
  const client = getRedisClient();
  const key = `${OPT_OUT_KEY_PREFIX}${customerId}`;

  try {
    if (ttlSeconds > 0) {
      await client.set(key, '1', 'EX', ttlSeconds);
    } else {
      await client.set(key, '1');
    }
    logger.info('Customer opt-out recorded', { customerId, ttlSeconds });
  } catch (err) {
    logger.error('Failed to record customer opt-out', { customerId, error: err.message });
    throw err;
  }
}

/**
 * Remove a customer's opt-out record (i.e. they have re-consented).
 *
 * @param {string} customerId
 */
async function clearOptOut(customerId) {
  const client = getRedisClient();
  const key = `${OPT_OUT_KEY_PREFIX}${customerId}`;

  try {
    await client.del(key);
    logger.info('Customer opt-out removed', { customerId });
  } catch (err) {
    logger.error('Failed to remove customer opt-out', { customerId, error: err.message });
    throw err;
  }
}

/**
 * Gracefully close the Redis connection.
 * Should be called during process shutdown.
 */
async function disconnect() {
  if (!redisClient) return;

  logger.info('Closing Redis connection…');
  await redisClient.quit().catch(() => redisClient.disconnect());
  redisClient = null;
  connectionAttempted = false;
  logger.info('Redis connection closed');
}

/**
 * Return true if Redis is currently connected and ready.
 */
function isReady() {
  return redisClient !== null && redisClient.status === 'ready';
}

module.exports = { isOptedOut, setOptOut, clearOptOut, disconnect, isReady };
