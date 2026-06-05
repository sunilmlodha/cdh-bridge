'use strict'

/**
 * @fileoverview Kafka producer/consumer factory using kafkajs.
 *
 * Topics used across CDH Bridge:
 *   cdh-events    — raw behavioural events from event-collector
 *   cdh-profiles  — merged/enriched customer profile updates
 *   cdh-consent   — consent change records from consent-service
 *   cdh-feedback  — NBA outcome feedback from feedback-loop
 *   cdh-nba       — Next-Best-Action decision payloads
 *
 * Usage (producer):
 *   const kafka = require('../shared/kafka')
 *   const producer = await kafka.createProducer()
 *   await producer.send({ topic: kafka.TOPICS.EVENTS, messages: [{ value: JSON.stringify(event) }] })
 *   await producer.disconnect()
 *
 * Usage (consumer):
 *   const consumer = await kafka.createConsumer('my-group-id')
 *   await consumer.subscribe({ topic: kafka.TOPICS.EVENTS, fromBeginning: false })
 *   await consumer.run({ eachMessage: async ({ topic, partition, message }) => { ... } })
 */

const { Kafka, logLevel, CompressionTypes } = require('kafkajs')
const logger = require('./logger')

// ---------------------------------------------------------------------------
// Topic constants
// ---------------------------------------------------------------------------

const TOPICS = {
  EVENTS: 'cdh-events',
  PROFILES: 'cdh-profiles',
  CONSENT: 'cdh-consent',
  FEEDBACK: 'cdh-feedback',
  NBA: 'cdh-nba'
}

// ---------------------------------------------------------------------------
// KafkaJS logger bridge — routes kafkajs internal logs through Winston
// ---------------------------------------------------------------------------

const kafkaJsLogLevel = {
  [logLevel.ERROR]: 'error',
  [logLevel.WARN]: 'warn',
  [logLevel.INFO]: 'info',
  [logLevel.DEBUG]: 'debug'
}

function kafkaLogger() {
  return ({ level, log }) => {
    const { message, ...extra } = log
    const winstonLevel = kafkaJsLogLevel[level] || 'info'
    logger[winstonLevel]({ msg: `[kafkajs] ${message}`, ...extra })
  }
}

// ---------------------------------------------------------------------------
// KafkaJS instance (singleton)
// ---------------------------------------------------------------------------

function buildKafka() {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map(b => b.trim())

  return new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || 'cdh-bridge',
    brokers,
    logLevel: logLevel.WARN,
    logCreator: kafkaLogger,
    retry: {
      initialRetryTime: 300,
      retries: 10,
      multiplier: 1.5,
      maxRetryTime: 30000,
      factor: 0.2
    }
  })
}

let _kafka = null

function getKafka() {
  if (!_kafka) _kafka = buildKafka()
  return _kafka
}

// ---------------------------------------------------------------------------
// Producer factory
// ---------------------------------------------------------------------------

/**
 * Create and connect a KafkaJS producer with retry / idempotency settings.
 *
 * @param {import('kafkajs').ProducerConfig} [options] - Optional KafkaJS producer config overrides.
 * @returns {Promise<import('kafkajs').Producer>}
 */
async function createProducer(options = {}) {
  const kafka = getKafka()

  const producer = kafka.producer({
    allowAutoTopicCreation: true,
    idempotent: false,         // set true for exactly-once when broker supports it
    transactionTimeout: 30000,
    retry: {
      initialRetryTime: 200,
      retries: 8
    },
    ...options
  })

  producer.on(producer.events.CONNECT, () => logger.info({ msg: 'Kafka producer connected' }))
  producer.on(producer.events.DISCONNECT, () => logger.warn({ msg: 'Kafka producer disconnected' }))
  producer.on(producer.events.REQUEST_TIMEOUT, (e) => logger.error({ msg: 'Kafka producer request timeout', event: e }))

  await producer.connect()
  logger.info({ msg: 'Kafka producer ready', brokers: process.env.KAFKA_BROKERS })

  return producer
}

/**
 * Send a single JSON-serialisable message to a topic.
 * Convenience wrapper around producer.send().
 *
 * @param {import('kafkajs').Producer} producer
 * @param {string} topic
 * @param {any} payload
 * @param {string} [key]  - Optional partition key
 * @returns {Promise<import('kafkajs').RecordMetadata[]>}
 */
