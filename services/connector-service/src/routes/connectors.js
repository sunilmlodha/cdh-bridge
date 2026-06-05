'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const Registry = require('../connector-registry');
const Store = require('../connector-store');
const { createLogger, format, transports } = require('winston');

const router = Router();

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { component: 'connectors-router' },
  transports: [new transports.Console({ format: format.simple() })]
});

// ─── Validation helpers ───────────────────────────────────────────────────────

const REQUIRED_FIELDS = ['type', 'name'];
const VALID_TYPES = ['salesforce', 'mock-salesforce', 'snowflake', 's3', 'webhook', 'http', 'genesys', 'twilio'];

function validateConnectorConfig(config, isCreate = true) {
  const errors = [];

  if (isCreate) {
    for (const field of REQUIRED_FIELDS) {
      if (!config[field]) errors.push(`Missing required field: ${field}`);
    }
  }

  if (config.type && !VALID_TYPES.includes(config.type)) {
    errors.push(`Invalid connector type: ${config.type}. Valid types: ${VALID_TYPES.join(', ')}`);
  }

  if (config.fieldMappings && !Array.isArray(config.fieldMappings)) {
    errors.push('fieldMappings must be an array');
  }

  return errors;
}

// ─── GET /v1/connectors — list all connectors ─────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const statuses = Registry.listStatuses();

    // Merge with persisted configs for full view
    const configs = await Store.listConnectors();
    const configMap = new Map(configs.map(c => [c.id, c]));

    const result = statuses.map(status => {
      const config = configMap.get(status.id) || {};
      return {
        ...status,
        syncInterval: config.syncInterval,
        enabled: config.enabled !== false,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt
      };
    });

    res.json({
      connectors: result,
      total: result.length,
      healthy: result.filter(c => ['connected', 'idle'].includes(c.status)).length
    });
  } catch (err) {
    logger.error('GET /connectors failed', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /v1/connectors/stats — aggregate stats ───────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const stats = await Registry.getStats();
    const kafkaStats = require('../kafka-producer').getStats();

    res.json({
      ...stats,
      kafka: kafkaStats,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('GET /connectors/stats failed', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /v1/connectors — create a new connector ────────────────────────────

router.post('/', async (req, res) => {
  try {
    const config = req.body;
    const errors = validateConnectorConfig(config, true);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    config.id = config.id || uuidv4();
    config.createdAt = new Date().toISOString();
    config.updatedAt = config.createdAt;
    config.enabled = config.enabled !== false;

    const connector = await Registry.add(config);

    logger.info('Connector created', { id: config.id, type: config.type });
    res.status(201).json({
      message: 'Connector created',
      connector: connector.getStatus()
    });
  } catch (err) {
    logger.error('POST /connectors failed', { err: err.message });
    if (err.message.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /v1/connectors/:id — update a connector ─────────────────────────────

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const errors = validateConnectorConfig(updates, false);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    updates.updatedAt = new Date().toISOString();
    const connector = await Registry.update(id, updates);

    logger.info('Connector updated', { id });
    res.json({
      message: 'Connector updated',
      connector: connector.getStatus()
    });
  } catch (err) {
    logger.error(`PUT /connectors/${req.params.id} failed`, { err: err.message });
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /v1/connectors/:id — remove a connector ──────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const connector = Registry.get(id);

    if (!connector) {
      // Check if it exists in store
      const config = await Store.getConnector(id);
      if (!config) {
        return res.status(404).json({ error: `Connector ${id} not found` });
      }
    }

    await Registry.remove(id);

    logger.info('Connector deleted', { id });
    res.json({ message: 'Connector removed', id });
  } catch (err) {
    logger.error(`DELETE /connectors/${req.params.id} failed`, { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /v1/connectors/:id/sync — trigger manual sync ──────────────────────

router.post('/:id/sync', async (req, res) => {
  try {
    const { id } = req.params;
    const connector = Registry.get(id);

    if (!connector) {
      return res.status(404).json({ error: `Connector ${id} not found` });
    }

    if (connector.status === 'syncing') {
      return res.status(409).json({ error: 'Sync already in progress' });
    }

    // Kick off sync asynchronously — don't block the response
    const syncPromise = Registry.triggerSync(id);

    // Return immediately, sync runs in background
    res.json({
      message: 'Sync triggered',
      connectorId: id,
      status: 'syncing',
      startedAt: new Date().toISOString()
    });

    // Wait for sync to complete (for logging)
    syncPromise.catch(err => {
      logger.error('Background sync failed', { connectorId: id, err: err.message });
    });
  } catch (err) {
    logger.error(`POST /connectors/${req.params.id}/sync failed`, { err: err.message });
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /v1/connectors/:id/test — test connection ──────────────────────────

router.post('/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    const connector = Registry.get(id);

    if (!connector) {
      return res.status(404).json({ error: `Connector ${id} not found` });
    }

    const result = await Registry.testConnector(id);

    logger.info('Connector test complete', { id, success: result.success });
    res.json({
      connectorId: id,
      ...result,
      testedAt: new Date().toISOString()
    });
  } catch (err) {
    logger.error(`POST /connectors/${req.params.id}/test failed`, { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /v1/connectors/:id/logs — sync history ──────────────────────────────

router.get('/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const connector = Registry.get(id);
    const config = await Store.getConnector(id);

    if (!connector && !config) {
      return res.status(404).json({ error: `Connector ${id} not found` });
    }

    const [logs, syncState] = await Promise.all([
      Store.getLogs(id, limit),
      Store.getSyncState(id)
    ]);

    res.json({
      connectorId: id,
      syncState,
      logs,
      total: logs.length
    });
  } catch (err) {
    logger.error(`GET /connectors/${req.params.id}/logs failed`, { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
