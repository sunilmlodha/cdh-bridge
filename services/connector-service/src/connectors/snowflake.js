'use strict';

const axios = require('axios');
const BaseConnector = require('./base-connector');

/**
 * Snowflake Connector
 *
 * Uses Snowflake SQL API v2 (REST-based, no JDBC driver needed)
 * Executes: SELECT * FROM <table> WHERE UPDATED_AT > :lastSync
 * Supports async query execution for large result sets
 */
class SnowflakeConnector extends BaseConnector {
  constructor(config) {
    super({
      fieldMappings: [
        { source: 'CUSTOMER_ID', target: 'customerId' },
        { source: 'EMAIL', target: 'email', transform: 'lowercase' },
        { source: 'PHONE', target: 'phone' },
        { source: 'FIRST_NAME', target: 'firstName' },
        { source: 'LAST_NAME', target: 'lastName' },
        { source: 'LTV', target: 'ltv', transform: 'toNumber' },
        { source: 'SEGMENT', target: 'segments', transform: (v) => v ? v.split(',').map(s => s.trim()) : [] }
      ],
      ...config
    });

    if (config.fieldMappings && config.fieldMappings.length > 0) {
      this.fieldMappings = config.fieldMappings;
    }

    const { account, username, password, warehouse, database, schema, table } = config;
    this._account = account; // e.g. 'myorg-myaccount'
    this._username = username;
    this._password = password;
    this._warehouse = warehouse || 'COMPUTE_WH';
    this._database = database;
    this._schema = schema || 'PUBLIC';
    this._table = table || 'CUSTOMERS';
    this._updatedAtColumn = config.updatedAtColumn || 'UPDATED_AT';
    this._baseUrl = `https://${account}.snowflakecomputing.com/api/v2/statements`;
    this._sessionToken = null;
    this._tokenExpiry = null;
    this._pageSize = config.pageSize || 10000;
  }

  _authHeader() {
    // Basic auth with user:password (base64)
    const creds = Buffer.from(`${this._username}:${this._password}`).toString('base64');
    return `Basic ${creds}`;
  }

  async connect() {
    this.status = 'connecting';
    // Validate connection with a simple query
    try {
      await this._executeStatement('SELECT CURRENT_TIMESTAMP()', { async: false });
      this.status = 'connected';
      this.logger.info('Snowflake connector connected');
    } catch (err) {
      this.status = 'error';
      throw err;
    }
  }

  async disconnect() {
    this._sessionToken = null;
    this.status = 'disconnected';
  }

  async test() {
    const start = Date.now();
    try {
      await this.connect();

      const countResult = await this._executeStatement(
        `SELECT COUNT(*) AS CNT FROM ${this._database}.${this._schema}.${this._table}`,
        { async: false }
      );

      const recordCount = parseInt(countResult?.data?.[0]?.[0] || 0, 10);

      return {
        success: true,
        recordCount,
        latencyMs: Date.now() - start,
        warnings: []
      };
    } catch (err) {
      return {
        success: false,
        recordCount: 0,
        latencyMs: Date.now() - start,
        warnings: [err.message]
      };
    }
  }

  /**
   * Execute a SQL statement via Snowflake SQL API v2.
   * @param {string} sql
   * @param {Object} opts
   * @returns {Promise<Object>} Snowflake response
   */
  async _executeStatement(sql, opts = {}) {
    const payload = {
      statement: sql,
      timeout: opts.timeout || 60,
      database: this._database,
      schema: this._schema,
      warehouse: this._warehouse,
      parameters: opts.parameters || {}
    };

    if (opts.async) {
      payload.async = true;
    }

    const resp = await axios.post(this._baseUrl, payload, {
      headers: {
        Authorization: this._authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Snowflake-Authorization-Token-Type': 'BASIC'
      },
      timeout: opts.httpTimeout || 120000
    });

    if (opts.async && resp.data.statementHandle) {
      return this._pollAsyncStatement(resp.data.statementHandle);
    }

    return resp.data;
  }

  /**
   * Poll for async statement completion.
   */
  async _pollAsyncStatement(statementHandle) {
    const maxWait = 600000; // 10 minutes
    const pollInterval = 3000;
    const deadline = Date.now() + maxWait;

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const resp = await axios.get(`${this._baseUrl}/${statementHandle}`, {
        headers: {
          Authorization: this._authHeader(),
          Accept: 'application/json',
          'X-Snowflake-Authorization-Token-Type': 'BASIC'
        },
        timeout: 30000
      });

      if (resp.data.status === 'success') return resp.data;
      if (resp.data.status === 'failed') {
        throw new Error(`Snowflake async query failed: ${resp.data.message}`);
      }
    }

    throw new Error('Snowflake async query timed out');
  }

  /**
   * Convert Snowflake columnar result to array of row objects.
   */
  _rowsFromResult(result) {
    if (!result || !result.data || !result.resultSetMetaData) return [];

    const columns = result.resultSetMetaData.rowType.map(col => col.name);
    return result.data.map(row => {
      const obj = {};
      columns.forEach((col, idx) => { obj[col] = row[idx]; });
      return obj;
    });
  }

  async fetchBatch(lastSync) {
    this.logger.info('Fetching Snowflake batch', { lastSync, table: this._table });

    const whereClause = lastSync
      ? `WHERE ${this._updatedAtColumn} > '${new Date(lastSync).toISOString()}'`
      : '';

    const sql = `
      SELECT *
      FROM ${this._database}.${this._schema}.${this._table}
      ${whereClause}
      ORDER BY ${this._updatedAtColumn} ASC
      LIMIT ${this._pageSize}
    `.trim();

    const result = await this._executeStatement(sql, { async: true });
    return this._rowsFromResult(result);
  }

  async stream(onRecord) {
    const syncState = await require('../connector-store').getSyncState(this.id);
    const records = await this.fetchBatch(syncState.lastSync);
    for (const record of records) {
      await onRecord(record);
    }
  }
}

module.exports = SnowflakeConnector;
