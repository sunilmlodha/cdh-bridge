'use strict';

/**
 * Manages anonymous visitor profiles and stitches them to known customers on login.
 *
 * Redis keys:
 *   anon:profile:{cookieId}   — anonymous profile (TTL 30 days)
 *   anon:sessions:{cookieId}  — ZSET of session timestamps
 *   anon:stitch:{cookieId}    — forwarding pointer post-stitch
 *   stitch:log                — LIST of stitch audit records
 */

const store        = require('../profile-store');
const { pushToCdh } = require('../cdh-push');
const logger       = require('../logger');

const ANON_TTL         = 30 * 24 * 60 * 60; // 30 days in seconds
const MAX_ANON_EVENTS  = 200;
const MAX_KNOWN_EVENTS = 500;
const STITCH_LOG_KEY   = 'stitch:log';
const STITCH_LOG_MAX   = 10000;

// ─── Redis key helpers ────────────────────────────────────────────────────────

function anonProfileKey(cookieId)   { return `anon:profile:${cookieId}`; }
function anonSessionsKey(cookieId)  { return `anon:sessions:${cookieId}`; }
function anonStitchKey(cookieId)    { return `anon:stitch:${cookieId}`; }
function profileKey(customerId)     { return `profile:${customerId}`; }

function getClient() { return store.getClient(); }

// ─── Segment auto-detection ───────────────────────────────────────────────────

/**
 * Derive segments from the event array.
 * Rules:
 *   - 3+ product_view events in the same category → "Browsing{Category}"
 *   - 5+ distinct sessions (unique sessionId) → "HighEngagement"
 *   - 2+ offer_reject events → "OfferSensitive"
 */
