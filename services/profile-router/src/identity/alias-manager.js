'use strict';

/**
 * Alias Manager — forward aliases so any old/secondary ID resolves to the golden record.
 *
 * Redis keys:
 *   alias:{fromId}            STRING  — goldenId
 *   alias:list:{goldenId}     SET     — all fromIds pointing to this golden
 *   alias:audit:{goldenId}    LIST    — JSON audit entries
 */

const store = require('../profile-store');
const logger = require('../logger');

const ALIAS_TTL    = 90 * 24 * 60 * 60; // 90 days
const MAX_HOPS     = 5;
const MAX_AUDIT    = 500; // max audit entries to keep per golden record

// ─── Redis key helpers ────────────────────────────────────────────────────────

function aliasKey(fromId)       { return `alias:${String(fromId).toLowerCase()}`; }
function aliasListKey(goldenId) { return `alias:list:${String(goldenId).toLowerCase()}`; }
function auditKey(goldenId)     { return `alias:audit:${String(goldenId).toLowerCase()}`; }

function getClient() { return store.getClient(); }

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a forward alias fromId → toGoldenId.
 * Also records to audit log.
 */
async function createAlias(fromId, toGoldenId, reason) {
  if (!fromId)     throw new Error('fromId is required');
  if (!toGoldenId) throw new Error('toGoldenId is required');

  const client = getClient();
  const normFrom   = String(fromId).toLowerCase();
  const normGolden = String(toGoldenId).toLowerCase();

  if (normFrom === normGolden) {
    throw new Error('fromId and toGoldenId must be different');
  }

  const auditEntry = {
    fromId:    normFrom,
    goldenId:  normGolden,
    reason:    reason || 'unspecified',
    createdAt: new Date().toISOString(),
  };

  const pipeline = client.pipeline();
  pipeline.set(aliasKey(normFrom), toGoldenId, 'EX', ALIAS_TTL);
  pipeline.sadd(aliasListKey(normGolden), normFrom);
  pipeline.expire(aliasListKey(normGolden), ALIAS_TTL);
  pipeline.lpush(auditKey(normGolden), JSON.stringify(auditEntry));
  pipeline.ltrim(auditKey(normGolden), 0, MAX_AUDIT - 1);
  pipeline.expire(auditKey(normGolden), ALIAS_TTL);
  await pipeline.exec();

  logger.debug('Alias created', { fromId: normFrom, toGoldenId, reason });
}

/**
 * Resolve a single hop: if alias exists → return goldenId, else return anyId as-is.
 */
async function resolve(anyId) {
  if (!anyId) return anyId;
  const client = getClient();
  const golden = await client.get(aliasKey(String(anyId).toLowerCase()));
  return golden || anyId;
}

/**
 * Follow chain of aliases up to maxHops deep, returning the final destination.
 */
async function resolveChain(anyId, maxHops) {
  if (!anyId) return anyId;
  const hops = (maxHops != null && Number.isFinite(maxHops)) ? maxHops : MAX_HOPS;
  const client = getClient();

  let current = String(anyId).toLowerCase();
  const visited = new Set();

  for (let i = 0; i < hops; i++) {
    if (visited.has(current)) break; // cycle guard
    visited.add(current);

    const next = await client.get(aliasKey(current));
    if (!next) break;

    current = String(next).toLowerCase();
  }

  return current;
}

/**
 * Return all IDs (fromIds) that point to this golden record.
 */
async function listAliasesFor(goldenId) {
  if (!goldenId) return [];
  const client = getClient();
  const members = await client.smembers(aliasListKey(String(goldenId).toLowerCase()));
  return members || [];
}

/**
 * Delete a forward alias — used during GDPR erasure.
 */
async function deleteAlias(fromId) {
  if (!fromId) throw new Error('fromId is required');
  const client = getClient();
  const normFrom = String(fromId).toLowerCase();

  // Find the golden record it pointed to so we can clean up the list
  const goldenId = await client.get(aliasKey(normFrom));

  const pipeline = client.pipeline();
  pipeline.del(aliasKey(normFrom));
  if (goldenId) {
    pipeline.srem(aliasListKey(String(goldenId).toLowerCase()), normFrom);
  }
  await pipeline.exec();

  logger.debug('Alias deleted', { fromId: normFrom, goldenId });
}

/**
 * Return every alias creation event for a golden record.
 */
async function getAuditTrail(goldenId) {
  if (!goldenId) return [];
  const client = getClient();
  const raw = await client.lrange(auditKey(String(goldenId).toLowerCase()), 0, -1);
  if (!raw || raw.length === 0) return [];

  return raw
    .map((entry) => { try { return JSON.parse(entry); } catch { return null; } })
    .filter(Boolean);
}

module.exports = {
  createAlias,
  resolve,
  resolveChain,
  listAliasesFor,
  deleteAlias,
  getAuditTrail,
};
