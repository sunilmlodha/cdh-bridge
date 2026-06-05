'use strict';

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { createLogger, format, transports } = require('winston');
const Store = require('./connector-store');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { component: 'ConnectorRegistry' },
  transports: [new transports.Console({ format: format.simple() })]
});

// Connector type → constructor mapping
const CONNECTOR_TYPES = {
  salesforce: () => require('./connectors/salesforce'),
  'mock-salesforce': () => require('./connectors/mock-salesforce'),
  snowflake: () => require('./connectors/snowflake'),
  s3: () => require('./connectors/s3'),
  webhook: () => require('./connectors/http-webhook'),
  http: () => require('./connectors/http-webhook'),
  genesys: () => require('./connectors/http-webhook'),
  twilio: () => require('./connectors/http-webhook')
};

// Map: connectorId → connector instance
const _instances = new Map();

// Map: connectorId → cron task
const _cronJobs = new Map();

/**
 * Create a connector instance from a config object.
 */
function _createInstance(config) {
  const useMock = process.env.MOCK_DATA === 'true';

  // Auto-select mock variant if MOCK_DATA=true and type is salesforce
  let type = config.type;
  if (useMock && type === 'salesforce') {
    type = 'mock-salesforce';
    logger.info('MOCK_DATA=true: using mock-salesforce connector', { id: config.id });
  }

  const getConstructor = CONNECTOR_TYPES[type];
  if (!getConstructor) {
    throw new Error(`Unknown connector type: ${type}`);
  }

  const Constructor = getConstructor();
  return new Constructor(config);
}

/**
 * Schedule cron sync for a connector based on its syncInterval config.
 * syncInterval: cron expression (e.g. every-6h) or minutes (number)
 */
function _scheduleCron(connector) {
  const { id, config } = connector;
  const interval = config.syncInterval;

  if (!interval) return;

  // Stop existing job if any
  const existing = _cronJobs.get(id);
  if (existing) {
    existing.stop();
    _cronJobs.delete(id);
  }

  // Determine cron expression
  let cronExpr;
  if (typeof interval === 'number') {
    cronExpr = `*/${interval} * * * *`; // Every N minutes
  } else {
    cronExpr = interval;
  }

  if (!cron.validate(cronExpr)) {
    logger.warn('Invalid cron expression, skipping schedule', { id, cronExpr });
    return;
  }

  const job = cron.schedule(cronExpr, async () => {
    logger.info('Cron sync triggered', { connectorId: id, cronExpr });
    try {
      await connector.sync();
    } catch (err) {
      logger.error('Cron sync failed', { connectorId: id, err: err.message });
    }
  });

  _cronJobs.set(id, job);
  logger.info('Cron job scheduled', { connectorId: id, cronExpr });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the registry — load all persisted connector configs from Redis
 * and start their instances.
 */
async function init() {
  const configs = await Store.listConnectors();
  logger.info(`Loading ${configs.length} connector(s) from store`);

  for (const config of configs) {
    try {
      await add(config, { persist: false }); // Already persisted
    } catch (err) {
      logger.error('Failed to initialize connector', { id: config.id, err: err.message });
    }
  }
}

/**
 * Add a new connector from config.
 * @param {Object} config - Connector configuration
 * @param {Object} [opts]
 * @param {boolean} [opts.persist=true] - Save config to Redis
 * @returns {Object} connector instance
 */
async function add(config, opts = {}) {
  const { persist = true } = opts;

  if (!config.id) {
    config.id = uuidv4();
  }

  if (_instances.has(config.id)) {
    throw new Error(`Connector ${config.id} already exists`);
  }

  const connector = _createInstance(config);

  // Connect
  try {
    await connector.connect();
  } catch (err) {
    logger.warn('Initial connect failed, connector in error state', {
      id: config.id,
      err: err.message
    });
  }

  _instances.set(config.id, connector);

  // Schedule if interval configured
  _scheduleCron(connector);

  if (persist) {
    await Store.saveConnector(config.id, config);
  }

  logger.info('Connector added', { id: config.id, type: config.type, name: config.name });
  return connector;
}

/**
 * Get a connector by ID.
 */
function get(id) {
  return _instances.get(id) || null;
}

/**
 * Update a connector's configuration.
 * Stops old instance, creates new one with updated config.
 */
async function update(id, configUpdates) {
  const existing = _instances.get(id);
  if (!existing) throw new Error(`Connector ${id} not found`);

  // Merge config
  const newConfig = { ...existing.config, ...configUpdates, id };

  // Stop existing
  await stop(id);

  // Create new instance
  const connector = _createInstance(newConfig);
  try {
    await connector.connect();
  } catch (err) {
    logger.warn('Reconnect after update failed', { id, err: err.message });
  }

  _instances.set(id, connector);
  _scheduleCron(connector);

  await Store.saveConnector(id, newConfig);
  logger.info('Connector updated', { id });
  return connector;
}

/**
 * Stop a connector (disconnect + cancel cron).
 */
async function stop(id) {
  const connector = _instances.get(id);
  if (connector) {
    try {
      await connector.disconnect();
    } catch (err) {
      logger.warn('Disconnect error', { id, err: err.message });
    }
    _instances.delete(id);
  }

  const job = _cronJobs.get(id);
  if (job) {
    job.stop();
    _cronJobs.delete(id);
  }

  logger.info('Connector stopped', { id });
}

/**
 * Remove a connector entirely (stop + delete from store).
 */
async function remove(id) {
  await stop(id);
  await Store.deleteConnector(id);
  logger.info('Connector removed', { id });
}

/**
 * Trigger a manual sync on a connector.
 */
async function triggerSync(id) {
  const connector = _instances.get(id);
  if (!connector) throw new Error(`Connector ${id} not found`);
  await connector.sync();
}

/**
 * Test a connector's connection.
 */
async function testConnector(id) {
  const connector = _instances.get(id);
  if (!connector) throw new Error(`Connector ${id} not found`);
  return connector.test();
}

/**
 * Stop all connectors (used on shutdown).
 */
async function stopAll() {
  const ids = [..._instances.keys()];
  await Promise.all(ids.map(id => stop(id)));
  logger.info('All connectors stopped');
}

/**
 * List all connector statuses.
 */
function listStatuses() {
  return [..._instances.values()].map(c => c.getStatus());
}

/**
 * Get health summary for /health endpoint.
 */
function getHealthSummary() {
  const statuses = listStatuses();
  return {
    total: statuses.length,
    connected: statuses.filter(s => s.status === 'connected').length,
    error: statuses.filter(s => s.status === 'error').length,
    syncing: statuses.filter(s => s.status === 'syncing').length,
    idle: statuses.filter(s => s.status === 'idle').length
  };
}

/**
 * Aggregate throughput stats across all connectors.
 */
async function getStats() {
  const statuses = listStatuses();
  const totalRecords = statuses.reduce((sum, s) => sum + (s.recordCount || 0), 0);
  const totalErrors = statuses.reduce((sum, s) => sum + (s.errorCount || 0), 0);

  return {
    connectors: statuses.length,
    healthy: statuses.filter(s => ['connected', 'idle'].includes(s.status)).length,
    degraded: statuses.filter(s => s.status === 'error').length,
    totalRecordsPublished: totalRecords,
    totalErrors,
    byConnector: statuses
  };
}

module.exports = { init, add, get, update, stop, remove, triggerSync, testConnector, stopAll, listStatuses, getHealthSummary, getStats };