function deriveSegments(events) {
  const segments = new Set();

  // Count product_view by category
  const catCounts = {};
  let offerRejects = 0;
  const sessionIds = new Set();

  for (const ev of events) {
    if (ev.eventType === 'product_view' && ev.category) {
      catCounts[ev.category] = (catCounts[ev.category] || 0) + 1;
    }
    if (ev.eventType === 'offer_reject') {
      offerRejects += 1;
    }
    if (ev.sessionId) {
      sessionIds.add(ev.sessionId);
    }
  }

  for (const [cat, count] of Object.entries(catCounts)) {
    if (count >= 3) {
      // Normalise: "home loan" → "HomeLoan"
      const label = cat
        .split(/[\s_-]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
      segments.add(`Browsing${label}`);
    }
  }

  if (sessionIds.size >= 5) {
    segments.add('HighEngagement');
  }

  if (offerRejects >= 2) {
    segments.add('OfferSensitive');
  }

  return [...segments];
}

// ─── Stitch value scoring ─────────────────────────────────────────────────────

/**
 * Calculate how much new signal the anon profile adds to the known profile.
 * Returns a score 0–100.
 */
function calculateStitchScore({ anonEvents, newSegments, sessionCount, profileAgeMs }) {
  let score = 0;

  // Events signal (max 40 pts)
  score += Math.min(40, anonEvents * 2);

  // Segment signal (max 30 pts, 10 per new segment)
  score += Math.min(30, newSegments * 10);

  // Engagement depth (max 20 pts)
  score += Math.min(20, sessionCount * 4);

  // Profile age bonus (max 10 pts — older anon profile = more intent signal)
  const ageDays = profileAgeMs / (1000 * 60 * 60 * 24);
  score += Math.min(10, Math.floor(ageDays));

  return Math.min(100, Math.round(score));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get or create an anonymous profile for the given cookieId.
 * Always updates lastSeenAt.
 *
 * @param {string} cookieId
 * @returns {Promise<object>} AnonProfile
 */
async function getOrCreateAnon(cookieId) {
  const client = getClient();
  const key    = anonProfileKey(cookieId);

  const raw = await client.get(key);
  let profile;

  if (raw) {
    profile = JSON.parse(raw);
  } else {
    profile = {
      cookieId,
      createdAt:  new Date().toISOString(),
      events:     [],
      segments:   [],
    };
    logger.info('Created anonymous profile', { cookieId });
  }

  profile.lastSeenAt = new Date().toISOString();
  await client.setex(key, ANON_TTL, JSON.stringify(profile));

  return profile;
}

/**
 * Append an event to the anonymous profile and update derived segments.
 * The event array is capped at MAX_ANON_EVENTS (200).
 *
 * @param {string} cookieId
 * @param {object} event  — { eventType, category?, sessionId?, ...rest }
 * @returns {Promise<object>} Updated profile
 */
async function trackAnonEvent(cookieId, event) {
  const client  = getClient();
  const key     = anonProfileKey(cookieId);
  const profile = await getOrCreateAnon(cookieId);

  // Append event with a timestamp if not present
  const stamped = { ...event, recordedAt: event.recordedAt || new Date().toISOString() };
  profile.events.push(stamped);

  // Cap at 200 — keep the most recent
  if (profile.events.length > MAX_ANON_EVENTS) {
    profile.events = profile.events.slice(-MAX_ANON_EVENTS);
  }

  // Re-derive segments from full event history
  const derived  = deriveSegments(profile.events);
  const existing = new Set(profile.segments);
  for (const seg of derived) {
    existing.add(seg);
  }
  profile.segments = [...existing];

  // Track session in ZSET (for session count)
  if (event.sessionId) {
    const sessionKey = anonSessionsKey(cookieId);
    await client.zadd(sessionKey, Date.now(), event.sessionId);
    await client.expire(sessionKey, ANON_TTL);
  }

  profile.lastSeenAt = new Date().toISOString();
  await client.setex(key, ANON_TTL, JSON.stringify(profile));

  logger.debug('Tracked anon event', { cookieId, eventType: event.eventType });
  return profile;
}

/**
 * Stitch an anonymous profile to a known customer.
 *
 * Steps:
 *  1. Load anon profile (return early if none)
 *  2. Load/create known profile
 *  3. Merge events (prepend anon events, keep last 500)
 *  4. Union segments
 *  5. Add cookieId to known profile devices[]
 *  6. Calculate stitch value score
 *  7. Save merged profile
 *  8. Create alias pointer anon:{cookieId} → customerId
 *  9. Push to Pega CDH (high priority)
 * 10. Log audit record
 * 11. Delete anon profile (GDPR)
 *
 * @param {string} cookieId
 * @param {string} customerId
 * @param {string} source      — e.g. 'login-event'
 * @returns {Promise<object>}
 */
async function stitchToKnown(cookieId, customerId, source) {
  const client = getClient();

  // 1. Load anon profile
  const anonRaw = await client.get(anonProfileKey(cookieId));
  if (!anonRaw) {
    logger.info('Stitch called but no anon profile found', { cookieId, customerId });
    return { stitched: false, reason: 'NO_ANON_PROFILE' };
  }
  const anonProfile = JSON.parse(anonRaw);

  // Check if already stitched
  const stitchPointer = await client.get(anonStitchKey(cookieId));
  if (stitchPointer) {
    logger.info('Cookie already stitched', { cookieId, stitchedTo: stitchPointer });
    return { stitched: false, reason: 'ALREADY_STITCHED', stitchedTo: stitchPointer };
  }

  // 2. Load or create known profile
  const knownRaw = await client.get(profileKey(customerId));
  const knownProfile = knownRaw
    ? JSON.parse(knownRaw)
    : {
        customerId,
        createdAt:          new Date().toISOString(),
        interactionHistory: [],
        segments:           [],
        devices:            [],
      };

  // 3. Merge events — prepend anon events before known events, cap at 500
  const existingHistory = knownProfile.interactionHistory || [];
  const merged = [...anonProfile.events, ...existingHistory].slice(-MAX_KNOWN_EVENTS);
  knownProfile.interactionHistory = merged;

  // 4. Union segments
  const knownSegments = new Set(knownProfile.segments || []);
  const newSegments   = [];
  for (const seg of (anonProfile.segments || [])) {
    if (!knownSegments.has(seg)) {
      knownSegments.add(seg);
      newSegments.push(seg);
    }
  }
  knownProfile.segments = [...knownSegments];

  // 5. Add cookieId to devices[]
  const devices = knownProfile.devices || [];
  if (!devices.includes(cookieId)) {
    devices.push(cookieId);
  }
  knownProfile.devices = devices;
  knownProfile.lastStitchedAt = new Date().toISOString();

  // 6. Calculate stitch score
  const sessionCount = await (async () => {
    try {
      return await client.zcard(anonSessionsKey(cookieId));
    } catch {
      return 0;
    }
  })();

  const profileAgeMs = Date.now() - new Date(anonProfile.createdAt).getTime();
  const stitchScore  = calculateStitchScore({
    anonEvents:   anonProfile.events.length,
    newSegments:  newSegments.length,
    sessionCount,
    profileAgeMs,
  });

  // 7. Save merged known profile
  const knownProfileTtl = 365 * 24 * 60 * 60; // 1 year for known profiles
  await client.setex(profileKey(customerId), knownProfileTtl, JSON.stringify(knownProfile));

  // 8. Create alias pointer
  await client.setex(anonStitchKey(cookieId), ANON_TTL, customerId);

  // 9. Push to Pega CDH (high priority — NBA is about to fire)
  try {
    await pushToCdh(knownProfile, { priority: 'high', trigger: 'stitch' });
    logger.info('Pushed stitched profile to Pega CDH', { customerId, cookieId });
  } catch (err) {
    logger.error('Failed to push stitched profile to CDH', { customerId, error: err.message });
    // Non-fatal — stitch still succeeds
  }

  // 10. Log audit record
  const auditRecord = {
    cookieId,
    customerId,
    source,
    stitchedAt:     new Date().toISOString(),
    eventsAdded:    anonProfile.events.length,
    segmentsAdded:  newSegments,
    sessionCount,
    stitchScore,
  };
  await client.lpush(STITCH_LOG_KEY, JSON.stringify(auditRecord));
  // Trim log to prevent unbounded growth
  await client.ltrim(STITCH_LOG_KEY, 0, STITCH_LOG_MAX - 1);

  // 11. Delete anon profile (GDPR: no orphaned data)
  await client.del(anonProfileKey(cookieId));
  await client.del(anonSessionsKey(cookieId));

  logger.info('Anonymous profile stitched to known customer', {
    cookieId,
    customerId,
    source,
    stitchScore,
    eventsAdded:   anonProfile.events.length,
    segmentsAdded: newSegments.length,
  });

  return {
    stitched:    true,
    customerId,
    cookieId,
    source,
    signalAdded: {
      events:       anonProfile.events.length,
      segments:     newSegments,
      sessionCount,
    },
    stitchScore,
  };
}

/**
 * Return aggregate stitch statistics.
 *
 * @returns {Promise<{ totalStitches, avgSignalAdded, stitchesLast24h }>}
 */
async function getStitchStats() {
  const client = getClient();

  const total = await client.llen(STITCH_LOG_KEY);
  if (total === 0) {
    return { totalStitches: 0, avgSignalAdded: 0, stitchesLast24h: 0 };
  }

  // Fetch most recent 1000 records to compute averages
  const sample = Math.min(total, 1000);
  const raw    = await client.lrange(STITCH_LOG_KEY, 0, sample - 1);
  const records = raw.map((r) => JSON.parse(r));

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let stitchesLast24h = 0;
  let totalEvents     = 0;

  for (const rec of records) {
    totalEvents += rec.eventsAdded || 0;
    if (new Date(rec.stitchedAt).getTime() >= cutoff) {
      stitchesLast24h += 1;
    }
  }

  return {
    totalStitches:   total,
    avgSignalAdded:  records.length > 0 ? Math.round(totalEvents / records.length) : 0,
    stitchesLast24h,
  };
}

/**
 * Return the number of active anonymous profiles.
 *
 * @returns {Promise<number>}
 */
async function getAnonCount() {
  const client = getClient();
  const keys   = await client.keys('anon:profile:*');
  return keys.length;
}

/**
 * Read-only lookup — returns null if not found (does NOT create).
 * Use this for GET endpoints so deleted anon profiles return 404.
 */
async function getAnon(cookieId) {
  const client = getClient();
  const raw = await client.get(anonProfileKey(cookieId));
  if (!raw) return null;
  return JSON.parse(raw);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getAnon,
  getOrCreateAnon,
  trackAnonEvent,
  stitchToKnown,
  getStitchStats,
  getAnonCount,
};
