'use strict';

const Redis = require('ioredis');
const logger = require('./logger');

const CUSTOMER_KEY = (id) => `cdh:feedback:customer:${id}`;
const GLOBAL_KEY = 'cdh:feedback:global';
const STATS_KEY = 'cdh:feedback:stats';
const MAX_PER_CUSTOMER = 100_000;

class DecisionStore {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    this.redis.on('error', (err) => logger.error('Redis error', { err: err.message }));
    this.redis.on('connect', () => logger.info('Redis connected'));
  }

  /**
   * Store a decision.
   * Uses sorted set keyed by timestamp (ms) for efficient range queries.
   * Caps at MAX_PER_CUSTOMER entries per customer.
   */
  async store(decision) {
    const { customerId, decisionId, timestamp } = decision;
    const score = new Date(timestamp).getTime() || Date.now();
    const value = JSON.stringify(decision);
    const customerKey = CUSTOMER_KEY(customerId);

    const pipeline = this.redis.pipeline();

    // Per-customer sorted set
    pipeline.zadd(customerKey, score, value);
    // Keep only most recent MAX_PER_CUSTOMER entries
    pipeline.zremrangebyrank(customerKey, 0, -(MAX_PER_CUSTOMER + 1));

    // Global sorted set (stores only decisionId + customerId to save memory)
    pipeline.zadd(GLOBAL_KEY, score, JSON.stringify({ decisionId, customerId, score }));
    pipeline.zremrangebyrank(GLOBAL_KEY, 0, -100_001);

    // Increment stats counters
    pipeline.hincrby(STATS_KEY, 'totalDecisions', 1);
    pipeline.hincrby(STATS_KEY, `outcome:${decision.outcome}`, 1);
    pipeline.hincrby(STATS_KEY, `channel:${decision.channel}`, 1);

    await pipeline.exec();
    logger.debug('Decision stored', { decisionId, customerId });
  }

  /**
   * Get decision history for a customer (newest first).
   */
  async getHistory(customerId, limit = 50) {
    const raw = await this.redis.zrevrange(CUSTOMER_KEY(customerId), 0, limit - 1);
    return raw.map((r) => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean);
  }

  /**
   * Aggregate stats across all decisions.
   */
  async getStats() {
    const raw = await this.redis.hgetall(STATS_KEY);
    if (!raw) return { totalDecisions: 0, outcomes: {}, channels: {} };

    const outcomes = {};
    const channels = {};

    for (const [key, val] of Object.entries(raw)) {
      if (key.startsWith('outcome:')) outcomes[key.replace('outcome:', '')] = parseInt(val, 10);
      else if (key.startsWith('channel:')) channels[key.replace('channel:', '')] = parseInt(val, 10);
    }

    const totalDecisions = parseInt(raw.totalDecisions || '0', 10);
    const accepted = outcomes['ACCEPTED'] || 0;
    const converted = outcomes['CONVERTED'] || 0;
    const acceptanceRate = totalDecisions > 0 ? (accepted + converted) / totalDecisions : 0;

    return { totalDecisions, outcomes, channels, acceptanceRate };
  }

  /**
   * Fetch the last N decisions across all customers.
   */
  async getRecentDecisions(limit = 100) {
    const rawRefs = await this.redis.zrevrange(GLOBAL_KEY, 0, limit - 1);
    const refs = rawRefs.map((r) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);

    const results = [];
    for (const ref of refs) {
      const customerKey = CUSTOMER_KEY(ref.customerId);
      // Find the specific decision in the customer's sorted set by score
      const candidates = await this.redis.zrangebyscore(customerKey, ref.score, ref.score);
      for (const c of candidates) {
        try {
          const dec = JSON.parse(c);
          if (dec.decisionId === ref.decisionId) { results.push(dec); break; }
        } catch { /* skip */ }
      }
    }
    return results;
  }

  /**
   * Get decisions within a time window for a specific customer.
   */
  async getDecisionsInWindow(customerId, windowMs) {
    const now = Date.now();
    const since = now - windowMs;
    const raw = await this.redis.zrangebyscore(CUSTOMER_KEY(customerId), since, '+inf');
    return raw.map((r) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
  }

  /**
   * Get all decisions in a time window across customers (uses global set then fetches details).
   */
  async getGlobalDecisionsInWindow(windowMs) {
    const now = Date.now();
    const since = now - windowMs;
    const rawRefs = await this.redis.zrangebyscore(GLOBAL_KEY, since, '+inf');
    const refs = rawRefs.map((r) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);

    const results = [];
    for (const ref of refs) {
      const customerKey = CUSTOMER_KEY(ref.customerId);
      const candidates = await this.redis.zrangebyscore(customerKey, ref.score, ref.score);
      for (const c of candidates) {
        try {
          const dec = JSON.parse(c);
          if (dec.decisionId === ref.decisionId) { results.push(dec); break; }
        } catch { /* skip */ }
      }
    }
    return results;
  }

  async disconnect() {
    await this.redis.quit();
  }
}

module.exports = new DecisionStore();
