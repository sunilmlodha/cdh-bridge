'use strict';

const crypto = require('crypto');
const BaseConnector = require('./base-connector');
const KafkaProducer = require('../kafka-producer');

/**
 * Generic HTTP Webhook Connector
 *
 * Used by Genesys, Twilio, Segment, Braze, and other webhook-based sources.
 * Registers a webhook endpoint at POST /v1/webhooks/:connectorId
 * Validates HMAC-SHA256 signature
 * Maps payload to CustomerProfile
 */
class HttpWebhookConnector extends BaseConnector {
  constructor(config) {
    super({
      fieldMappings: [
        { source: 'id', target: 'customerId' },
        { source: 'email', target: 'email', transform: 'lowercase' },
        { source: 'phone', target: 'phone' },
        { source: 'firstName', target: 'firstName' },
        { source: 'lastName', target: 'lastName' },
        { source: 'properties.ltv', target: 'ltv', transform: 'toNumber' }
      ],
      ...config
    });

    if (config.fieldMappings && config.fieldMappings.length > 0) {
      this.fieldMappings = config.fieldMappings;
    }

    this._secret = config.secret || config.hmacSecret;
    this._signatureHeader = config.signatureHeader || 'x-webhook-signature';
    this._signatureAlgorithm = config.signatureAlgorithm || 'sha256';
    this._eventTypes = config.eventTypes || null; // null = accept all
    this._receivedCount = 0;
    this._lastReceived = null;
  }

  async connect() {
    // Webhook connectors are passive — no outbound connection needed
    this.status = 'connected';
    this.logger.info('Webhook connector ready', {
      endpoint: `/v1/webhooks/${this.id}`,
      hmacEnabled: !!this._secret
    });
  }

  async disconnect() {
    this.status = 'disconnected';
  }

  async test() {
    const start = Date.now();
    return {
      success: true,
      recordCount: this._receivedCount,
      latencyMs: Date.now() - start,
      warnings: this._secret ? [] : ['HMAC signature validation is disabled — no secret configured']
    };
  }

  /**
   * Validate HMAC signature from the webhook request.
   */
  _validateSignature(req) {
    if (!this._secret) return true; // Skip if no secret configured

    const signature = req.headers[this._signatureHeader];
    if (!signature) {
      this.logger.warn('Missing webhook signature header', { header: this._signatureHeader });
      return false;
    }

    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const hmac = crypto.createHmac(this._signatureAlgorithm, this._secret);
    hmac.update(body, 'utf8');
    const expected = `${this._signatureAlgorithm}=${hmac.digest('hex')}`;

    // Timing-safe comparison
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expected, 'utf8')
      );
    } catch {
      return false;
    }
  }

  /**
   * Handle an incoming webhook request.
   * Called by the Express route in index.js.
   */
  async handleWebhook(req, res) {
    // Signature validation
    if (!this._validateSignature(req)) {
      this.logger.warn('Webhook signature validation failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = req.body;

    // Support both single event and batch (array)
    const events = Array.isArray(payload) ? payload : [payload];

    let processed = 0;
    const errors = [];

    for (const event of events) {
      try {
        // Filter by event type if configured
        if (this._eventTypes && !this._eventTypes.includes(event.type || event.event)) {
          this.logger.debug('Skipping event type', { type: event.type || event.event });
          continue;
        }

        const profile = this.normalizeRecord(event);
        await this.publishToKafka(profile);
        processed++;
      } catch (err) {
        this.logger.error('Error processing webhook event', { err: err.message });
        errors.push(err.message);
      }
    }

    this._receivedCount += processed;
    this._lastReceived = new Date().toISOString();
    this.recordCount += processed;

    // Append log entry
    const Store = require('../connector-store');
    await Store.appendLog(this.id, {
      event: 'webhook_received',
      processed,
      errors: errors.length,
      source: req.ip
    });

    res.json({
      received: events.length,
      processed,
      errors: errors.length > 0 ? errors : undefined
    });
  }

  // Webhooks don't have batch fetch — they are push-based
  async fetchBatch(lastSync) {
    return []; // No-op for webhook connectors
  }

  getStatus() {
    return {
      ...super.getStatus(),
      receivedCount: this._receivedCount,
      lastReceived: this._lastReceived,
      endpoint: `/v1/webhooks/${this.id}`
    };
  }
}

module.exports = HttpWebhookConnector;
