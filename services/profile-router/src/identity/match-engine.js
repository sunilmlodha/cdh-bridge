'use strict';

/**
 * Identity resolution match engine — orchestrates the full matching pipeline.
 *
 * findBestMatch(incomingProfile)
 *   1. Try all deterministic indexes: email, phone, crmId, deviceId
 *   2. For each candidate found, calculate confidence score
 *   3. Sort candidates by confidence descending
 *   4. Best candidate:
 *      >= 0.95 => { match, action: 'AUTO_MERGE', confidence }
 *      >= 0.75 => enqueue review, { match, action: 'REVIEW_QUEUED', reviewId, confidence }
 *      <  0.75 => { match: null, action: 'CREATE_NEW' }
 *
 * resolveIdentity(anyIdentifier)
 *   Walks the identity graph to find the golden customerId.
 *
 * deduplicateAndMerge(primaryId, secondaryId)
 *   Merges two profiles applying survivorship rules and writes the golden record.
 */

const store   = require('../profile-store');
const logger  = require('../logger');
const { calculateConfidence, normaliseEmail, normalisePhone, MERGE_THRESHOLD, REVIEW_THRESHOLD } = require('./confidence-scorer');
const { applySurvivorshipRules } = require('./survivorship-rules');
const reviewQueue     = require('./review-queue');
const identityGraph   = require('./identity-graph');
const aliasManager    = require('./alias-manager');

// ─── Redis key helpers ────────────────────────────────────────────────────────

/**
 * Key for a crmId index entry.
 */
function crmIdIndexKey(crmId) {
  return `idx:crmid:${String(crmId).toLowerCase()}`;
}

/**
 * Key for a deviceId index entry.
 */
function deviceIdIndexKey(deviceId) {
  return `idx:device:${String(deviceId).toLowerCase()}`;
}

/**
 * Key for identity alias graph: maps any identifier to the golden customerId.
 */
function aliasKey(identifier) {
  return `alias:${String(identifier).toLowerCase()}`;
}

/**
 * Key for the identity graph SET associated with a golden customerId.
 * Stores all known aliases/identifiers for the customer.
 */
function identityGraphKey(customerId) {
  return `igraph:${customerId}`;
}

const GRAPH_TTL = 30 * 24 * 60 * 60; // 30 days

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Look up a profile via a normalised email address using the store's email index.
 */
async function _lookupByEmail(email) {
  if (!email) return null;
  const client = store.getClient();
  const norm = normaliseEmail(email);
  const customerId = await client.get(store.emailIndexKey(norm));
  if (!customerId) return null;
  return store.get(customerId);
}

/**
 * Look up a profile via a normalised phone number using the store's phone index.
 */
async function _lookupByPhone(phone) {
  if (!phone) return null;
  const client = store.getClient();
  const norm = normalisePhone(phone);
  const customerId = await client.get(store.phoneIndexKey(norm));
  if (!customerId) return null;
  return store.get(customerId);
}

/**
 * Look up a profile via crmId index.
 */
async function _lookupByCrmId(crmId) {
  if (!crmId) return null;
  const client = store.getClient();
  const customerId = await client.get(crmIdIndexKey(crmId));
  if (!customerId) return null;
  return store.get(customerId);
}

/**
 * Look up a profile via deviceId index.
 */
async function _lookupByDeviceId(deviceId) {
  if (!deviceId) return null;
  const client = store.getClient();
  const customerId = await client.get(deviceIdIndexKey(deviceId));
  if (!customerId) return null;
  return store.get(customerId);
}

/**
 * Maintain crmId and deviceId indexes for a profile.
 */
async function _updateSecondaryIndexes(customerId, profile) {
  const client = store.getClient();
  const pipeline = client.pipeline();

  if (profile.crmId) {
    pipeline.set(crmIdIndexKey(profile.crmId), customerId, 'EX', GRAPH_TTL);
  }

  const devices = Array.isArray(profile.devices)
    ? profile.devices
    : (profile.deviceId ? [profile.deviceId] : []);

  for (const dev of devices) {
    if (dev) pipeline.set(deviceIdIndexKey(dev), customerId, 'EX', GRAPH_TTL);
  }

  await pipeline.exec();
}

