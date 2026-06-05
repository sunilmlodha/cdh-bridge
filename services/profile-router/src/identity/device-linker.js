'use strict';

/**
 * Links device/cookie identifiers to known customers via the identity graph.
 * Also supports probabilistic matching via device fingerprinting.
 */

const crypto = require('crypto');
const store = require('../profile-store');
const logger = require('../logger');
const identityGraph = require('./identity-graph');

const DEVICE_TYPES       = ['ios', 'android', 'web-cookie', 'idfa', 'gaid'];
const FINGERPRINT_TTL    = 90 * 24 * 60 * 60; // 90 days
const FINGERPRINT_CONF   = 0.75; // probabilistic — device fingerprints can collide

// ─── Redis key helpers ────────────────────────────────────────────────────────

function deviceRecordKey(deviceId)     { return `device:record:${String(deviceId).toLowerCase()}`; }
function deviceFingerprintKey(fpHash)  { return `device:fp:${fpHash}`; }
function customerDevicesKey(customerId){ return `device:customer:${customerId}`; }

function getClient() { return store.getClient(); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise metadata fields to ensure consistent fingerprinting.
 */
function _normaliseMetadata(metadata) {
  const m = metadata || {};
  return {
    userAgent:  (m.userAgent  || '').toLowerCase().trim(),
    screenRes:  (m.screenRes  || '').toLowerCase().trim(),
    timezone:   (m.timezone   || '').toLowerCase().trim(),
    language:   (m.language   || '').toLowerCase().trim(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a SHA256 fingerprint hash from device metadata.
 */
function generateFingerprint(metadata) {
  const n = _normaliseMetadata(metadata);
  const raw = [n.userAgent, n.screenRes, n.timezone, n.language].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Register a device to a customer.
 * Adds device node to identity graph, stores device record and fingerprint.
 */
async function registerDevice(customerId, deviceId, deviceType, metadata) {
  if (!customerId) throw new Error('customerId is required');
  if (!deviceId)   throw new Error('deviceId is required');
  if (!DEVICE_TYPES.includes(deviceType)) throw new Error(`Unknown deviceType: ${deviceType}`);

  const client = getClient();
  const normDeviceId = String(deviceId).toLowerCase();
  const fpHash = metadata ? generateFingerprint(metadata) : null;

  const record = {
    deviceId: normDeviceId,
    customerId,
    deviceType,
    metadata: _normaliseMetadata(metadata || {}),
    fingerprintHash: fpHash,
    registeredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };

  const pipeline = client.pipeline();

  // Store device record
  pipeline.set(deviceRecordKey(normDeviceId), JSON.stringify(record), 'EX', FINGERPRINT_TTL);

  // Add to customer's device set
  pipeline.sadd(customerDevicesKey(customerId), normDeviceId);
  pipeline.expire(customerDevicesKey(customerId), FINGERPRINT_TTL);

  // Store fingerprint → customerId mapping (for probabilistic lookup)
  if (fpHash) {
    pipeline.set(deviceFingerprintKey(fpHash), JSON.stringify({ customerId, deviceId: normDeviceId }), 'EX', FINGERPRINT_TTL);
  }

  await pipeline.exec();

  // Link in identity graph
  const nodeType = (deviceType === 'web-cookie') ? 'cookie' : 'device';
  await identityGraph.linkIdentifierToCustomer(normDeviceId, nodeType, customerId, 1.0, `device-linker:${deviceType}`);

  logger.info('Device registered', { customerId, deviceId: normDeviceId, deviceType });
}

/**
 * Resolve a deviceId to the owning customerId.
 * Uses identity graph BFS under the hood.
 */
async function resolveDevice(deviceId) {
  if (!deviceId) return null;
  const normDeviceId = String(deviceId).toLowerCase();
  return identityGraph.resolveToGolden(normDeviceId);
}

/**
 * Find a customer by matching device fingerprint.
 * Returns { customerId, confidence } or null if no match.
 */
async function matchByFingerprint(metadata) {
  if (!metadata) return null;
  const fpHash = generateFingerprint(metadata);
  const client = getClient();
  const raw = await client.get(deviceFingerprintKey(fpHash));
  if (!raw) return null;

  try {
    const { customerId } = JSON.parse(raw);
    return { customerId, confidence: FINGERPRINT_CONF };
  } catch {
    return null;
  }
}

/**
 * Return all DeviceRecords linked to a customer.
 */
async function getDevicesForCustomer(customerId) {
  if (!customerId) return [];
  const client = getClient();
  const deviceIds = await client.smembers(customerDevicesKey(customerId));
  if (!deviceIds || deviceIds.length === 0) return [];

  const records = await Promise.all(
    deviceIds.map(async (did) => {
      const raw = await client.get(deviceRecordKey(did));
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    })
  );

  return records.filter(Boolean);
}

/**
 * Revoke a device link (e.g. logged out, sold phone).
 * Removes the device record and identity graph node.
 */
async function revokeDevice(deviceId, customerId) {
  if (!deviceId) throw new Error('deviceId is required');
  const client = getClient();
  const normDeviceId = String(deviceId).toLowerCase();

  const raw = await client.get(deviceRecordKey(normDeviceId));
  let fpHash = null;
  if (raw) {
    try {
      const record = JSON.parse(raw);
      fpHash = record.fingerprintHash;
    } catch { /* ignore */ }
  }

  const pipeline = client.pipeline();
  pipeline.del(deviceRecordKey(normDeviceId));
  if (customerId) {
    pipeline.srem(customerDevicesKey(customerId), normDeviceId);
  }
  if (fpHash) {
    pipeline.del(deviceFingerprintKey(fpHash));
  }
  await pipeline.exec();

  logger.info('Device revoked', { deviceId: normDeviceId, customerId });
}

module.exports = {
  registerDevice,
  resolveDevice,
  generateFingerprint,
  matchByFingerprint,
  getDevicesForCustomer,
  revokeDevice,
};
