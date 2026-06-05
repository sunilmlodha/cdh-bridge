'use strict';

/**
 * dedup-engine.js — thin compatibility wrapper around the identity match-engine.
 *
 * The original three-method API (matchByEmail, matchByPhone, matchById, mergeProfiles)
 * is preserved for backward compatibility. New callers should use findBestMatch and
 * resolveIdentity from this module or import match-engine directly.
 */

const logger      = require('./logger');
const store       = require('./profile-store');
const matchEngine = require('./identity/match-engine');
const { applySurvivorshipRules } = require('./identity/survivorship-rules');

// ─── Backward-compatible API ──────────────────────────────────────────────────

/**
 * Find an existing profile by email address.
 * Returns the profile or null.
 *
 * @param {string} email
 * @returns {Promise<object|null>}
 */
async function matchByEmail(email) {
  if (!email) return null;
  const client = store.getClient();
  const { normaliseEmail } = require('./identity/confidence-scorer');
  try {
    const customerId = await client.get(store.emailIndexKey(normaliseEmail(email)));
    if (!customerId) return null;
    return store.get(customerId);
  } catch (err) {
    logger.error('matchByEmail error', { email, error: err.message });
    return null;
  }
}

/**
 * Find an existing profile by phone number.
 * Returns the profile or null.
 *
 * @param {string} phone
 * @returns {Promise<object|null>}
 */
async function matchByPhone(phone) {
  if (!phone) return null;
  const client = store.getClient();
  const { normalisePhone } = require('./identity/confidence-scorer');
  try {
    const customerId = await client.get(store.phoneIndexKey(normalisePhone(phone)));
    if (!customerId) return null;
    return store.get(customerId);
  } catch (err) {
    logger.error('matchByPhone error', { phone, error: err.message });
    return null;
  }
}

/**
 * Direct lookup by customerId.
 *
 * @param {string} customerId
 * @returns {Promise<object|null>}
 */
async function matchById(customerId) {
  if (!customerId) return null;
  return store.get(customerId);
}

/**
 * Merge two profiles into one unified profile using survivorship rules.
 * Keeps primary.customerId. Returns the merged profile object (does NOT persist).
 *
 * For persistence, use deduplicateAndMerge which also updates indexes.
 *
 * @param {object} primary
 * @param {object} secondary
 * @returns {object}
 */
function mergeProfiles(primary, secondary) {
  if (!primary || !secondary) {
    return primary || secondary;
  }

  const merged = applySurvivorshipRules([primary, secondary]);
  merged.customerId = primary.customerId;
  merged.goldenId   = primary.customerId;

  // Track merged IDs for audit trail
  const existingMergedIds = Array.isArray(primary.mergedIds) ? primary.mergedIds : [];
  merged.mergedIds = [...new Set([...existingMergedIds, secondary.customerId])].filter(Boolean);
  merged.mergedAt  = new Date().toISOString();

  logger.info('Profiles merged (legacy)', {
    primaryId:   primary.customerId,
    secondaryId: secondary.customerId,
  });

  return merged;
}

// ─── New identity resolution API (delegates to match-engine) ──────────────────

/**
 * Find the best matching existing profile for an incoming profile fragment.
 *
 * @param {object} incomingProfile
 * @returns {Promise<{ match: object|null, action: string, confidence: number, reviewId?: string }>}
 */
const findBestMatch = matchEngine.findBestMatch;

/**
 * Walk the identity alias graph to find the golden customerId for any identifier.
 *
 * @param {string} anyIdentifier
 * @returns {Promise<string|null>}
 */
const resolveIdentity = matchEngine.resolveIdentity;

/**
 * Merge two profiles by ID, applying survivorship rules and updating all indexes.
 *
 * @param {string} primaryId
 * @param {string} secondaryId
 * @returns {Promise<object>}
 */
const deduplicateAndMerge = matchEngine.deduplicateAndMerge;

module.exports = {
  // Legacy API (backward compatible)
  matchByEmail,
  matchByPhone,
  matchById,
  mergeProfiles,
  // New identity resolution API
  findBestMatch,
  resolveIdentity,
  deduplicateAndMerge,
};
