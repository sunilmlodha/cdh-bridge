'use strict';

const axios = require('axios');
const BaseConnector = require('./base-connector');

/**
 * Salesforce CRM Connector
 *
 * Uses Salesforce REST API + Bulk API v2
 * OAuth2 client credentials (connected app)
 * Syncs Contact + Account objects
 * Supports CDC streaming mode
 */
class SalesforceConnector extends BaseConnector {
  constructor(config) {
    super({
      fieldMappings: [
        { source: 'External_ID__c', target: 'customerId' },
        { source: 'Email', target: 'email', transform: 'lowercase' },
        { source: 'Phone', target: 'phone' },
        { source: 'FirstName', target: 'firstName' },
        { source: 'LastName', target: 'lastName' },
        { source: 'Account.AnnualRevenue', target: 'ltv', transform: 'parseCurrency' },
        { source: 'Account.Industry', target: 'traits.industry' },
        { source: 'LeadSource', target: 'traits.leadSource' },
        { source: 'Account.Name', target: 'traits.company' }
      ],
      ...config
    });

    // Override with any user-provided field mappings
    if (config.fieldMappings && config.fieldMappings.length > 0) {
      this.fieldMappings = config.fieldMappings;
    }

    this.instanceUrl = config.instanceUrl || null;
    this.accessToken = null;
    this.tokenExpiry = null;

    // Rate limiting: 15000 calls/day = ~10.4 calls/minute
    this._apiCallCount = 0;
    this._apiCallLimit = config.apiCallLimit || 15000;
    this._callResetTime = null;
    this._pageSize = config.pageSize || 200;
  }

  // ─── Authentication ───────────────────────────────────────────────────────────

