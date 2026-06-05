'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createLogger, format, transports } = require('winston');
const {
  getConsent,
  recordErasureRequest,
  getPendingRequests,
  getSlaStatus,
  deleteCustomerConsent
} = require('../consent-store');
const {
  propagateOptOut,
  propagateErasure,
  propagateCCPA
} = require('../propagation-engine');
const { getAuditTrail, getComplianceReport } = require('../audit-log');
const { log: auditLog } = require('../audit-log');

const router = express.Router();

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()]
});

// ─── Validation helpers ────────────────────────────────────────────────────────

function validateCustomerId(customerId) {
  return typeof customerId === 'string' && customerId.trim().length > 0;
}

const VALID_CHANNELS = ['email', 'sms', 'push', 'data-sale', 'third-party-share', 'targeted-ads'];

// ─── POST /v1/consent/optout ──────────────────────────────────────────────────

router.post('/optout', async (req, res) => {
  const { customerId, channels, source = 'api', timestamp } = req.body;

  if (!validateCustomerId(customerId)) {
    return res.status(400).json({ error: 'customerId is required' });
  }

  if (!Array.isArray(channels) || channels.length === 0) {
    return res.status(400).json({ error: 'channels must be a non-empty array' });
  }

  const invalidChannels = channels.filter((c) => !VALID_CHANNELS.includes(c));
  if (invalidChannels.length > 0) {
    return res.status(400).json({
      error: 'Invalid channel(s)',
      invalidChannels,
      validChannels: VALID_CHANNELS
    });
  }

  try {
    const result = await propagateOptOut(customerId, channels, source);

    res.status(200).json({
      success: true,
      customerId,
      channels,
      source,
      appliedAt: new Date().toISOString(),
      propagation: {
        redis: result.results.redis,
        cdh: {
          success: result.results.cdh.success,
          elapsedMs: result.results.cdh.elapsedMs,
          slaTarget: '500ms',
          withinSla: result.results.cdh.elapsedMs < 500
        },
        kafka: result.results.kafka
      },
      totalElapsedMs: result.totalMs
    });
  } catch (err) {
    logger.error('Opt-out route error', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to process opt-out', details: err.message });
  }
});

// ─── POST /v1/consent/gdpr-erasure ────────────────────────────────────────────

router.post('/gdpr-erasure', async (req, res) => {
  const { customerId, requestId: providedRequestId, requestedAt, verificationToken } = req.body;

  if (!validateCustomerId(customerId)) {
    return res.status(400).json({ error: 'customerId is required' });
  }

  if (!verificationToken) {
    return res.status(400).json({ error: 'verificationToken is required' });
  }

  // In production, verify the token against a verification service
  // For now we accept any non-empty token
  if (verificationToken.length < 8) {
    return res.status(400).json({ error: 'verificationToken is too short' });
  }

  const requestId = providedRequestId || uuidv4();

  try {
    const erasureRequest = await recordErasureRequest({
      requestId,
      customerId,
      type: 'gdpr_erasure',
      requestedAt: requestedAt || new Date().toISOString(),
      verificationToken: '[REDACTED]',
      source: req.ip
    });

    await auditLog('GDPR_ERASURE_RECEIVED', customerId, { requestId, requestedAt });

    // Start erasure asynchronously (fire and forget — 72h SLA)
    propagateErasure(customerId, requestId).catch((err) => {
      logger.error('Background erasure failed', { requestId, customerId, error: err.message });
    });

    res.status(202).json({
      accepted: true,
      requestId,
      customerId,
      type: 'gdpr_erasure',
      status: 'pending',
      slaHours: 72,
      deadline: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      message: 'Erasure request accepted. Data will be deleted within 72 hours per GDPR Article 17.'
    });
  } catch (err) {
    logger.error('GDPR erasure route error', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to process GDPR erasure request', details: err.message });
  }
});

// ─── POST /v1/consent/ccpa-dns ────────────────────────────────────────────────

router.post('/ccpa-dns', async (req, res) => {
  const { customerId, requestId: providedRequestId } = req.body;

  if (!validateCustomerId(customerId)) {
    return res.status(400).json({ error: 'customerId is required' });
  }

  const requestId = providedRequestId || uuidv4();

  try {
    const ccpaRequest = await recordErasureRequest({
      requestId,
      customerId,
      type: 'ccpa_dns',
      requestedAt: new Date().toISOString(),
      source: req.ip
    });

    await auditLog('CCPA_DNS_RECEIVED', customerId, { requestId });

    // Propagate asynchronously (15-day SLA)
    propagateCCPA(customerId, requestId).catch((err) => {
      logger.error('Background CCPA propagation failed', { requestId, customerId, error: err.message });
    });

    res.status(202).json({
      accepted: true,
      requestId,
      customerId,
      type: 'ccpa_dns',
      status: 'pending',
      slaDays: 15,
      deadline: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
      message: 'Do Not Sell request accepted. Processing will be completed within 15 business days per CCPA.'
    });
  } catch (err) {
    logger.error('CCPA DNS route error', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to process CCPA Do Not Sell request', details: err.message });
  }
});

// ─── GET /v1/consent/requests ─────────────────────────────────────────────────

router.get('/requests', async (req, res) => {
  try {
    const requests = await getPendingRequests();
    const now = Date.now();

    const formatted = requests.map((r) => ({
      requestId: r.requestId,
      customerId: r.customerId,
      type: r.type,
      status: r.status,
      createdAt: r.createdAt,
      deadlineMs: r.deadline,
      deadlineISO: new Date(r.deadline).toISOString(),
      hoursRemaining: Math.max(0, (r.deadline - now) / (1000 * 60 * 60)).toFixed(2),
      slaBreached: r.deadline < now,
      slaWarning: r.deadline > now && (r.deadline - now) < 24 * 60 * 60 * 1000,
      systemsCompleted: r.systemsCompleted || [],
      systemsFailed: r.systemsFailed || []
    }));

    res.json({
      total: formatted.length,
      requests: formatted
    });
  } catch (err) {
    logger.error('List requests error', { error: err.message });
    res.status(500).json({ error: 'Failed to list requests', details: err.message });
  }
});

// ─── GET /v1/consent/requests/:requestId ──────────────────────────────────────

router.get('/requests/:requestId', async (req, res) => {
  const { requestId } = req.params;
  try {
    const status = await getSlaStatus(requestId);
    if (!status) {
      return res.status(404).json({ error: 'Request not found', requestId });
    }
    res.json(status);
  } catch (err) {
    logger.error('Get request status error', { requestId, error: err.message });
    res.status(500).json({ error: 'Failed to get request status', details: err.message });
  }
});

// ─── GET /v1/consent/:customerId ──────────────────────────────────────────────

router.get('/:customerId', async (req, res) => {
  const { customerId } = req.params;

  if (!validateCustomerId(customerId)) {
    return res.status(400).json({ error: 'Invalid customerId' });
  }

  try {
    const consent = await getConsent(customerId);
    if (!consent) {
      return res.status(404).json({
        customerId,
        found: false,
        message: 'No consent record found — customer has not exercised any consent rights'
      });
    }
    res.json({ customerId, found: true, consent });
  } catch (err) {
    logger.error('Get consent error', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to get consent state', details: err.message });
  }
});

// ─── DELETE /v1/consent/:customerId ───────────────────────────────────────────

router.delete('/:customerId', async (req, res) => {
  const { customerId } = req.params;
  const { requestId, reason = 'manual_deletion' } = req.query;

  if (!validateCustomerId(customerId)) {
    return res.status(400).json({ error: 'Invalid customerId' });
  }

  try {
    await auditLog('CONSENT_DATA_DELETE_INITIATED', customerId, { requestId, reason, source: req.ip });

    const deletedKeys = await deleteCustomerConsent(customerId);

    await auditLog('CONSENT_DATA_DELETED', customerId, {
      requestId,
      reason,
      deletedKeys,
      source: req.ip
    });

    res.json({
      success: true,
      customerId,
      deletedKeys,
      deletedAt: new Date().toISOString(),
      message: `All consent data for customer ${customerId} has been deleted`
    });
  } catch (err) {
    logger.error('Delete consent error', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to delete consent data', details: err.message });
  }
});

// ─── GET /v1/consent/:customerId/audit ────────────────────────────────────────

router.get('/:customerId/audit', async (req, res) => {
  const { customerId } = req.params;
  try {
    const trail = await getAuditTrail(customerId);
    res.json({ customerId, entries: trail, total: trail.length });
  } catch (err) {
    logger.error('Get audit trail error', { customerId, error: err.message });
    res.status(500).json({ error: 'Failed to get audit trail', details: err.message });
  }
});

// ─── GET /v1/consent/compliance/report ───────────────────────────────────────

router.get('/compliance/report', async (req, res) => {
  try {
    const report = await getComplianceReport();
    res.json(report);
  } catch (err) {
    logger.error('Compliance report error', { error: err.message });
    res.status(500).json({ error: 'Failed to generate compliance report', details: err.message });
  }
});

module.exports = router;
