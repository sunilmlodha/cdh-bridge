'use strict';

const Redis = require('ioredis');
const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console({ format: format.simple() })]
});

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const KEY_PREFIX = 'connector:';
const SYNC_KEY_PREFIX = 'connector:sync:';
const LOG_KEY_PREFIX = 'connector:logs:';
const MAX_LOG_ENTRIES = 100;

let redis;

function getRedis() {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3
    });

    redis.on('error', (err) => {
      logger.error('Redis connection error', { err: err.message });
    });

    redis.on('connect', () => {
      logger.info('Redis connected', { url: REDIS_URL });
    });
  }
  return redis;
}

/**
 * Save connector config to Redis.
 */
async function saveConnector(connectorId, config) {
  const r = getRedis();
  await r.set(`${KEY_PREFIX}${connectorId}`, JSON.stringify(config));
  await r.sadd(`${KEY_PREFIX}index`, connectorId);
  logger.debug('Connector config saved', { connectorId });
}

/**
 * Get connector config from Redis.
 */
async function getConnector(connectorId) {
  const r = getRedis();
  const raw = await r.get(`${KEY_PREFIX}${connectorId}`);
  return raw ? JSON.parse(raw) : null;
}

/**
 * List all connector IDs.
 */
async function listConnectorIds() {
  const r = getRedis();
  return r.smembers(`${KEY_PREFIX}index`);
}

/**
 * List all connector configs.
 */
async function listConnectors() {
  const ids = await listConnectorIds();
  if (!ids.length) return [];
  const configs = await Promise.all(ids.map(id => getConnector(id)));
  return configs.filter(Boolean);
}

/**
 * Delete connector config.
 */
async function deleteConnector(connectorId) {
  const r = getRedis();
  await r.del(`${KEY_PREFIX}${connectorId}`);
  await r.srem(`${KEY_PREFIX}index`, connectorId);
  await r.del(`${SYNC_KEY_PREFIX}${connectorId}`);
  logger.debug('Connector config deleted', { connectorId });
}

/**
 * Save sync state (lastSync timestamp, recordCount, etc.)
 */
async function saveSyncState(connectorId, state) {
  const r = getRedis();
  await r.set(`${SYNC_KEY_PREFIX}${connectorId}`, JSON.stringify(state));
}

/**
 * Get sync state for a connector.
 */
async function getSyncState(connectorId) {
  const r = getRedis();
  const raw = await r.get(`${SYNC_KEY_PREFIX}${connectorId}`);
  return raw ? JSON.parse(raw) : { lastSync: null, recordCount: 0, errorCount: 0 };
}

/**
 * Append a log entry for a connector sync run.
 */
async function appendLog(connectorId, entry) {
  const r = getRedis();
  const key = `${LOG_KEY_PREFIX}${connectorId}`;
  await r.lpush(key, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }));
  await r.ltrim(key, 0, MAX_LOG_ENTRIES - 1);
}

/**
 * Get recent log entries for a connector.
 */
async function getLogs(connectorId, limit = 50) {
  const r = getRedis();
  const key = `${LOG_KEY_PREFIX}${connectorId}`;
  const entries = await r.lrange(key, 0, limit - 1);
  return entries.map(e => JSON.parse(e));
}

async function disconnect() {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

module.exports = {
  saveConnector,
  getConnector,
  listConnectors,
  listConnectorIds,
  deleteConnector,
  saveSyncState,
  getSyncState,
  appendLog,
  getLogs,
  disconnect,
  getRedis
};
