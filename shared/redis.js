'use strict'

/**
 * @fileoverview Redis client factory using ioredis.
 *
 * Usage:
 *   const { getClient, getSubscriber, quit } = require('../shared/redis')
 *   const redis = getClient()
 *   await redis.set('key', 'value', 'EX', 60)
 *   const val = await redis.get('key')
 */

const Redis = require('ioredis')
const logger = require('./logger')

/** Singleton client instances */
let _client = null
let _subscriber = null

/**
 * Parse the REDIS_URL environment variable into ioredis connection options.
 * Supports both redis:// and rediss:// (TLS) schemes.
 * Falls back to localhost:6379 if REDIS_URL is not set.
 *
 * @returns {import('ioredis').RedisOptions}
 */
function buildOptions() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  const parsed = new URL(url)

  /** @type {import('ioredis').RedisOptions} */
  const opts = {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
    db: parsed.pathname ? parseInt(parsed.pathname.slice(1) || '0', 10) : 0,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    lazyConnect: false,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) {
        logger.error({ msg: 'Redis retry limit exceeded', times })
        return null // stop retrying
      }
      const delay = Math.min(times * 100, 2000)
      logger.warn({ msg: 'Redis reconnecting', attempt: times, delayMs: delay })
      return delay
    },
    reconnectOnError(err) {
      // Reconnect on READONLY errors (common in Redis Sentinel failover)
      return err.message.includes('READONLY')
    }
  }

  return opts
}

/**
 * Get (or create) the singleton Redis client.
 * This client is used for commands (GET, SET, PUBLISH, etc.).
 *
 * @returns {import('ioredis').Redis}
 */
function getClient() {
  if (_client) return _client

  const opts = buildOptions()
  _client = new Redis(opts)

  _client.on('connect', () => logger.info({ msg: 'Redis client connected', host: opts.host, port: opts.port }))
  _client.on('ready', () => logger.info({ msg: 'Redis client ready' }))
  _client.on('error', (err) => logger.error({ msg: 'Redis client error', error: err.message }))
  _client.on('close', () => logger.warn({ msg: 'Redis client connection closed' }))
  _client.on('reconnecting', () => logger.warn({ msg: 'Redis client reconnecting' }))
  _client.on('end', () => logger.warn({ msg: 'Redis client connection ended' }))

  return _client
}

/**
 * Get (or create) a dedicated subscriber Redis client.
 * ioredis requires a separate connection for SUBSCRIBE / PSUBSCRIBE because
 * a subscribed client cannot issue regular commands.
 *
 * @returns {import('ioredis').Redis}
 */
function getSubscriber() {
  if (_subscriber) return _subscriber

  const opts = buildOptions()
  _subscriber = new Redis(opts)

  _subscriber.on('connect', () => logger.info({ msg: 'Redis subscriber connected' }))
  _subscriber.on('error', (err) => logger.error({ msg: 'Redis subscriber error', error: err.message }))

  return _subscriber
}

/**
 * Gracefully close all Redis connections.
 * Call this during process shutdown (SIGTERM/SIGINT handlers).
 *
 * @returns {Promise<void>}
 */
async function quit() {
  const promises = []
  if (_client) {
    promises.push(_client.quit().then(() => { _client = null }))
  }
  if (_subscriber) {
    promises.push(_subscriber.quit().then(() => { _subscriber = null }))
  }
  await Promise.all(promises)
  logger.info({ msg: 'Redis connections closed' })
}

/**
 * Convenience helper: store a JSON-serialisable value with an optional TTL.
 *
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlSeconds]
 * @returns {Promise<'OK'>}
 */
async function setJson(key, value, ttlSeconds) {
  const client = getClient()
  const serialised = JSON.stringify(value)
  if (ttlSeconds) {
    return client.set(key, serialised, 'EX', ttlSeconds)
  }
  return client.set(key, serialised)
}

/**
 * Convenience helper: retrieve and JSON-parse a value.
 *
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function getJson(key) {
  const client = getClient()
  const raw = await client.get(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    logger.warn({ msg: 'Redis getJson parse error', key })
    return null
  }
}

module.exports = {
  getClient,
  getSubscriber,
  quit,
  setJson,
  getJson
}
