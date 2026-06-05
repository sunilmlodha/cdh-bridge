'use strict';

const { createLogger, format, transports } = require('winston');
const { getRedis } = require('./consent-store');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()]
});

const AUDIT_KEY = (cid) => `consent:audit:${cid}`;
const GLOBAL_AUDIT_KEY = 'consent:audit:global';
const MAX_ENTRIES_PER_CUSTOMER = 10000;
const MAX_GLOBAL_ENTRIES = 100000;

/**
 * Append an immutable audit entry for a customer action.
 * Written to both per-customer list and global list.
 */
async function log(action, customerId, details = {}) {
  const r = getRedis();
  const entry = JSON.stringify({
    action,
    customerId,
    details,
    timestamp: new Date().toISOString(),
    ts: Date.now()
  });

  const pipeline = r.pipeline();
  // Append-only lists (RPUSH = append to tail)
  pipeline.rpush(AUDIT_KEY(customerId), entry);
  pipeline.ltrim(AUDIT_KEY(customerId), -MAX_ENTRIES_PER_CUSTOMER, -1);
  pipeline.rpush(GLOBAL_AUDIT_KEY, entry);
  pipeline.ltrim(GLOBAL_AUDIT_KEY, -MAX_GLOBAL_ENTRIES, -1);

  await pipeline.exec();

  logger.info('Audit entry logged', { action, customerId, details });
}

/**
 * Return full audit history for a customer, newest last.
 */
async function getAuditTrail(customerId) {
  const r = getRedis();
  const raw = await r.lrange(AUDIT_KEY(customerId), 0, -1);
  return raw.map((entry) => {
    try { return JSON.parse(entry); } catch (_) { return entry; }
  });
}

/**
 * Generate a compliance summary report.
 * Returns counts of each action type across the global audit log.
 */
async function getComplianceReport() {
  const r = getRedis();
  const raw = await r.lrange(GLOBAL_AUDIT_KEY, 0, -1);

  const entries = raw.map((e) => {
    try { return JSON.parse(e); } catch (_) { return null; }
  }).filter(Boolean);

  const summary = {
    generatedAt: new Date().toISOString(),
    totalEvents: entries.length,
    byAction: {},
    byCustomer: {},
    last24h: 0,
    last7d: 0
  };

  const now = Date.now();
  const ms24h = 24 * 60 * 60 * 1000;
  const ms7d = 7 * ms24h;

  for (const entry of entries) {
    // Count by action
    summary.byAction[entry.action] = (summary.byAction[entry.action] || 0) + 1;

    // Count unique customers
    if (entry.customerId) {
      summary.byCustomer[entry.customerId] = (summary.byCustomer[entry.customerId] || 0) + 1;
    }

    // Time buckets
    if (entry.ts && now - entry.ts < ms24h) summary.last24h++;
    if (entry.ts && now - entry.ts < ms7d) summary.last7d++;
  }

  summary.uniqueCustomers = Object.keys(summary.byCustomer).length;

  logger.info('Compliance report generated', { totalEvents: summary.totalEvents });
  return summary;
}

/**
 * Get recent global audit entries (paginated).
 */
async function getRecentEntries(limit = 100, offset = 0) {
  const r = getRedis();
  // Negative indexing: -1 = last, so we read from the end
  const start = -(offset + limit);
  const end = offset === 0 ? -1 : -(offset + 1);
  const raw = await r.lrange(GLOBAL_AUDIT_KEY, start, end);
  return raw.map((e) => {
    try { return JSON.parse(e); } catch (_) { return e; }
  }).reverse(); // newest first
}

module.exports = {
  log,
  getAuditTrail,
  getComplianceReport,
  getRecentEntries
};
