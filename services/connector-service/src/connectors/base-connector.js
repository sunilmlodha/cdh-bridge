'use strict';

const { createLogger, format, transports } = require('winston');
const { toCustomerProfile } = require('../field-mapper');
const KafkaProducer = require('../kafka-producer');
const Store = require('../connector-store');

const STATUSES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  SYNCING: 'syncing',
  ERROR: 'error',
  DISCONNECTED: 'disconnected'
};

class BaseConnector {
  /**
   * @param {Object} config
   * @param {string} config.id - Unique connector ID
   * @param {string} config.type - Connector type (salesforce, snowflake, s3, etc.)
   * @param {string} config.name - Display name
   * @param {Array}  config.fieldMappings - Field mapping config
   * @param {Object} [config.options] - Connector-specific options
   */
  constructor(config) {
    if (!config || !config.id || !config.type) {
      throw new Error('Connector config must include id and type');
    }

    this.config = config;
    this.id = config.id;
    this.type = config.type;
    this.name = config.name || config.id;
    this.fieldMappings = config.fieldMappings || [];

    // Runtime state
    this.status = STATUSES.IDLE;
    this.lastSync = null;
    this.recordCount = 0;
    this.errorCount = 0;
    this._retryCount = 0;
    this._maxRetries = config.maxRetries || 5;
    this._retryDelayMs = config.retryDelayMs || 1000;

    this.logger = createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: format.combine(format.timestamp(), format.json()),
      defaultMeta: { connectorId: this.id, connectorType: this.type },
      transports: [new transports.Console({ format: format.simple() })]
    });
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Establish connection to the data source. Override in subclasses.
   */
  async connect() {
    this.status = STATUSES.CONNECTED;
    this.logger.info('Connector connected');
  }

  /**
   * Disconnect from the data source. Override in subclasses.
   */
  async disconnect() {
    this.status = STATUSES.DISCONNECTED;
    this.logger.info('Connector disconnected');
  }

  /**
   * Test the connection. Must be overridden.
   * @returns {Promise<{success: boolean, recordCount: number, latencyMs: number, warnings: string[]}>}
   */
  async test() {
    const start = Date.now();
    try {
      await this.connect();
      const latencyMs = Date.now() - start;
      return { success: true, recordCount: 0, latencyMs, warnings: [] };
    } catch (err) {
      return { success: false, recordCount: 0, latencyMs: Date.now() - start, warnings: [err.message] };
    }
  }

  // ─── Data Fetching ────────────────────────────────────────────────────────────

  /**
   * Fetch a batch of records changed since lastSync. Override in subclasses.
   * @param {string|null} lastSync - ISO timestamp of last successful sync
   * @returns {Promise<Array>} Array of raw records
   */
  async fetchBatch(lastSync) {
    throw new Error(`fetchBatch() not implemented in ${this.constructor.name}`);
  }

  /**
   * Stream records one at a time. Override for streaming connectors.
   * Default falls back to fetchBatch.
   * @param {Function} onRecord - Callback(rawRecord)
   */
  async stream(onRecord) {
    const syncState = await Store.getSyncState(this.id);
    const records = await this.fetchBatch(syncState.lastSync);
    for (const record of records) {
      await onRecord(record);
    }
  }

  // ─── Normalization ────────────────────────────────────────────────────────────

  /**
   * Normalize a raw record into a CustomerProfile using field mappings.
   * @param {Object} raw
   * @returns {Object} CustomerProfile
   */
  normalizeRecord(raw) {
    return toCustomerProfile(raw, this.fieldMappings, this.id, this.type);
  }

  // ─── Publishing ───────────────────────────────────────────────────────────────

  /**
   * Publish a normalized profile to Kafka.
   * @param {Object} profile
   */
  async publishToKafka(profile) {
    await KafkaProducer.publishProfile(profile, this.id);
    this.recordCount++;
  }

  /**
   * Publish a batch of raw records: normalize + publish each.
   * @param {Array} records
   */
  async publishBatch(records) {
    const profiles = records.map(r => this.normalizeRecord(r));
    await KafkaProducer.publishBatch(profiles, this.id);
    this.recordCount += records.length;
  }

  // ─── Sync ─────────────────────────────────────────────────────────────────────

  /**
   * Run a full sync cycle: fetch batch → normalize → publish → save state.
   */
  async sync() {
    this.logger.info('Sync started');
    this.status = STATUSES.SYNCING;

    const syncState = await Store.getSyncState(this.id);
    const syncStart = new Date().toISOString();
    let syncedCount = 0;

    try {
      const records = await this.fetchBatch(syncState.lastSync);
      this.logger.info(`Fetched ${records.length} records`);

      if (records.length > 0) {
        await this.publishBatch(records);
        syncedCount = records.length;
      }

      const newState = {
        lastSync: syncStart,
        recordCount: (syncState.recordCount || 0) + syncedCount,
        errorCount: syncState.errorCount || 0,
        lastSyncStatus: 'success',
        lastSyncCount: syncedCount
      };

      await Store.saveSyncState(this.id, newState);
      this.lastSync = syncStart;

      await Store.appendLog(this.id, {
        event: 'sync_complete',
        recordCount: syncedCount,
        status: 'success'
      });

      this.status = STATUSES.CONNECTED;
      this._retryCount = 0;
      this.logger.info('Sync complete', { syncedCount });
    } catch (err) {
      this.errorCount++;
      this.status = STATUSES.ERROR;

      await Store.saveSyncState(this.id, {
        ...syncState,
        errorCount: (syncState.errorCount || 0) + 1,
        lastSyncStatus: 'error',
        lastError: err.message
      });

      await Store.appendLog(this.id, {
        event: 'sync_error',
        error: err.message,
        status: 'error'
      });

      await this.onError(err);
    }
  }

  // ─── Error Handling ───────────────────────────────────────────────────────────

  /**
   * Handle an error with exponential backoff retry logic.
   * @param {Error} err
   */
  async onError(err) {
    this.logger.error('Connector error', { err: err.message, retryCount: this._retryCount });

    if (this._retryCount < this._maxRetries) {
      const delay = this._retryDelayMs * Math.pow(2, this._retryCount);
      this._retryCount++;
      this.logger.info(`Retrying in ${delay}ms (attempt ${this._retryCount}/${this._maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await this.connect();
        this._retryCount = 0;
      } catch (retryErr) {
        this.logger.error('Retry failed', { err: retryErr.message });
      }
    } else {
      this.logger.error('Max retries reached, connector in error state');
      this.status = STATUSES.ERROR;
    }
  }

  // ─── Status ───────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      status: this.status,
      lastSync: this.lastSync,
      recordCount: this.recordCount,
      errorCount: this.errorCount
    };
  }
}

BaseConnector.STATUSES = STATUSES;

module.exports = BaseConnector;
