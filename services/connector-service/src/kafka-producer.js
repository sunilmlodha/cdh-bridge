'use strict';

const { Kafka, Partitioners } = require('kafkajs');
const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console({ format: format.simple() })]
});

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const PROFILES_TOPIC = process.env.KAFKA_PROFILES_TOPIC || 'cdh-profiles';
const CLIENT_ID = 'connector-service';

const kafka = new Kafka({
  clientId: CLIENT_ID,
  brokers: KAFKA_BROKERS,
  retry: {
    initialRetryTime: 300,
    retries: 10
  }
});

const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner,
  allowAutoTopicCreation: true
});

let connected = false;
let publishCount = 0;
let errorCount = 0;

async function connect() {
  if (connected) return;
  await producer.connect();
  connected = true;
  logger.info('Kafka producer connected', { brokers: KAFKA_BROKERS, topic: PROFILES_TOPIC });
}

async function disconnect() {
  if (!connected) return;
  await producer.disconnect();
  connected = false;
  logger.info('Kafka producer disconnected');
}

/**
 * Publish a normalized CustomerProfile to the cdh-profiles topic.
 * @param {Object} profile - Normalized customer profile
 * @param {string} connectorId - Source connector ID
 */
async function publishProfile(profile, connectorId) {
  if (!connected) {
    await connect();
  }

  const message = {
    key: profile.customerId || profile.id || profile.email,
    value: JSON.stringify({
      ...profile,
      _meta: {
        connectorId,
        publishedAt: new Date().toISOString(),
        schemaVersion: '1.0'
      }
    }),
    headers: {
      connectorId,
      contentType: 'application/json',
      schemaVersion: '1.0'
    }
  };

  try {
    await producer.send({
      topic: PROFILES_TOPIC,
      messages: [message]
    });
    publishCount++;
    logger.debug('Profile published to Kafka', {
      customerId: profile.customerId,
      connectorId,
      topic: PROFILES_TOPIC
    });
  } catch (err) {
    errorCount++;
    logger.error('Failed to publish profile to Kafka', {
      err: err.message,
      customerId: profile.customerId,
      connectorId
    });
    throw err;
  }
}

/**
 * Publish a batch of profiles (more efficient for large syncs).
 */
async function publishBatch(profiles, connectorId) {
  if (!connected) {
    await connect();
  }

  const messages = profiles.map(profile => ({
    key: profile.customerId || profile.id || profile.email,
    value: JSON.stringify({
      ...profile,
      _meta: {
        connectorId,
        publishedAt: new Date().toISOString(),
        schemaVersion: '1.0'
      }
    }),
    headers: {
      connectorId,
      contentType: 'application/json',
      schemaVersion: '1.0'
    }
  }));

  try {
    await producer.send({
      topic: PROFILES_TOPIC,
      messages
    });
    publishCount += profiles.length;
    logger.info('Batch published to Kafka', {
      count: profiles.length,
      connectorId,
      topic: PROFILES_TOPIC
    });
  } catch (err) {
    errorCount += profiles.length;
    logger.error('Failed to publish batch to Kafka', {
      err: err.message,
      count: profiles.length,
      connectorId
    });
    throw err;
  }
}

function getStats() {
  return { publishCount, errorCount, connected, topic: PROFILES_TOPIC };
}

module.exports = { connect, disconnect, publishProfile, publishBatch, getStats };
