'use strict';

const { Kafka, logLevel } = require('kafkajs');
const logger = require('./logger');
const store = require('./profile-store');
const { normalizeProfile } = require('./field-normalizer');
const { matchByEmail, matchByPhone, mergeProfiles } = require('./dedup-engine');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID || 'profile-router-group';
const CDH_PROFILES_TOPIC = process.env.CDH_PROFILES_TOPIC || 'cdh-profiles';

const kafka = new Kafka({
  clientId: 'profile-router',
  brokers: KAFKA_BROKERS,
  logLevel: logLevel.WARN,
  retry: {
    initialRetryTime: 300,
    retries: 8,
  },
});

const consumer = kafka.consumer({ groupId: KAFKA_GROUP_ID });

let running = false;

/**
 * Process a single profile event message from Kafka.
 */
async function processProfileEvent(message) {
  let event;
  try {
    event = JSON.parse(message.value.toString());
  } catch (err) {
    logger.warn('Failed to parse Kafka message', { error: err.message });
    return;
  }

  const { customerId, source = 'kafka', profile: rawProfile, eventType } = event;

  if (!customerId && !rawProfile) {
    logger.warn('Received empty event, skipping');
    return;
  }

  if (eventType === 'DELETE') {
    if (customerId) {
      await store.deleteProfile(customerId);
      logger.info('Profile deleted via Kafka event', { customerId });
    }
    return;
  }

  // Normalize fields from source system
  const normalizedProfile = normalizeProfile(source, rawProfile || {});

  // Deduplication: check if a matching profile already exists
  let targetId = customerId;
  let existingProfile = null;

  if (!targetId && normalizedProfile.email) {
    existingProfile = await matchByEmail(normalizedProfile.email);
    if (existingProfile) targetId = existingProfile.customerId;
  }

  if (!targetId && normalizedProfile.phone) {
    existingProfile = await matchByPhone(normalizedProfile.phone);
    if (existingProfile) targetId = existingProfile.customerId;
  }

  if (!targetId) {
    // No existing match — use customerId from event or generate one
    const { v4: uuidv4 } = require('uuid');
    targetId = event.customerId || uuidv4();
  }

  if (existingProfile && existingProfile.customerId !== customerId) {
    // Merge: incoming data into existing profile
    const merged = mergeProfiles(existingProfile, { ...normalizedProfile, customerId });
    await store.set(existingProfile.customerId, merged);
    logger.info('Profiles merged via dedup', {
      primaryId: existingProfile.customerId,
      incomingId: customerId,
    });
  } else {
    // Merge or create
    await store.merge(targetId, { ...normalizedProfile, _source: source });
    logger.debug('Profile updated from Kafka', { customerId: targetId, source });
  }
}

/**
 * Start the Kafka consumer and begin processing cdh-profiles topic.
 */
async function startConsumer() {
  try {
    await consumer.connect();
    await consumer.subscribe({ topic: CDH_PROFILES_TOPIC, fromBeginning: false });

    running = true;
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          await processProfileEvent(message);
        } catch (err) {
          logger.error('Error processing Kafka message', {
            topic,
            partition,
            offset: message.offset,
            error: err.message,
          });
        }
      },
    });

    logger.info('Kafka consumer running', {
      topic: CDH_PROFILES_TOPIC,
      groupId: KAFKA_GROUP_ID,
      brokers: KAFKA_BROKERS,
    });
  } catch (err) {
    logger.error('Failed to start Kafka consumer', { error: err.message });
    // Non-fatal: service can still serve cached profiles
  }
}

/**
 * Gracefully stop the consumer.
 */
async function stopConsumer() {
  if (running) {
    running = false;
    await consumer.disconnect();
  }
}

module.exports = { startConsumer, stopConsumer, processProfileEvent };