/**
 * Add an identifier to the identity graph for a customer.
 */
async function _addToIdentityGraph(customerId, identifiers) {
  const client = store.getClient();
  const pipeline = client.pipeline();

  for (const id of identifiers) {
    if (!id) continue;
    const norm = String(id).toLowerCase();
    pipeline.set(aliasKey(norm), customerId, 'EX', GRAPH_TTL);
    pipeline.sadd(identityGraphKey(customerId), norm);
  }
  pipeline.expire(identityGraphKey(customerId), GRAPH_TTL);

  await pipeline.exec();
}

/**
 * Determine a descriptive match rule string for logging/review.
 */
function _describeMatchRule(incoming, candidate) {
  const signals = [];
  if (incoming.email && candidate.email &&
      normaliseEmail(incoming.email) === normaliseEmail(candidate.email)) signals.push('EMAIL');
  if (incoming.phone && candidate.phone &&
      normalisePhone(incoming.phone) === normalisePhone(candidate.phone)) signals.push('PHONE');
  if (incoming.crmId && candidate.crmId &&
      String(incoming.crmId) === String(candidate.crmId)) signals.push('CRM_ID');
  if (signals.length === 0) signals.push('MULTI_SIGNAL');
  return signals.join('+');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Find the best matching existing profile for an incoming profile fragment.
 *
 * @param {object} incomingProfile
 * @returns {Promise<{ match: object|null, action: string, confidence: number, reviewId?: string }>}
 */
async function findBestMatch(incomingProfile) {
  if (!incomingProfile) return { match: null, action: 'CREATE_NEW', confidence: 0 };

  // 1. Collect candidate profiles from all deterministic indexes
  const candidateMap = new Map(); // customerId => profile

  const lookups = await Promise.allSettled([
    _lookupByEmail(incomingProfile.email),
    _lookupByPhone(incomingProfile.phone),
    _lookupByCrmId(incomingProfile.crmId),
    ...(Array.isArray(incomingProfile.devices)
      ? incomingProfile.devices.map((d) => _lookupByDeviceId(d))
      : [_lookupByDeviceId(incomingProfile.deviceId)]),
  ]);

  for (const result of lookups) {
    if (result.status === 'fulfilled' && result.value) {
      const candidate = result.value;
      if (!candidateMap.has(candidate.customerId)) {
        candidateMap.set(candidate.customerId, candidate);
      }
    }
  }

  // 1b. Probabilistic fallback: name + postalCode bucket lookup
  if (candidateMap.size === 0 && incomingProfile.lastName && incomingProfile.postalCode) {
    try {
      const namePcCandidates = await store.lookupByNamePc(
        incomingProfile.lastName, incomingProfile.postalCode
      );
      for (const candidate of namePcCandidates) {
        if (candidate && candidate.customerId !== incomingProfile.customerId) {
          candidateMap.set(candidate.customerId, candidate);
        }
      }
    } catch (e) {
      // Non-fatal — continue without probabilistic candidates
    }
  }

  if (candidateMap.size === 0) {
    return { match: null, action: 'CREATE_NEW', confidence: 0 };
  }

  // 2. Score each candidate
  const scored = [];
  for (const candidate of candidateMap.values()) {
    const confidence = calculateConfidence(incomingProfile, candidate);
    scored.push({ match: candidate, confidence });
  }

  // 3. Sort by confidence descending
  scored.sort((a, b) => b.confidence - a.confidence);
  const best = scored[0];

  // 4. Route based on threshold
  if (best.confidence >= MERGE_THRESHOLD) {
    logger.info('Auto-merge candidate found', {
      incomingId: incomingProfile.customerId,
      matchId: best.match.customerId,
      confidence: best.confidence,
    });

    // Link all known identifiers of the incoming profile to the matched customer
    const goldenCustomerId = best.match.customerId;
    const linkPromises = [];
    if (incomingProfile.email) {
      linkPromises.push(identityGraph.linkIdentifierToCustomer(
        normaliseEmail(incomingProfile.email), 'email', goldenCustomerId, best.confidence, incomingProfile.source || 'match-engine'
      ));
    }
    if (incomingProfile.phone) {
      linkPromises.push(identityGraph.linkIdentifierToCustomer(
        normalisePhone(incomingProfile.phone), 'phone', goldenCustomerId, best.confidence, incomingProfile.source || 'match-engine'
      ));
    }
    if (incomingProfile.crmId) {
      linkPromises.push(identityGraph.linkIdentifierToCustomer(
        String(incomingProfile.crmId), 'crmId', goldenCustomerId, best.confidence, incomingProfile.source || 'match-engine'
      ));
    }
    const devices = Array.isArray(incomingProfile.devices)
      ? incomingProfile.devices
      : (incomingProfile.deviceId ? [incomingProfile.deviceId] : []);
    for (const dev of devices) {
      if (dev) {
        linkPromises.push(identityGraph.linkIdentifierToCustomer(
          String(dev).toLowerCase(), 'device', goldenCustomerId, best.confidence, incomingProfile.source || 'match-engine'
        ));
      }
    }
    if (linkPromises.length > 0) {
      await Promise.allSettled(linkPromises);
    }

    return { match: best.match, action: 'AUTO_MERGE', confidence: best.confidence };
  }

  if (best.confidence >= REVIEW_THRESHOLD) {
    const matchRule = _describeMatchRule(incomingProfile, best.match);
    const reviewId  = await reviewQueue.enqueue(incomingProfile, best.match, best.confidence, matchRule);
    logger.info('Review queued for candidate', {
      incomingId: incomingProfile.customerId,
      matchId: best.match.customerId,
      confidence: best.confidence,
      reviewId,
    });
    return { match: best.match, action: 'REVIEW_QUEUED', confidence: best.confidence, reviewId };
  }

  return { match: null, action: 'CREATE_NEW', confidence: best.confidence };
}

/**
 * Walk the identity alias graph to find the golden customerId for any identifier.
 * Identifiers can be: email, phone, deviceId, cookieId, or customerId.
 *
 * @param {string} anyIdentifier
 * @returns {Promise<string|null>} golden customerId or null
 */
async function resolveIdentity(anyIdentifier) {
  if (!anyIdentifier) return null;
  const client = store.getClient();
  const norm   = String(anyIdentifier).toLowerCase();

  // 1. Check alias chain first (alias-manager)
  const aliasResolved = await aliasManager.resolveChain(anyIdentifier, 5);
  if (aliasResolved && aliasResolved !== norm) {
    // Verify the resolved id is a real profile
    const aliasProfile = await store.get(aliasResolved);
    if (aliasProfile) return aliasProfile.customerId;
    // It may already be the customerId
    return aliasResolved;
  }

  // 2. Try identity graph BFS
  const graphResolved = await identityGraph.resolveToGolden(anyIdentifier);
  if (graphResolved) return graphResolved;

  // 3. Try the legacy alias graph (simple alias key)
  let goldenId = await client.get(aliasKey(norm));
  if (goldenId) return goldenId;

  // 4. Try direct profile lookup (in case it's already a customerId)
  const profile = await store.get(anyIdentifier);
  if (profile) return profile.customerId;

  // 5. Try email index
  const emailNorm = normaliseEmail(anyIdentifier);
  if (emailNorm) {
    goldenId = await client.get(store.emailIndexKey(emailNorm));
    if (goldenId) return goldenId;
  }

  // 6. Try phone index
  const phoneNorm = normalisePhone(anyIdentifier);
  if (phoneNorm && phoneNorm.length >= 7) {
    goldenId = await client.get(store.phoneIndexKey(phoneNorm));
    if (goldenId) return goldenId;
  }

  return null;
}

/**
 * Merge two profiles into a single golden record.
 * Applies survivorship rules, writes golden record under primaryId,
 * creates aliases for secondaryId, and removes the secondary profile.
 *
 * @param {string} primaryId
 * @param {string} secondaryId
 * @returns {Promise<object>} the merged golden record
 */
async function deduplicateAndMerge(primaryId, secondaryId) {
  if (!primaryId || !secondaryId) throw new Error('Both primaryId and secondaryId are required');
  if (primaryId === secondaryId) throw new Error('Cannot merge a profile with itself');

  const [primary, secondary] = await Promise.all([
    store.get(primaryId),
    store.get(secondaryId),
  ]);

  if (!primary)   throw new Error(`Primary profile not found: ${primaryId}`);
  if (!secondary) throw new Error(`Secondary profile not found: ${secondaryId}`);

  // Apply survivorship rules
  const golden = applySurvivorshipRules([primary, secondary]);
  golden.customerId = primaryId;
  golden.goldenId   = primaryId;
  golden.mergedAt   = new Date().toISOString();
  golden.mergedIds  = [
    ...(Array.isArray(primary.mergedIds)   ? primary.mergedIds   : []),
    ...(Array.isArray(secondary.mergedIds) ? secondary.mergedIds : []),
    secondaryId,
  ].filter((v, i, arr) => v && arr.indexOf(v) === i); // unique, non-null

  // Write the golden record
  await store.set(primaryId, golden);

  // Create alias: secondaryId -> primaryId
  const client = store.getClient();
  await client.set(aliasKey(secondaryId), primaryId, 'EX', GRAPH_TTL);

  // Merge identity graphs
  const [graphA, graphB] = await Promise.all([
    client.smembers(identityGraphKey(primaryId)),
    client.smembers(identityGraphKey(secondaryId)),
  ]);
  const allIdentifiers = [...new Set([...graphA, ...graphB, secondaryId])];

  // Re-point all secondary aliases to primaryId
  const pipeline = client.pipeline();
  for (const id of allIdentifiers) {
    if (id) pipeline.set(aliasKey(id), primaryId, 'EX', GRAPH_TTL);
  }
  if (allIdentifiers.length > 0) {
    pipeline.sadd(identityGraphKey(primaryId), ...allIdentifiers);
  }
  pipeline.del(identityGraphKey(secondaryId));
  pipeline.expire(identityGraphKey(primaryId), GRAPH_TTL);
  await pipeline.exec();

  // Update secondary indexes for merged record
  await _updateSecondaryIndexes(primaryId, golden);

  // Remove the secondary profile record
  await store.deleteProfile(secondaryId);

  // Create alias in alias-manager so any reference to secondaryId resolves to primaryId
  await aliasManager.createAlias(secondaryId, primaryId, 'deduplicateAndMerge');

  // Merge identity graph records
  try {
    await identityGraph.mergeGoldenRecords(primaryId, secondaryId);
  } catch (graphErr) {
    // Log but don't fail the merge if graph nodes don't exist yet
    logger.warn('Identity graph merge skipped', { primaryId, secondaryId, reason: graphErr.message });
  }

  logger.info('Profiles deduplicated and merged', { primaryId, secondaryId, mergedIdsCount: golden.mergedIds.length });

  return golden;
}

/**
 * Retrieve the full identity graph for a customer:
 * all aliases, devices, merged IDs, and confidence metadata.
 *
 * @param {string} customerId
 * @returns {Promise<object|null>}
 */
async function getIdentityGraph(customerId) {
  if (!customerId) return null;

  const client  = store.getClient();
  const profile = await store.get(customerId);
  if (!profile) return null;

  const graphMembers = await client.smembers(identityGraphKey(customerId));

  return {
    customerId,
    goldenId:  profile.goldenId || customerId,
    aliases:   graphMembers,
    mergedIds: profile.mergedIds || [],
    devices:   profile.devices   || [],
    email:     profile.email,
    phone:     profile.phone,
    crmId:     profile.crmId,
    sources:   profile.sources   || [],
    updatedAt: profile.updatedAt,
    mergedAt:  profile.mergedAt  || null,
  };
}

module.exports = {
  findBestMatch,
  resolveIdentity,
  deduplicateAndMerge,
  getIdentityGraph,
  // Re-export thresholds for convenience
  MERGE_THRESHOLD,
  REVIEW_THRESHOLD,
};
