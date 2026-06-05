'use strict';

/**
 * Redis-backed queue for profile matches needing human review (confidence 0.75–0.94).
 *
 * Redis keys:
 *   review:queue          ZSET   — score=timestamp, member=reviewId
 *   review:item:{id}      STRING — ReviewItem JSON
 *   review:stats          HASH   — total, approved, rejected, pending
 *
 * ReviewItem shape:
 * {
 *   reviewId, createdAt, confidence, matchRule,
 *   profileA: { customerId, email, phone, firstName, lastName, postalCode, sources },
 *   profileB: { customerId, email, phone, firstName, lastName, postalCode, sources },
 *   status: 'pending' | 'approved' | 'rejected',
 *   resolvedAt, resolvedBy
 * }
 */

const { v4: uuidv4 } = require('crypto'); // fallback below
const store = require('../profile-store');
const logger = require('../logger');

const REVIEW_QUEUE_KEY  = 'review:queue';
const REVIEW_STATS_KEY  = 'review:stats';
const REVIEW_ITEM_TTL   = 90 * 24 * 60 * 60; // 90 days

/**
 * Generate a simple unique review ID without external deps.
 * Falls back to crypto.randomBytes when uuid is unavailable.
 */
function generateReviewId() {
  try {
    // Node built-in randomUUID available >= 14.17
    return require('crypto').randomUUID();
  } catch (_) {
    // Fallback: hex string from randomBytes
    return require('crypto').randomBytes(16).toString('hex');
  }
}

function reviewItemKey(reviewId) {
  return `review:item:${reviewId}`;
}

/**
 * Extract a safe subset of a profile for storage in the review item.
 */
function profileSnapshot(profile) {
  if (!profile) return {};
  return {
    customerId:  profile.customerId,
    email:       profile.email,
    phone:       profile.phone,
    firstName:   profile.firstName,
    lastName:    profile.lastName,
    postalCode:  profile.postalCode,
    sources:     profile.sources || [],
    _source:     profile._source,
  };
}

/**
 * Enqueue a candidate merge for human review.
 *
 * @param {object} profileA
 * @param {object} profileB
 * @param {number} confidence   0–1
 * @param {string} matchRule    e.g. 'EMAIL_DOMAIN+NAME'
 * @returns {Promise<string>} reviewId
 */
async function enqueue(profileA, profileB, confidence, matchRule) {
  const client = store.getClient();
  const reviewId  = generateReviewId();
  const createdAt = new Date().toISOString();
  const ts        = Date.now();

  const item = {
    reviewId,
    createdAt,
    confidence,
    matchRule:  matchRule || 'MULTI_SIGNAL',
    profileA:   profileSnapshot(profileA),
    profileB:   profileSnapshot(profileB),
    status:     'pending',
    resolvedAt: null,
    resolvedBy: null,
  };

  const pipeline = client.pipeline();
  pipeline.set(reviewItemKey(reviewId), JSON.stringify(item), 'EX', REVIEW_ITEM_TTL);
  pipeline.zadd(REVIEW_QUEUE_KEY, ts, reviewId);
  pipeline.hincrby(REVIEW_STATS_KEY, 'total',   1);
  pipeline.hincrby(REVIEW_STATS_KEY, 'pending', 1);

  await pipeline.exec();

  logger.info('Review item enqueued', { reviewId, confidence, matchRule });
  return reviewId;
}

/**
 * Get pending review items, most recent first.
 *
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function getPending(limit = 50) {
  const client = store.getClient();

  // ZREVRANGE returns members ordered by score descending (highest timestamp first)
  const ids = await client.zrevrange(REVIEW_QUEUE_KEY, 0, limit - 1);
  if (!ids || ids.length === 0) return [];

  const pipeline = client.pipeline();
  ids.forEach((id) => pipeline.get(reviewItemKey(id)));
  const results = await pipeline.exec();

  const items = [];
  for (const [err, raw] of results) {
    if (err || !raw) continue;
    try {
      const item = JSON.parse(raw);
      if (item.status === 'pending') items.push(item);
    } catch (_) {
      // Ignore corrupt entries
    }
  }
  return items;
}

/**
 * Retrieve a single review item by ID.
 *
 * @param {string} reviewId
 * @returns {Promise<object|null>}
 */
async function getItem(reviewId) {
  const client = store.getClient();
  const raw = await client.get(reviewItemKey(reviewId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Approve a review — marks it resolved and removes from pending queue.
 *
 * @param {string} reviewId
 * @param {string} resolvedBy   username / operator ID
 * @returns {Promise<{ primaryId: string, secondaryId: string }>}
 */
async function approve(reviewId, resolvedBy) {
  const client = store.getClient();
  const item = await getItem(reviewId);

  if (!item) throw new Error(`Review item not found: ${reviewId}`);
  if (item.status !== 'pending') throw new Error(`Review item is already ${item.status}`);

  item.status     = 'approved';
  item.resolvedAt = new Date().toISOString();
  item.resolvedBy = resolvedBy || 'system';

  const pipeline = client.pipeline();
  pipeline.set(reviewItemKey(reviewId), JSON.stringify(item), 'EX', REVIEW_ITEM_TTL);
  pipeline.zrem(REVIEW_QUEUE_KEY, reviewId);
  pipeline.hincrby(REVIEW_STATS_KEY, 'pending',  -1);
  pipeline.hincrby(REVIEW_STATS_KEY, 'approved',  1);
  await pipeline.exec();

  logger.info('Review item approved', { reviewId, resolvedBy });

  return {
    primaryId:   item.profileA.customerId,
    secondaryId: item.profileB.customerId,
  };
}

/**
 * Reject a review — marks it resolved, no merge performed.
 *
 * @param {string} reviewId
 * @param {string} resolvedBy
 * @returns {Promise<void>}
 */
async function reject(reviewId, resolvedBy) {
  const client = store.getClient();
  const item = await getItem(reviewId);

  if (!item) throw new Error(`Review item not found: ${reviewId}`);
  if (item.status !== 'pending') throw new Error(`Review item is already ${item.status}`);

  item.status     = 'rejected';
  item.resolvedAt = new Date().toISOString();
  item.resolvedBy = resolvedBy || 'system';

  const pipeline = client.pipeline();
  pipeline.set(reviewItemKey(reviewId), JSON.stringify(item), 'EX', REVIEW_ITEM_TTL);
  pipeline.zrem(REVIEW_QUEUE_KEY, reviewId);
  pipeline.hincrby(REVIEW_STATS_KEY, 'pending',  -1);
  pipeline.hincrby(REVIEW_STATS_KEY, 'rejected',  1);
  await pipeline.exec();

  logger.info('Review item rejected', { reviewId, resolvedBy });
}

/**
 * Return aggregate stats for the review queue.
 *
 * @returns {Promise<{ total: number, approved: number, rejected: number, pending: number }>}
 */
async function getStats() {
  const client = store.getClient();
  const raw = await client.hgetall(REVIEW_STATS_KEY);
  return {
    total:    parseInt((raw && raw.total)    || '0', 10),
    approved: parseInt((raw && raw.approved) || '0', 10),
    rejected: parseInt((raw && raw.rejected) || '0', 10),
    pending:  parseInt((raw && raw.pending)  || '0', 10),
  };
}

module.exports = {
  enqueue,
  getPending,
  getItem,
  approve,
  reject,
  getStats,
};
