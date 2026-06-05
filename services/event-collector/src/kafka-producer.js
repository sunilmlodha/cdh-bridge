'use strict';

const { Kafka, Partitioners, CompressionTypes } = require('kafkajs');
const logger = require('./logger');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID || 'event-collector';
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'cdh-events';

// KafkaJS instance — one per process
const kafka = new Kafka({
  clientId: KAFKA_CLIENT_ID,
  brokers: KAFKA_BROKERS,
  retry: {
    initialRetryTime: 300,
    retries: 10,
    multiplier: 1.5,
    maxRetryTime: 30_000,
  },
  logCreator: () => ({ namespace, level, label, log }) => {
    const { message, ...extra } = log;
    const lvlName = ['NOTHING', 'ERROR', 'WARN', 'INFO', 'DEBUG'][level] || 'INFO';
    logger[lvlName.toLowerCase()]?.(`[kafkajs:${namespace}] ${message}`, extra);
  },
});

let producer = null;
let isConnected = false;
let connectingPromise = null;

/**
 * Connect the Kafka producer (idempotent — safe to call multiple times).
 */
async function connect() {
  if (isConnected) return;

  if (connectingPromise) {
    await connectingPromise;
    return;
  }

  connectingPromise = (async () => {
    logger.info('Connecting Kafka producer', { brokers: KAFKA_BROKERS, topic: KAFKA_TOPIC });

    producer = kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
      allowAutoTopicCreation: true,
      transactionTimeout: 30_000,
      idempotent: false, // set true only when exactly-once is needed and broker supports it
    });

    await producer.connect();
    isConnected = true;
    logger.info('Kafka producer connected');
  })();

  try {
    await connectingPromise;
  } finally {
    connectingPromise = null;
  }
}

/**
 * Publish a single CDH IH event to the Kafka topic.
 *
 * @param {object} cdhEvent  — output of schema-mapper.mapToCDHSchema()
 * @returns {Promise<object>}  Kafka record metadata
 */
async function publishEvent(cdhEvent) {
  if (!isConnected) await connect();

  const key = cdhEvent.CustomerID || null;
  const value = JSON.stringify(cdhEvent);

  const [metadata] = await producer.send({
    topic: KAFKA_TOPIC,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key,
        value,
        headers: {
          'content-type':   'application/json',
          'schema-version': cdhEvent.IHContext?.schemaVersion || '1.0',
          'event-type':     cdhEvent.IHEventType || 'unknown',
          'correlation-id': cdhEvent.IHContext?.correlationId || '',
        },
      },
    ],
  });

  logger.debug('Published event to Kafka', {
    topic:         KAFKA_TOPIC,
    partition:     metadata.partition,
    offset:        metadata.baseOffset,
    customerId:    cdhEvent.CustomerID,
    ihEventType:   cdhEvent.IHEventType,
    correlationId: cdhEvent.IHContext?.correlationId,
  });

  return metadata;
}

/**
 * Publish multiple CDH IH events in a single Kafka batch (more efficient than
 * calling publishEvent() in a loop).
 *
 * @param {object[]} cdhEvents
 * @returns {Promise<object[]>} Array of Kafka record metadata objects
 */
async function publishBatch(cdhEvents) {
  if (!cdhEvents || cdhEvents.length === 0) return [];
  if (!isConnected) await connect();

  const messages = cdhEvents.map((evt) => ({
    key:   evt.CustomerID || null,
    value: JSON.stringify(evt),
    headers: {
      'content-type':   'application/json',
      'schema-version': evt.IHContext?.schemaVersion || '1.0',
      'event-type':     evt.IHEventType || 'unknown',
      'correlation-id': evt.IHContext?.correlationId || '',
    },
  }));

  const metadataArray = await producer.send({
    topic: KAFKA_TOPIC,
    compression: CompressionTypes.GZIP,
    messages,
  });

  logger.info('Published batch to Kafka', {
    topic:  KAFKA_TOPIC,
    count:  cdhEvents.length,
    result: metadataArray,
  });

  return metadataArray;
}

/**
 * Gracefully disconnect the Kafka producer.
 * Should be called on process shutdown.
 */
async function disconnect() {
  if (!isConnected || !producer) return;

  logger.info('Disconnecting Kafka producer…');
  await producer.disconnect();
  isConnected = false;
  producer = null;
  logger.info('Kafka producer disconnected');
}

/**
 * Return current connection state (useful for health checks).
 */
function isReady() {
  return isConnected;
}

module.exports = { connect, publishEvent, publishBatch, disconnect, isReady };
