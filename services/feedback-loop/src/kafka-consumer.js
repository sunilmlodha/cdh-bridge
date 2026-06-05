'use strict';

const { Kafka } = require('kafkajs');
const feedbackProcessor = require('./feedback-processor');
const logger = require('./logger');

const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const NBA_TOPIC = process.env.KAFKA_NBA_TOPIC || 'cdh-nba';
const GROUP_ID = process.env.KAFKA_GROUP_ID || 'cdh-feedback-loop-group';

const kafka = new Kafka({ clientId: 'cdh-feedback-loop-consumer', brokers });
const consumer = kafka.consumer({ groupId: GROUP_ID });

let running = false;

async function start() {
  if (running) return;
  running = true;

  await consumer.connect();
  logger.info('Kafka consumer connected', { brokers, topic: NBA_TOPIC, groupId: GROUP_ID });

  await consumer.subscribe({ topic: NBA_TOPIC, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      let raw;
      try {
        raw = JSON.parse(message.value.toString());
      } catch (err) {
        logger.warn('Failed to parse Kafka message', { topic, partition, err: err.message });
        return;
      }

      try {
        const decision = await feedbackProcessor.processDecision(raw);
        logger.info('NBA decision consumed from Kafka', {
          decisionId: decision.decisionId,
          customerId: decision.customerId,
          outcome: decision.outcome,
        });
      } catch (err) {
        logger.error('Error processing Kafka NBA decision', { err: err.message, raw });
      }
    },
  });
}

async function stop() {
  if (!running) return;
  running = false;
  await consumer.disconnect();
  logger.info('Kafka consumer disconnected');
}

module.exports = { start, stop };
