'use strict';

const express = require('express');
const router = express.Router();
const http = require('http');

const { validateSingleEvent, validateBatchEvents } = require('../validators');
const { mapToCDHSchema, mapBatchToCDHSchema, getSchemaMappingReference } = require('../schema-mapper');
const { publishEvent, publishBatch } = require('../kafka-producer');
const { isOptedOut } = require('../consent-check');
const logger = require('../logger');

// ---------------------------------------------------------------------------
// Internal helper: fire-and-forget HTTP POST to the profile-router service
// ---------------------------------------------------------------------------
const PROFILE_ROUTER_BASE = process.env.PROFILE_ROUTER_URL || 'http://profile-router:3002';

/**
 * Post JSON to an internal service endpoint.
 * Returns a Promise that resolves to the parsed response body.
 * Never rejects — failures are logged and the error is returned.
 */
function internalPost(path, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const url     = new URL(PROFILE_ROUTER_BASE + path);
    const options = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Internal':     'event-collector',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', (err) => {
      logger.error('Internal POST failed', { path, error: err.message });
      resolve({ status: 0, error: err.message });
    });

    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout' });
    });

    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helper: build a standardised error response
// ---------------------------------------------------------------------------
function errorResponse(res, status, code, message, details) {
  return res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
  });
}

// ---------------------------------------------------------------------------
// POST /v1/events — ingest a single event
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  // 1. Validate input
  const { value: event, error: validationError } = validateSingleEvent(req.body);
  if (validationError) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Invalid event payload', {
      fields: validationError.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
    });
  }

  const { cookieId } = req.body; // optional anonymous identity field

  // ---------------------------------------------------------------------------
  // Anonymous-to-Known: login stitch trigger
  // If the event is a 'login' AND has both cookieId and customerId, stitch now.
  // ---------------------------------------------------------------------------
  if (event.eventType === 'login' && cookieId && event.customerId) {
    logger.info('Stitching anonymous cookieId to customerId', {
      cookieId,
      customerId: event.customerId,
    });
    // Fire stitch asynchronously — do not block event ingestion
    internalPost('/v1/identity/stitch', {
      cookieId,
      customerId: event.customerId,
      source:     'login-event',
    }).then((result) => {
      logger.info('Stitch response', { cookieId, customerId: event.customerId, result });
    });
  }

  // ---------------------------------------------------------------------------
  // Anonymous-only event: has cookieId but no customerId
  // Forward to profile-router anon tracking and publish to Kafka with synthetic ID.
  // ---------------------------------------------------------------------------
  if (cookieId && !event.customerId) {
    // Forward to anon tracker (fire-and-forget)
    internalPost(`/v1/identity/anon/${encodeURIComponent(cookieId)}/event`, {
      ...event,
      cookieId,
    }).then((result) => {
      if (result.status !== 201 && result.status !== 200) {
        logger.warn('Anon event tracking returned non-success', { cookieId, status: result.status });
      }
    });

    // Publish to Kafka with synthetic customerId so downstream consumers see the event
    const anonEvent = { ...event, customerId: `anon:${cookieId}` };
    const cdhEvent  = mapToCDHSchema(anonEvent);
    let kafkaMeta;
    try {
      kafkaMeta = await publishEvent(cdhEvent);
    } catch (err) {
      logger.error('Failed to publish anon event to Kafka', { cookieId, eventType: event.eventType, error: err.message });
      return errorResponse(res, 502, 'KAFKA_ERROR', 'Failed to publish event to message broker.');
    }

    return res.status(201).json({
      success:       true,
      accepted:      true,
      anonymous:     true,
      cookieId,
      correlationId: cdhEvent.IHContext.correlationId,
      ihEventType:   cdhEvent.IHEventType,
      kafka: {
        topic:     process.env.KAFKA_TOPIC || 'cdh-events',
        partition: kafkaMeta?.partition,
        offset:    kafkaMeta?.baseOffset,
      },
    });
  }

  // 2. Consent / opt-out check (known customer path)
  const optedOut = await isOptedOut(event.customerId);
  if (optedOut) {
    // Return 202 Accepted — we acknowledge receipt but silently discard
    return res.status(202).json({
      success:  true,
      accepted: false,
      reason:   'OPT_OUT',
      message:  'Event discarded: customer has opted out of data collection.',
    });
  }

  // 3. Map to CDH IH schema
  const cdhEvent = mapToCDHSchema(event);

  // 4. Publish to Kafka
  let kafkaMeta;
  try {
    kafkaMeta = await publishEvent(cdhEvent);
  } catch (err) {
    logger.error('Failed to publish event to Kafka', {
      customerId: event.customerId,
      eventType:  event.eventType,
      error:      err.message,
    });
    return errorResponse(res, 502, 'KAFKA_ERROR', 'Failed to publish event to message broker.');
  }

  return res.status(201).json({
    success:       true,
    accepted:      true,
    correlationId: cdhEvent.IHContext.correlationId,
    ihEventType:   cdhEvent.IHEventType,
    kafka: {
      topic:     process.env.KAFKA_TOPIC || 'cdh-events',
      partition: kafkaMeta?.partition,
      offset:    kafkaMeta?.baseOffset,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /v1/events/batch — ingest up to 100 events
// ---------------------------------------------------------------------------
router.post('/batch', async (req, res) => {
  // 1. Validate input
  const { value: body, error: validationError } = validateBatchEvents(req.body);
  if (validationError) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Invalid batch payload', {
      fields: validationError.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
    });
  }

  const { events } = body;

  // 2. Consent check — run in parallel for all events
  const consentChecks = await Promise.all(
    events.map((e) => isOptedOut(e.customerId))
  );

  const allowed  = [];
  const rejected = [];

  events.forEach((e, idx) => {
    if (consentChecks[idx]) {
      rejected.push({ index: idx, customerId: e.customerId, reason: 'OPT_OUT' });
    } else {
      allowed.push({ event: e, originalIndex: idx });
    }
  });

  if (allowed.length === 0) {
    return res.status(202).json({
      success:  true,
      accepted: 0,
      rejected: rejected.length,
      message:  'All events discarded: all customers have opted out.',
      details:  { rejected },
    });
  }

  // 3. Map allowed events to CDH IH schema
  const cdhEvents = mapBatchToCDHSchema(allowed.map((a) => a.event));

  // 4. Publish batch to Kafka
  let kafkaMeta;
  try {
    kafkaMeta = await publishBatch(cdhEvents);
  } catch (err) {
    logger.error('Failed to publish batch to Kafka', {
      count: cdhEvents.length,
      error: err.message,
    });
    return errorResponse(res, 502, 'KAFKA_ERROR', 'Failed to publish events to message broker.');
  }

  return res.status(201).json({
    success:  true,
    accepted: allowed.length,
    rejected: rejected.length,
    events: allowed.map((a, i) => ({
      index:         a.originalIndex,
      correlationId: cdhEvents[i].IHContext.correlationId,
      ihEventType:   cdhEvents[i].IHEventType,
      customerId:    cdhEvents[i].CustomerID,
    })),
    ...(rejected.length > 0 ? { rejectedDetails: rejected } : {}),
    kafka: kafkaMeta,
  });
});

// ---------------------------------------------------------------------------
// GET /v1/events/schema — CDH IH field mapping reference
// ---------------------------------------------------------------------------
router.get('/schema', (req, res) => {
  return res.status(200).json({
    success: true,
    schema:  getSchemaMappingReference(),
  });
});

module.exports = router;
