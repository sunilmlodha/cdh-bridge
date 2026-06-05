'use strict';

const { Router } = require('express');
const feedbackProcessor = require('../feedback-processor');
const decisionStore = require('../decision-store');
const liftCalculator = require('../lift-calculator');
const logger = require('../logger');

const router = Router();

// ─── POST /v1/feedback ────────────────────────────────────────────────────────
// Receive a single NBA decision outcome from Pega CDH.
// Body: { customerId, decisionId?, action, treatment?, outcome, channel, timestamp?, propensityScore? }
router.post('/', async (req, res) => {
  try {
    const decision = await feedbackProcessor.processDecision(req.body);
    return res.status(202).json({ status: 'accepted', decisionId: decision.decisionId });
  } catch (err) {
    logger.warn('POST /v1/feedback error', { err: err.message });
    return res.status(400).json({ error: err.message });
  }
});

// ─── POST /v1/feedback/batch ──────────────────────────────────────────────────
// Submit multiple decision outcomes at once.
// Body: { decisions: [ ...decision objects ] }
router.post('/batch', async (req, res) => {
  const { decisions } = req.body;
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return res.status(400).json({ error: 'Body must contain a non-empty "decisions" array' });
  }

  const results = [];
  const errors = [];

  for (let i = 0; i < decisions.length; i++) {
    try {
      const decision = await feedbackProcessor.processDecision(decisions[i]);
      results.push({ index: i, decisionId: decision.decisionId, status: 'accepted' });
    } catch (err) {
      errors.push({ index: i, error: err.message });
    }
  }

  const statusCode = errors.length === decisions.length ? 400 : errors.length > 0 ? 207 : 202;
  return res.status(statusCode).json({ accepted: results.length, failed: errors.length, results, errors });
});

// ─── GET /v1/feedback/stats ───────────────────────────────────────────────────
// Overall NBA performance metrics.
router.get('/stats', async (_req, res) => {
  try {
    const stats = await decisionStore.getStats();
    const lift = await liftCalculator.liftPercentage(30);
    const currentRate = await liftCalculator.currentAcceptanceRate(30);
    return res.json({
      ...stats,
      lift: {
        baselineAcceptanceRate: liftCalculator.baselineAcceptanceRate,
        currentAcceptanceRate: currentRate,
        liftPercentage: lift,
        windowDays: 30,
      },
    });
  } catch (err) {
    logger.error('GET /v1/feedback/stats error', { err: err.message });
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── GET /v1/feedback/lift ────────────────────────────────────────────────────
// Detailed NBA lift breakdown: overall, by channel, by action, time series.
router.get('/lift', async (req, res) => {
  const windowDays = parseInt(req.query.days || '30', 10);
  try {
    const [overall, byChannel, byAction, timeSeries] = await Promise.all([
      liftCalculator.liftPercentage(windowDays),
      liftCalculator.byChannel(windowDays),
      liftCalculator.byAction(windowDays),
      liftCalculator.timeSeriesLift(windowDays),
    ]);

    return res.json({
      windowDays,
      baselineAcceptanceRate: liftCalculator.baselineAcceptanceRate,
      overallLiftPercentage: overall,
      byChannel,
      byAction,
      timeSeries,
    });
  } catch (err) {
    logger.error('GET /v1/feedback/lift error', { err: err.message });
    return res.status(500).json({ error: 'Failed to calculate lift' });
  }
});

// ─── GET /v1/feedback/:customerId ─────────────────────────────────────────────
// Decision history + lift for a specific customer.
router.get('/:customerId', async (req, res) => {
  const { customerId } = req.params;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);

  try {
    const [history, lift] = await Promise.all([
      decisionStore.getHistory(customerId, limit),
      feedbackProcessor.calculateLift(customerId),
    ]);

    return res.json({ customerId, count: history.length, lift, decisions: history });
  } catch (err) {
    logger.error('GET /v1/feedback/:customerId error', { customerId, err: err.message });
    return res.status(500).json({ error: 'Failed to fetch customer history' });
  }
});

module.exports = router;