  async _authenticate() {
    const { loginUrl, clientId, clientSecret, username, password, securityToken } = this.config;
    const authUrl = `${loginUrl || 'https://login.salesforce.com'}/services/oauth2/token`;

    let params;
    if (clientId && clientSecret && !username) {
      // Client credentials flow
      params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      });
    } else {
      // Username-password flow (for dev/sandbox)
      params = new URLSearchParams({
        grant_type: 'password',
        client_id: clientId,
        client_secret: clientSecret,
        username,
        password: `${password}${securityToken || ''}`
      });
    }

    const resp = await axios.post(authUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });

    this.accessToken = resp.data.access_token;
    this.instanceUrl = resp.data.instance_url;
    this.tokenExpiry = Date.now() + 3600000; // 1 hour

    this.logger.info('Salesforce OAuth token acquired', { instanceUrl: this.instanceUrl });
  }

  async _ensureToken() {
    if (!this.accessToken || Date.now() >= (this.tokenExpiry - 60000)) {
      await this._authenticate();
    }
  }

  _apiHeaders() {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  _checkRateLimit() {
    const now = Date.now();
    if (!this._callResetTime || now - this._callResetTime > 86400000) {
      this._callResetTime = now;
      this._apiCallCount = 0;
    }
    if (this._apiCallCount >= this._apiCallLimit) {
      throw new Error(`Salesforce API rate limit reached (${this._apiCallLimit} calls/day)`);
    }
    this._apiCallCount++;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async connect() {
    this.status = 'connecting';
    await this._authenticate();
    this.status = 'connected';
    this.logger.info('Salesforce connector connected');
  }

  async disconnect() {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.status = 'disconnected';
  }

  async test() {
    const start = Date.now();
    try {
      await this._authenticate();
      this._checkRateLimit();

      const resp = await axios.get(
        `${this.instanceUrl}/services/data/v59.0/limits`,
        { headers: this._apiHeaders(), timeout: 10000 }
      );

      const remaining = resp.data.DailyApiRequests?.Remaining || 0;
      const warnings = [];
      if (remaining < 1000) {
        warnings.push(`Only ${remaining} API calls remaining today`);
      }

      return {
        success: true,
        recordCount: 0,
        latencyMs: Date.now() - start,
        warnings
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

  // ─── Bulk API ─────────────────────────────────────────────────────────────────

  async _createBulkJob(query) {
    await this._ensureToken();
    this._checkRateLimit();

    const resp = await axios.post(
      `${this.instanceUrl}/services/data/v59.0/jobs/query`,
      { operation: 'queryAll', query },
      { headers: this._apiHeaders(), timeout: 15000 }
    );

    return resp.data.id;
  }

  async _waitForBulkJob(jobId) {
    const maxWait = 300000; // 5 minutes
    const pollInterval = 5000;
    const deadline = Date.now() + maxWait;

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      await this._ensureToken();
      this._checkRateLimit();

      const resp = await axios.get(
        `${this.instanceUrl}/services/data/v59.0/jobs/query/${jobId}`,
        { headers: this._apiHeaders(), timeout: 10000 }
      );

      const { state } = resp.data;
      if (state === 'JobComplete') return true;
      if (state === 'Failed' || state === 'Aborted') {
        throw new Error(`Bulk job ${jobId} failed with state: ${state}`);
      }
    }

    throw new Error(`Bulk job ${jobId} timed out after 5 minutes`);
  }

  async _fetchBulkResults(jobId) {
    await this._ensureToken();
    this._checkRateLimit();

    const records = [];
    let nextLocator = null;

    do {
      const url = nextLocator
        ? `${this.instanceUrl}/services/data/v59.0/jobs/query/${jobId}/results?locator=${nextLocator}`
        : `${this.instanceUrl}/services/data/v59.0/jobs/query/${jobId}/results`;

      const resp = await axios.get(url, {
        headers: { ...this._apiHeaders(), Accept: 'text/csv' },
        timeout: 30000
      });

      // Parse CSV response
      const lines = resp.data.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        const record = {};
        headers.forEach((h, idx) => { record[h] = values[idx] || null; });
        records.push(record);
      }

      nextLocator = resp.headers['sforce-locator'];
      if (nextLocator === 'null') nextLocator = null;
    } while (nextLocator);

    return records;
  }

  // ─── REST API (for smaller syncs) ────────────────────────────────────────────

  async _queryRest(soql) {
    await this._ensureToken();
    this._checkRateLimit();

    const records = [];
    let url = `${this.instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;

    while (url) {
      const resp = await axios.get(url, { headers: this._apiHeaders(), timeout: 15000 });
      records.push(...(resp.data.records || []));

      if (resp.data.nextRecordsUrl) {
        url = `${this.instanceUrl}${resp.data.nextRecordsUrl}`;
        this._checkRateLimit();
      } else {
        url = null;
      }
    }

    return records;
  }

  // ─── fetchBatch ───────────────────────────────────────────────────────────────

  async fetchBatch(lastSync) {
    await this._ensureToken();

    const whereClause = lastSync
      ? `WHERE Contact.SystemModstamp > ${new Date(lastSync).toISOString().replace('.000Z', '+0000')}`
      : '';

    const soql = `
      SELECT Id, External_ID__c, Email, Phone, FirstName, LastName,
             LeadSource, Account.Name, Account.AnnualRevenue, Account.Industry,
             SystemModstamp
      FROM Contact
      ${whereClause}
      ORDER BY SystemModstamp ASC
      LIMIT 10000
    `.trim();

    this.logger.info('Fetching Salesforce batch', { lastSync, query: soql.substring(0, 100) });

    try {
      // Use Bulk API for large datasets
      if (!lastSync) {
        const jobId = await this._createBulkJob(soql);
        await this._waitForBulkJob(jobId);
        return this._fetchBulkResults(jobId);
      } else {
        // Use REST API for incremental syncs
        return this._queryRest(soql);
      }
    } catch (err) {
      this.logger.error('fetchBatch failed', { err: err.message });
      throw err;
    }
  }

  // ─── CDC Streaming ────────────────────────────────────────────────────────────

  /**
   * Stream mode using Salesforce CDC (Change Data Capture).
   * Subscribes to /data/ContactChangeEvent channel.
   */
  async stream(onRecord) {
    this.logger.info('CDC streaming mode not fully implemented — falling back to batch');
    // Full CDC requires Bayeux/CometD client. Fall back to batch for now.
    await this._ensureToken();
    const records = await this.fetchBatch(this.lastSync);
    for (const record of records) {
      await onRecord(record);
    }
  }
}

module.exports = SalesforceConnector;
