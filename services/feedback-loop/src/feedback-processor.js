'use strict';

const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
const decisionStore = require('./decision-store');
const liftCalculator = require('./lift-calculator');
const logger = require('./logger');

const VALID_OUTCOMES = new Set(['ACCEPTED', 'REJECTED', 'IGNORED', 'CONVERTED', 'CLICKED']);

class FeedbackProcessor {
  constructor() {
    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
    this.kafka = new Kafka({
      clientId: 'cdh-feedback-loop',
      brokers,
      retry: { initialRetryTime: 300, retries: 8 },
    });
    this.producer = this.kafka.producer();
    this.producerConnected = false;
  }

  async connectProducer() {
    if (!this.producerConnected) {
      await this.producer.connect();
      this.producerConnected = true;
      logger.info('Kafka producer connected');
    }
  }

  /**
   * Validate incoming decision payload.
   */
  _validate(decision) {
    const required = ['customerId', 'action', 'outcome', 'channel'];
    for (const field of required) {
      if (!decision[field]) throw new Error(`Missing required field: ${field}`);
    }
    if (!VALID_OUTCOMES.has(decision.outcome)) {
      throw new Error(`Invalid outcome: ${decision.outcome}. Must be one of: ${[...VALID_OUTCOMES].join(', ')}`);
    }
  }

  /**
   * Enrich a raw decision with defaults and a stable decisionId.
   */
  _enrich(raw) {
    return {
      decisionId: raw.decisionId || uuidv4(),
      customerId: raw.customerId,
      action: raw.action,
      treatment: raw.treatment || null,
      outcome: raw.outcome,
      channel: raw.channel,
      timestamp: raw.timestamp || new Date().toISOString(),
      propensityScore: raw.propensityScore != null ? parseFloat(raw.propensityScore) : null,
      processedAt: new Date().toISOString(),
    };
  }

  /**
   * Main entry point. Validate, store, enrich profile, publish.
   */
  async processDecision(raw) {
    this._validate(raw);
    const decision = this._enrich(raw);
    await decisionStore.store(decision);
    logger.info('Decision processed', { decisionId: decision.decisionId, outcome: decision.outcome });

    // Enrich profile asynchronously (don't block the response)
    setImmediate(async () => {
      try {
        const history = await decisionStore.getHistory(decision.customerId, 200);
        const enriched = await this.enrichProfile(decision.customerId, history);
        await this.publishToKafka(enriched);
      } catch (err) {
        logger.error('Profile enrichment failed', { customerId: decision.customerId, err: err.message });
      }
    });

    return decision;
  }

  /**
   * Calculate lift for a specific customer vs baseline.
   */
  async calculateLift(customerId) {
    const history = await decisionStore.getHistory(customerId, 1000);
    if (!history.length) return { customerId, acceptanceRate: 0, baselineRate: liftCalculator.baselineAcceptanceRate, lift: 0 };

    const accepted = history.filter((d) => ['ACCEPTED', 'CONVERTED', 'CLICKED'].includes(d.outcome)).length;
    const rate = accepted / history.length;
    const baseline = liftCalculator.baselineAcceptanceRate;
    const lift = baseline > 0 ? ((rate - baseline) / baseline) * 100 : 0;

    return { customerId, totalDecisions: history.length, acceptanceRate: rate, baselineRate: baseline, lift };
  }

  /**
   * Build nbaContext from decision history and attach to profile envelope.
   */
  async enrichProfile(customerId, decisionHistory) {
    const accepted = decisionHistory.filter((d) => ['ACCEPTED', 'CONVERTED', 'CLICKED'].includes(d.outcome));
    const acceptanceRate = decisionHistory.length > 0 ? accepted.length / decisionHistory.length : 0;

    // Last offer / outcome
    const latest = decisionHistory[0] || {};

    // Most common channel (by accepted decisions)
    const channelCounts = {};
    for (const d of accepted) {
      channelCounts[d.channel] = (channelCounts[d.channel] || 0) + 1;
    }
    const preferredChannel = Object.entries(channelCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || null;

    // Best time of day (hour with most acceptances)
    const hourCounts = {};
    for (const d of accepted) {
      const hour = new Date(d.timestamp).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }
    const bestHour = Object.entries(hourCounts).sort(([, a], [, b]) => b - a)[0]?.[0];
    const bestTime = bestHour != null ? `${bestHour.toString().padStart(2, '0')}:00` : null;

    const nbaContext = {
      lastOffer: latest.action || null,
      lastOutcome: latest.outcome || null,
      acceptanceRate,
      preferredChannel,
      bestTime,
      decisionCount: decisionHistory.length,
      updatedAt: new Date().toISOString(),
    };

    return { customerId, nbaContext };
  }

  /**
   * Publish enriched profile to the cdh-feedback Kafka topic.
   */
  async publishToKafka(enrichedProfile) {
    await this.connectProducer();
    const topic = process.env.KAFKA_FEEDBACK_TOPIC || 'cdh-feedback';
    await this.producer.send({
      topic,
      messages: [
        {
          key: enrichedProfile.customerId,
          value: JSON.stringify(enrichedProfile),
          headers: { source: 'cdh-feedback-loop', version: '1' },
        },
      ],
    });
    logger.debug('Published enriched profile to Kafka', { customerId: enrichedProfile.customerId, topic });
  }

  async disconnect() {
    if (this.producerConnected) {
      await this.producer.disconnect();
      this.producerConnected = false;
    }
  }
}

module.exports = new FeedbackProcessor();
