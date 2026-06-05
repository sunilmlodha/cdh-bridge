'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const store = require('../profile-store');
const { matchByEmail, matchByPhone, mergeProfiles } = require('../dedup-engine');
const { pushToCdh } = require('../cdh-push');

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

module.exports = router;
