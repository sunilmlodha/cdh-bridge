'use strict';

const logger = require('./logger');
const store = require('./profile-store');

/**
 * Find an existing profile by email address.
 * Returns the profile or null.
 */
async function matchByEmail(email) {
  if (!email) return null;
  const client = store.getClient();
  try {
    const customerId = await client.get(store.emailIndexKey(email));
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
 */
async function matchByPhone(phone) {
  if (!phone) return null;
  const client = store.getClient();
  try {
    const customerId = await client.get(store.phoneIndexKey(phone));
    if (!customerId) return null;
    return store.get(customerId);
  } catch (err) {
    logger.error('matchByPhone error', { phone, error: err.message });
    return null;
  }
}

/**
 * Direct lookup by customerId.
 */
async function matchById(customerId) {
  if (!customerId) return null;
  return store.get(customerId);
}

/**
 * Merge two profiles into one unified profile.
 * - Keeps primary.customerId
 * - Merges array fields (segments, sources) as union
 * - Takes latest scalar values (secondary fields fill gaps in primary)
 * - Consent: most restrictive wins (false beats true)
 * - Records secondary.customerId in mergedIds list
 */
function mergeProfiles(primary, secondary) {
  if (!primary || !secondary) {
    return primary || secondary;
  }

  const result = { ...primary };

  // Merge scalar fields: secondary fills in missing fields only (primary wins if set)
  const SCALAR_FIELDS = [
    'firstName', 'lastName', 'email', 'phone', 'dateOfBirth',
    'address', 'city', 'state', 'country', 'postalCode',
    'ltv', 'tier', 'language', 'currency',
  ];

  for (const field of SCALAR_FIELDS) {
    if ((result[field] === undefined || result[field] === null) && secondary[field] != null) {
      result[field] = secondary[field];
    }
  }

  // Merge updatedAt: keep the most recent
  const primaryUpdated = result.updatedAt ? new Date(result.updatedAt) : new Date(0);
  const secondaryUpdated = secondary.updatedAt ? new Date(secondary.updatedAt) : new Date(0);
  if (secondaryUpdated > primaryUpdated) {
    // For scalar fields that secondary is newer, prefer secondary values
    for (const field of SCALAR_FIELDS) {
      if (secondary[field] != null) {
        result[field] = secondary[field];
      }
    }
    result.updatedAt = secondary.updatedAt;
  }

  // Merge array fields: union
  const ARRAY_FIELDS = ['segments', 'sources', 'tags', 'interactionHistory'];
  for (const field of ARRAY_FIELDS) {
    const arr1 = Array.isArray(primary[field]) ? primary[field] : [];
    const arr2 = Array.isArray(secondary[field]) ? secondary[field] : [];
    // For arrays of objects (like interactionHistory), just concat; for primitives, dedup
    if (arr1.length > 0 && typeof arr1[0] === 'object') {
      result[field] = [...arr1, ...arr2];
    } else {
      result[field] = [...new Set([...arr1, ...arr2])];
    }
  }

  // Consent: most restrictive wins
  const primaryConsent = primary.consent || {};
  const secondaryConsent = secondary.consent || {};
  const mergedConsent = { ...primaryConsent };
  for (const [key, val] of Object.entries(secondaryConsent)) {
    if (mergedConsent[key] === undefined) {
      mergedConsent[key] = val;
    } else {
      // false is more restrictive — it wins
      mergedConsent[key] = mergedConsent[key] === false || val === false ? false : val;
    }
  }
  result.consent = mergedConsent;

  // Track merged IDs for audit trail
  const existingMergedIds = Array.isArray(primary.mergedIds) ? primary.mergedIds : [];
  result.mergedIds = [...new Set([...existingMergedIds, secondary.customerId])].filter(Boolean);

  result.customerId = primary.customerId; // Always keep primary ID
  result.mergedAt = new Date().toISOString();

  logger.info('Profiles merged', {
    primaryId: primary.customerId,
    secondaryId: secondary.customerId,
  });

  return result;
}

module.exports = {
  matchByEmail,
  matchByPhone,
  matchById,
  mergeProfiles,
};
