'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const store = require('../profile-store');
const { matchByEmail, matchByPhone, mergeProfiles } = require('../dedup-engine');
const { pushToCdh } = require('../cdh-push');
const reviewQueue = require('../identity/review-queue');
const { deduplicateAndMerge, getIdentityGraph } = require('../identity/match-engine');
const anonymousStitcher = require('../identity/anonymous-stitcher');
const deviceLinker      = require('../identity/device-linker');

/**
 * POST /v1/profiles
 * Upsert a profile — runs identity matching first.
 * If a match is found (same email/phone), merges into existing golden record.
 * Otherwise creates a new profile.
 */
router.post('/', async (req, res) => {
  try {
    const incoming = req.body;
    if (!incoming.customerId) return res.status(400).json({ error: 'customerId required' });

    const { findBestMatch } = require('../identity/match-engine');
    const result = await findBestMatch(incoming);

    if (result.action === 'AUTO_MERGE' && result.match) {
      // Merge incoming data into the existing golden profile
      const merged = await store.merge(result.match.customerId, incoming);
      return res.status(200).json({
        customerId: result.match.customerId,
        action: 'MERGED',
        confidence: result.confidence,
        goldenId: result.match.customerId,
        profile: merged,
      });
    }
    if (result.action === 'REVIEW_QUEUED') {
      // Save incoming as its own profile but flag for review
      await store.set(incoming.customerId, incoming);
      return res.status(202).json({
        customerId: incoming.customerId,
        action: 'REVIEW_QUEUED',
        confidence: result.confidence,
        reviewId: result.reviewId,
      });
    }
    // No match — create new profile
    await store.set(incoming.customerId, incoming);
    return res.status(201).json({
      customerId: incoming.customerId,
      action: 'CREATED',
      confidence: 0,
    });
  } catch (err) {
    logger.error('POST /v1/profiles error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /v1/profiles/stats
 * Returns total profile count and latency percentiles.
 * Must be defined BEFORE /:customerId to avoid route conflict.
 */
router.get('/stats', async (req, res) => {
  try {
    const [totalProfiles, latencyStats] = await Promise.all([
      store.count(),
      store.getStats(),
    ]);
    res.json({
      totalProfiles,
      latency: latencyStats,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Failed to get stats', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

// ─── Review queue routes ─────────────────────────────────────────────────────
// These must be declared BEFORE /:customerId to avoid route conflicts.

/**
 * GET /v1/profiles/review/stats
 * Return aggregate counts for the review queue.
 */
router.get('/review/stats', async (req, res) => {
  try {
    const stats = await reviewQueue.getStats();
    res.json(stats);
  } catch (err) {
    logger.error('Failed to get review stats', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve review queue stats' });
  }
});

/**
 * GET /v1/profiles/review/queue
 * List pending review items (most recent first, default limit 50).
 * Query params: limit (number)
 */
router.get('/review/queue', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  try {
    const items = await reviewQueue.getPending(limit);
    res.json({ items, count: items.length });
  } catch (err) {
    logger.error('Failed to list review queue', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve review queue' });
  }
});

/**
 * GET /v1/profiles/review/:reviewId
 * Return a single review item by ID.
 */
router.get('/review/:reviewId', async (req, res) => {
  const { reviewId } = req.params;
  try {
    const item = await reviewQueue.getItem(reviewId);
    if (!item) {
      return res.status(404).json({ error: 'Review item not found', reviewId });
    }
    res.json(item);
  } catch (err) {
    logger.error('Failed to get review item', { reviewId, error: err.message });
    res.status(500).json({ error: 'Failed to retrieve review item' });
  }
});

/**
 * POST /v1/profiles/review/:reviewId/approve
 * Approve a pending merge and execute the deduplication.
 * Body: { resolvedBy?: string }
 */
router.post('/review/:reviewId/approve', async (req, res) => {
  const { reviewId } = req.params;
  const resolvedBy   = (req.body && req.body.resolvedBy) || req.headers['x-operator-id'] || 'api';

  try {
    const { primaryId, secondaryId } = await reviewQueue.approve(reviewId, resolvedBy);
    const goldenRecord = await deduplicateAndMerge(primaryId, secondaryId);

    logger.info('Review approved and profiles merged', { reviewId, primaryId, secondaryId, resolvedBy });

    res.json({
      success:     true,
      reviewId,
      primaryId,
      secondaryId,
      resolvedBy,
      profile:     goldenRecord,
    });
  } catch (err) {
    logger.error('Failed to approve review', { reviewId, error: err.message });
    const status = err.message.includes('not found') ? 404
      : err.message.includes('already') ? 409
      : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /v1/profiles/review/:reviewId/reject
 * Reject a pending merge (no profiles are modified).
 * Body: { resolvedBy?: string }
 */
router.post('/review/:reviewId/reject', async (req, res) => {
  const { reviewId } = req.params;
  const resolvedBy   = (req.body && req.body.resolvedBy) || req.headers['x-operator-id'] || 'api';

  try {
    await reviewQueue.reject(reviewId, resolvedBy);

    logger.info('Review rejected', { reviewId, resolvedBy });

    res.json({ success: true, reviewId, resolvedBy });
  } catch (err) {
    logger.error('Failed to reject review', { reviewId, error: err.message });
    const status = err.message.includes('not found') ? 404
      : err.message.includes('already') ? 409
      : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Standard profile routes ──────────────────────────────────────────────────

/**
 * GET /v1/profiles/:customerId
 * Return unified profile from Redis (sub-100ms).
 */
router.get('/:customerId', async (req, res) => {
  const { customerId } = req.params;
  const start = Date.now();

  try {
    const profile = await store.get(customerId);
    const latencyMs = Date.now() - start;

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found', customerId });
    }

    res.setHeader('X-Latency-Ms', latencyMs);
    res.json(profile);
  } catch (err) {
    logger.error('Failed to retrieve profile', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

/**
 * POST /v1/profiles/:customerId/merge
 * Trigger manual profile merge with deduplication.
 * Body: { mergeWith: { email?, phone?, customerId? } }
 */
router.post('/:customerId/merge', async (req, res) => {
  const { customerId } = req.params;
  const { mergeWith = {}, partialProfile } = req.body || {};

  try {
    const primary = await store.get(customerId);
    if (!primary) {
      return res.status(404).json({ error: 'Primary profile not found', customerId });
    }

    // If partialProfile provided, do a field merge
    if (partialProfile) {
      const merged = await store.merge(customerId, { ...partialProfile, _source: 'manual-merge' });
      return res.json({ success: true, profile: merged, operation: 'field-merge' });
    }

    // If mergeWith provided, find secondary profile and merge
    let secondary = null;
    if (mergeWith.customerId) {
      secondary = await store.get(mergeWith.customerId);
    } else if (mergeWith.email) {
      secondary = await matchByEmail(mergeWith.email);
    } else if (mergeWith.phone) {
      secondary = await matchByPhone(mergeWith.phone);
    }

    if (!secondary) {
      return res.status(404).json({ error: 'Secondary profile not found', mergeWith });
    }

    if (secondary.customerId === primary.customerId) {
      return res.status(400).json({ error: 'Cannot merge profile with itself' });
    }

    const merged = mergeProfiles(primary, secondary);
    await store.set(primary.customerId, merged);

    // Remove secondary profile after merge
    await store.deleteProfile(secondary.customerId);

    logger.info('Manual profile merge completed', {
      primaryId: primary.customerId,
      secondaryId: secondary.customerId,
    });

    res.json({ success: true, profile: merged, operation: 'profile-merge' });
  } catch (err) {
    logger.error('Failed to merge profiles', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to merge profiles' });
  }
});

/**
 * GET /v1/profiles/:customerId/identity
 * Return the full identity graph for a customer:
 * all aliases, devices, merged IDs, and sources.
 */
router.get('/:customerId/identity', async (req, res) => {
  const { customerId } = req.params;

  try {
    const graph = await getIdentityGraph(customerId);
    if (!graph) {
      return res.status(404).json({ error: 'Profile not found', customerId });
    }
    res.json(graph);
  } catch (err) {
    logger.error('Failed to retrieve identity graph', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to retrieve identity graph' });
  }
});

/**
 * GET /v1/profiles/:customerId/history
 * Return profile change history (last 100 snapshots).
 */
router.get('/:customerId/history', async (req, res) => {
  const { customerId } = req.params;

  try {
    const profile = await store.get(customerId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found', customerId });
    }

    const history = await store.getHistory(customerId);
    res.json({ customerId, history, count: history.length });
  } catch (err) {
    logger.error('Failed to retrieve history', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to retrieve profile history' });
  }
});

/**
 * DELETE /v1/profiles/:customerId
 * Delete profile (GDPR erasure).
 */
router.delete('/:customerId', async (req, res) => {
  const { customerId } = req.params;

  try {
    const profile = await store.get(customerId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found', customerId });
    }

    await store.deleteProfile(customerId);
    logger.info('Profile deleted (GDPR request)', { customerId, requestId: req.requestId });

    res.json({ success: true, customerId, deletedAt: new Date().toISOString() });
  } catch (err) {
    logger.error('Failed to delete profile', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

/**
 * POST /v1/profiles/:customerId/push
 * Manually push a profile to Pega CDH.
 */
router.post('/:customerId/push', async (req, res) => {
  const { customerId } = req.params;

  try {
    const profile = await store.get(customerId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found', customerId });
    }

    const result = await pushToCdh(profile);
    res.json({ success: true, customerId, cdh: result });
  } catch (err) {
    logger.error('Failed to push to CDH', { customerId, error: err.message });
    res.status(502).json({ error: 'Failed to push profile to CDH', detail: err.message });
  }
});

/**
 * PUT /v1/profiles/:customerId
 * Create or update a profile directly.
 */
router.put('/:customerId', async (req, res) => {
  const { customerId } = req.params;
  const profileData = req.body;

  if (!profileData || typeof profileData !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  try {
    const merged = await store.merge(customerId, { ...profileData, _source: 'api' });
    res.status(200).json(merged);
  } catch (err) {
    logger.error('Failed to update profile', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ─── Anonymous Identity routes ────────────────────────────────────────────────
// NOTE: These routes are intentionally prefixed with /identity so they can be
// mounted at any path prefix by the Express app.  The profile router mounts
// this file at /v1/profiles, but the event-collector calls the paths as
// /v1/identity/…  — if the app mounts this router at /v1 the paths will align.
// Make sure the application also registers router at /v1 or adjust the mount.

/**
 * POST /v1/identity/stitch
 * Stitch an anonymous cookie profile to a known customer.
 * Body: { cookieId, customerId, source }
 */
router.post('/identity/stitch', async (req, res) => {
  const { cookieId, customerId, source } = req.body || {};

  if (!cookieId || !customerId) {
    return res.status(400).json({ error: 'cookieId and customerId are required' });
  }

  try {
    const result = await anonymousStitcher.stitchToKnown(
      cookieId,
      customerId,
      source || 'api'
    );
    const status = result.stitched ? 200 : 409;
    res.status(status).json(result);
  } catch (err) {
    logger.error('Failed to stitch profile', { cookieId, customerId, error: err.message });
    res.status(500).json({ error: 'Stitch failed', detail: err.message });
  }
});

/**
 * GET /v1/identity/stitch/stats
 * Return aggregate stitch statistics.
 * Must be defined BEFORE /identity/anon/:cookieId to avoid route conflict.
 */
router.get('/identity/stitch/stats', async (req, res) => {
  try {
    const stats = await anonymousStitcher.getStitchStats();
    res.json(stats);
  } catch (err) {
    logger.error('Failed to get stitch stats', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve stitch stats' });
  }
});

/**
 * GET /v1/identity/anon/:cookieId
 * Return a summary of the anonymous profile: event count, segments, age.
 */
router.get('/identity/anon/:cookieId', async (req, res) => {
  const { cookieId } = req.params;

  try {
    const profile = await anonymousStitcher.getOrCreateAnon(cookieId);
    const ageMs   = Date.now() - new Date(profile.createdAt).getTime();

    res.json({
      cookieId,
      eventCount:  profile.events.length,
      segments:    profile.segments,
      createdAt:   profile.createdAt,
      lastSeenAt:  profile.lastSeenAt,
      ageSeconds:  Math.round(ageMs / 1000),
    });
  } catch (err) {
    logger.error('Failed to get anon profile', { cookieId, error: err.message });
    res.status(500).json({ error: 'Failed to retrieve anonymous profile' });
  }
});

/**
 * POST /v1/identity/anon/:cookieId/event
 * Track an event on the anonymous profile.
 * Body: event object — { eventType, category?, sessionId?, ... }
 */
router.post('/identity/anon/:cookieId/event', async (req, res) => {
  const { cookieId } = req.params;
  const event = req.body;

  if (!event || !event.eventType) {
    return res.status(400).json({ error: 'eventType is required in the request body' });
  }

  try {
    const profile = await anonymousStitcher.trackAnonEvent(cookieId, event);
    res.status(201).json({
      success:    true,
      cookieId,
      eventCount: profile.events.length,
      segments:   profile.segments,
    });
  } catch (err) {
    logger.error('Failed to track anon event', { cookieId, error: err.message });
    res.status(500).json({ error: 'Failed to track anonymous event' });
  }
});

/**
 * POST /v1/identity/device/register
 * Register a device and link it to a known customer.
 * Body: { customerId, deviceId, deviceType, metadata }
 */
router.post('/identity/device/register', async (req, res) => {
  const { customerId, deviceId, deviceType, metadata } = req.body || {};

  if (!customerId || !deviceId) {
    return res.status(400).json({ error: 'customerId and deviceId are required' });
  }

  try {
    const result = await deviceLinker.registerDevice(customerId, deviceId, deviceType, metadata);
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    logger.error('Failed to register device', { customerId, deviceId, error: err.message });
    res.status(500).json({ error: 'Failed to register device', detail: err.message });
  }
});

/**
 * GET /v1/identity/device/:deviceId
 * Resolve a device identifier to a customerId.
 */
router.get('/identity/device/:deviceId', async (req, res) => {
  const { deviceId } = req.params;

  try {
    const result = await deviceLinker.resolveDevice(deviceId);
    if (!result || !result.customerId) {
      return res.status(404).json({ error: 'Device not found', deviceId });
    }
    res.json(result);
  } catch (err) {
    logger.error('Failed to resolve device', { deviceId, error: err.message });
    res.status(500).json({ error: 'Failed to resolve device' });
  }
});

module.exports = router;