async function sendMessage(producer, topic, payload, key) {
  const message = {
    value: JSON.stringify(payload),
    timestamp: Date.now().toString()
  }
  if (key) message.key = key

  try {
    const result = await producer.send({
      topic,
      compression: CompressionTypes.None,
      messages: [message]
    })
    logger.debug({ msg: 'Kafka message sent', topic, key })
    return result
  } catch (err) {
    logger.error({ msg: 'Kafka send failed', topic, error: err.message })
    throw err
  }
}

/**
 * Send a batch of JSON-serialisable messages to a topic.
 *
 * @param {import('kafkajs').Producer} producer
 * @param {string} topic
 * @param {Array<{ payload: any, key?: string }>} items
 * @returns {Promise<import('kafkajs').RecordMetadata[]>}
 */
async function sendBatch(producer, topic, items) {
  const messages = items.map(({ payload, key }) => ({
    key: key || undefined,
    value: JSON.stringify(payload),
    timestamp: Date.now().toString()
  }))

  try {
    const result = await producer.send({ topic, messages })
    logger.debug({ msg: 'Kafka batch sent', topic, count: messages.length })
    return result
  } catch (err) {
    logger.error({ msg: 'Kafka batch send failed', topic, error: err.message })
    throw err
  }
}

// ---------------------------------------------------------------------------
// Consumer factory
// ---------------------------------------------------------------------------

/**
 * Create and connect a KafkaJS consumer with auto-commit enabled.
 *
 * @param {string} groupId   - Consumer group ID (unique per service)
 * @param {import('kafkajs').ConsumerConfig} [options] - Optional config overrides.
 * @returns {Promise<import('kafkajs').Consumer>}
 */
async function createConsumer(groupId, options = {}) {
  if (!groupId) throw new Error('createConsumer requires a groupId')

  const kafka = getKafka()

  const consumer = kafka.consumer({
    groupId,
    allowAutoTopicCreation: true,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
    maxBytesPerPartition: 1048576, // 1 MB
    retry: {
      initialRetryTime: 300,
      retries: 8
    },
    ...options
  })

  consumer.on(consumer.events.CONNECT, () => logger.info({ msg: 'Kafka consumer connected', groupId }))
  consumer.on(consumer.events.DISCONNECT, () => logger.warn({ msg: 'Kafka consumer disconnected', groupId }))
  consumer.on(consumer.events.CRASH, ({ payload }) => logger.error({ msg: 'Kafka consumer crash', groupId, error: payload.error?.message }))
  consumer.on(consumer.events.STOP, () => logger.warn({ msg: 'Kafka consumer stopped', groupId }))
  consumer.on(consumer.events.REBALANCING, () => logger.info({ msg: 'Kafka consumer rebalancing', groupId }))

  await consumer.connect()
  logger.info({ msg: 'Kafka consumer ready', groupId, brokers: process.env.KAFKA_BROKERS })

  return consumer
}

/**
 * Admin helper: ensure all CDH Bridge topics exist with sensible defaults.
 * Safe to call on every service startup — it is idempotent.
 *
 * @returns {Promise<void>}
 */
async function ensureTopics() {
  const kafka = getKafka()
  const admin = kafka.admin()
  await admin.connect()

  const topicList = Object.values(TOPICS).map(topic => ({
    topic,
    numPartitions: parseInt(process.env.KAFKA_PARTITIONS || '3', 10),
    replicationFactor: parseInt(process.env.KAFKA_REPLICATION_FACTOR || '1', 10),
    configEntries: [
      { name: 'retention.ms', value: String(7 * 24 * 60 * 60 * 1000) } // 7 days
    ]
  }))

  try {
    await admin.createTopics({ topics: topicList, waitForLeaders: true })
    logger.info({ msg: 'Kafka topics ensured', topics: Object.values(TOPICS) })
  } catch (err) {
    // Topic already exists errors are safe to ignore
    if (!err.message.includes('already exists')) {
      logger.error({ msg: 'Kafka ensureTopics error', error: err.message })
    }
  } finally {
    await admin.disconnect()
  }
}

module.exports = {
  TOPICS,
  getKafka,
  createProducer,
  createConsumer,
  sendMessage,
  sendBatch,
  ensureTopics
}
