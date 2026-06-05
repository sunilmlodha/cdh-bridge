'use strict';

const axios = require('axios');
const { CronJob } = require('cron');
const logger = require('./logger');
const store = require('./profile-store');

const PEGA_CDH_URL = process.env.PEGA_CDH_URL || 'http://localhost:8080';
const PEGA_CDH_API_KEY = process.env.PEGA_CDH_API_KEY || '';
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

let job = null;

/**
 * Push a single unified profile to Pega CDH.
 */
async function pushToCdh(profile) {
  if (!profile || !profile.customerId) {
    throw new Error('Invalid profile: missing customerId');
  }

  const url = `${PEGA_CDH_URL}/customerprofile`;
  const headers = {
    'Content-Type': 'application/json',
    ...(PEGA_CDH_API_KEY ? { Authorization: `Bearer ${PEGA_CDH_API_KEY}` } : {}),
  };

  const payload = {
    CustomerID: profile.customerId,
    Email: profile.email,
    Phone: profile.phone,
    FirstName: profile.firstName,
    LastName: profile.lastName,
    Segments: profile.segments || [],
    LTV: profile.ltv,
    Tier: profile.tier,
    Consent: profile.consent || {},
    Sources: profile.sources || [],
    LastUpdated: profile.updatedAt,
    MergedIds: profile.mergedIds || [],
  };

  try {
    const response = await axios.post(url, payload, {
      headers,
      timeout: 10000,
    });
    logger.debug('Profile pushed to CDH', {
      customerId: profile.customerId,
      status: response.status,
    });
    return { success: true, status: response.status };
  } catch (err) {
    const status = err.response?.status;
    logger.error('Failed to push profile to CDH', {
      customerId: profile.customerId,
      status,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Identify profiles that haven't been pushed to CDH recently (stale),
 * then push them.
 */
async function pushStaleProfiles() {
  const client = store.getClient();
  logger.debug('Starting stale profile refresh scan');

  try {
    // Scan for all profile keys
    let cursor = '0';
    let pushed = 0;
    let errors = 0;

    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'profile:*', 'COUNT', 100);
      cursor = nextCursor;

      for (const key of keys) {
        // Skip non-direct profile keys
        if (!/^profile:[^:]+$/.test(key)) continue;

        let raw;
        try {
          raw = await client.get(key);
        } catch {
          continue;
        }
        if (!raw) continue;

        let profile;
        try {
          profile = JSON.parse(raw);
        } catch {
          continue;
        }

        // Check if stale
        const updatedAt = profile.updatedAt ? new Date(profile.updatedAt).getTime() : 0;
        const lastPushedAt = profile._lastPushedAt ? new Date(profile._lastPushedAt).getTime() : 0;
        const now = Date.now();

        const isStale = (now - lastPushedAt) > STALE_THRESHOLD_MS;
        if (!isStale) continue;

        try {
          await pushToCdh(profile);
          // Update lastPushedAt without triggering another push loop
          profile._lastPushedAt = new Date().toISOString();
          await client.set(key, JSON.stringify(profile), 'KEEPTTL');
          pushed++;
        } catch {
          errors++;
        }
      }
    } while (cursor !== '0');

    logger.info('Stale profile refresh complete', { pushed, errors });
  } catch (err) {
    logger.error('Error during stale profile refresh', { error: err.message });
  }
}

/**
 * Schedule a refresh job every 5 minutes.
 */
function scheduleRefresh() {
  if (job) return; // Already scheduled

  job = new CronJob('*/5 * * * *', async () => {
    await pushStaleProfiles();
  }, null, true, 'UTC');

  logger.info('CDH refresh scheduler started (every 5 minutes)');
}

/**
 * Stop the scheduled refresh.
 */
function stopScheduler() {
  if (job) {
    job.stop();
    job = null;
  }
}

module.exports = {
  pushToCdh,
  scheduleRefresh,
  stopScheduler,
  pushStaleProfiles,
};
